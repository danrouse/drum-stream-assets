import 'dotenv/config';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import downloadSong from './downloadSong';
import getSongTags from './getSongTags';
import demucs from './wrappers/demucs';
import getAcoustidRecordingId from './wrappers/acoustid';
import * as Paths from '../shared/paths';
import { Queues, JobInterface } from '../shared/RabbitMQ';

const VIDEO_EXTENSIONS = ['mkv', 'mp4', 'webm'];

const i = new JobInterface();

await i.listen(Queues.SONG_REQUEST_CREATED, async (msg) => {
  console.log('SONG_REQUEST_CREATED', msg);
  const uuid = randomUUID();

  const downloadedSongPath = await downloadSong(msg.query, Paths.DOWNLOADS_PATH, uuid, {
    maxDuration: msg.maxDuration,
    minViews: msg.minViews,
  });
  const tags = await getSongTags(downloadedSongPath);
  if (msg.maxDuration && tags.duration > msg.maxDuration) {
    throw new Error('TOO_LONG');
  }

  const acoustidRecordingId = await getAcoustidRecordingId(downloadedSongPath);
  let lyricsPath: string | undefined = downloadedSongPath.substring(0, downloadedSongPath.lastIndexOf('.')) + '.lrc';
  if (!existsSync(lyricsPath)) lyricsPath = undefined;

  await i.publish(Queues.SONG_REQUEST_DOWNLOADED, {
    id: msg.id,
    path: downloadedSongPath,
    ignoreDuplicates: msg.ignoreDuplicates,
    requester: msg.requester,
    acoustidRecordingId,
    lyricsPath: lyricsPath?.replace(Paths.DOWNLOADS_PATH, '').replace(/^[/\\]+/, ''),

    artist: String(tags.artist) || '',
    title: String(tags.title) || '',
    album: String(tags.album) || '',
    track: Number(tags.track.no),
    duration: Number(tags.duration),
  });
});

await i.listen(Queues.SONG_REQUEST_DEDUPLICATED, async (msg) => {
  console.log('SONG_REQUEST_DEDUPLICATED', msg);

  const dstPath = msg.path.endsWith('.webm') ? msg.path.replace(/\.webm$/, '.mp4') : msg.path;
  console.log('Running ffmpeg-normalize', msg.path, dstPath);
  execSync(`ffmpeg-normalize "${msg.path}" -o "${dstPath}" -c:a aac -nt rms -t -16 -f`);
  console.log('Running demucs', dstPath);
  const stemsPath = await demucs(dstPath, Paths.DEMUCS_OUTPUT_PATH, msg.ignoreDuplicates);

  const extension = dstPath.substring(dstPath.lastIndexOf('.') + 1);
  const isVideo = VIDEO_EXTENSIONS.includes(extension.toLowerCase());

  await i.publish(Queues.SONG_REQUEST_COMPLETE, {
    ...msg,
    downloadPath: dstPath.replace(Paths.DOWNLOADS_PATH, '').replace(/^[/\\]+/, ''),
    lyricsPath: msg.lyricsPath?.replace(Paths.DOWNLOADS_PATH, '').replace(/^[/\\]+/, ''),
    stemsPath: stemsPath.replace(Paths.STEMS_PATH, '').replace(/^[/\\]+/, ''),
    isVideo,
    requester: msg.requester,
  });
});
