import 'dotenv/config';
import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import downloadSong from './downloadSong';
import getSongTags from './getSongTags';
import demucs from './wrappers/demucs';
import * as Paths from '../shared/paths';
import { Queues, JobInterface } from '../shared/RabbitMQ';

const i = new JobInterface();
await i.listen(Queues.SONG_REQUEST_CREATED, async (msg) => {
  console.log('SONG_REQUEST_CREATED', msg);

  const downloadedSongPath = await downloadSong(msg.query, Paths.DOWNLOADS_PATH, {
    maxDuration: msg.maxDuration,
    minViews: msg.minViews,
  });
  const tags = await getSongTags(downloadedSongPath);
  if (msg.maxDuration && tags.format?.duration > msg.maxDuration) {
    throw new Error('TOO_LONG');
  }

  await i.publish(Queues.SONG_REQUEST_DOWNLOADED, {
    id: msg.id,
    path: downloadedSongPath,
    ignoreDuplicates: msg.ignoreDuplicates,

    artist: String(tags.common?.artist) || '',
    title: String(tags.common?.title) || '',
    album: String(tags.common?.album) || '',
    track: Number(tags.common?.track.no),
    duration: Number(tags.format!.duration),
  });
});


await i.listen(Queues.SONG_REQUEST_DOWNLOADED, async (msg) => {
  console.log('SONG_REQUEST_DOWNLOADED', msg);

  console.log('Running ffmpeg-normalize', msg.path);
  execSync(`ffmpeg-normalize "${msg.path}" -o "${msg.path}" -c:a aac -nt rms -t -16 -f`);
  console.log('Running demucs', msg.path);
  const stemsPath = await demucs(msg.path, Paths.DEMUCS_OUTPUT_PATH, msg.ignoreDuplicates);

  let lyricsPath: string | undefined = msg.path.substring(0, msg.path.lastIndexOf('.')) + '.lrc';
  if (!existsSync(lyricsPath)) lyricsPath = undefined;

  const extension = msg.path.substring(msg.path.lastIndexOf('.'));
  const isVideo = ['mkv', 'mp4', 'webm'].includes(extension.toLowerCase());

  await i.publish(Queues.SONG_REQUEST_COMPLETE, {
    ...msg,
    downloadPath: msg.path.replace(Paths.DOWNLOADS_PATH, '').replace(/^[/\\]+/, ''),
    lyricsPath: lyricsPath?.replace(Paths.DOWNLOADS_PATH, '').replace(/^[/\\]+/, ''),
    stemsPath: stemsPath.replace(Paths.STEMS_PATH, '').replace(/^[/\\]+/, ''),
    isVideo,
  });
});
