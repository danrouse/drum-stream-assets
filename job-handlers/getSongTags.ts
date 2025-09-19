import ffprobe from 'ffprobe';
import ffprobeStatic from 'ffprobe-static';
import { basename } from 'path';
// @ts-expect-error
import { parseFile } from 'music-metadata';
import { parseTime } from '../shared/util';
import { existsSync, readFileSync } from 'fs';

export default async function getSongTags(songPath: string) {
  let tags: any = {};
  try {
    tags = await parseFile(songPath);
  } catch (e) {}
  try {
    // most metadata can come from analyzing the media file directly with ffprobe
    const res = await ffprobe(songPath, { path: ffprobeStatic.path });
    // check for metadata downloaded from yt-dlp
    // this allows sanitized filenames, and yt-dlp downloads are
    // seldom well-tagged, so still try to get that info
    const metadataPath = songPath.replace(/\..{3,}$/, '.info.json');
    const hasMetadata = existsSync(metadataPath);
    let duration = 0;
    if (res.streams[0].duration) {
      duration = Number(res.streams[0].duration);
    } else if (res.streams[0].tags.DURATION) {
      duration = parseTime(res.streams[0].tags.DURATION);
    }
    if (hasMetadata) {
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
      // Emerson South override because of how YouTube credits artists
      if (metadata.artist?.startsWith('Emerson South,')) {
        metadata.artist = 'Emerson South';
      }
      tags.common.artist = metadata.artist || '';
      tags.common.title = metadata.fulltitle || metadata.track;
      tags.common.album = `YouTube [${metadata.id}]`;
      tags.common.track = { no: 1, of: 1 };
    } else {
      // legacy youtube filename parsing to get artist - title
      const videoBasename = basename(songPath).replace(/^YouTube - /, '');
      const videoTitle = videoBasename.substring(0, videoBasename.lastIndexOf('.'));
      const youtubeIdMatch = videoTitle.match(/(.+)( \[\S{11}\])$/);
      const album = `YouTube${youtubeIdMatch?.[2] || ''}`;
      const titleWithoutId = youtubeIdMatch ? youtubeIdMatch[1] : videoTitle;
      const hyphenParts = titleWithoutId.split(' - ');
      const artist = hyphenParts.length > 1 ? hyphenParts[0] : '';
      const title = hyphenParts.length > 1 ? hyphenParts.slice(1).join('-') : titleWithoutId;
      if (!tags.common) tags.common = {};
      tags.common.artist ||= artist.trim();
      tags.common.title ||= title.trim().replace(/_/g, ' ');
      tags.common.album ||= album.trim();
      tags.common.track ||= { no: 1, of: 1 };
    }
    if (!tags.format) tags.format = {};
    tags.format.duration ||= duration;
    return tags;
  } catch (e) {
    console.log('song tagging error!', e);
  }
}
