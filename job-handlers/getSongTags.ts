import ffprobe from 'ffprobe';
import ffprobeStatic from 'ffprobe-static';
import { basename } from 'path';
// @ts-expect-error
import { parseFile } from 'music-metadata';
import { parseTime } from '../shared/util';

export default async function getSongTags(songPath: string) {
  let tags: any = {};
  try {
    tags = await parseFile(songPath);
  } catch (e) {}
  const res = await ffprobe(songPath, { path: ffprobeStatic.path });
  let duration = 0;
  if (res.streams[0].duration) {
    duration = Number(res.streams[0].duration);
  } else if (res.streams[0].tags.DURATION) {
    duration = parseTime(res.streams[0].tags.DURATION);
  }
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
  tags.common.title ||= title.trim();
  tags.common.album ||= album.trim();
  tags.common.track ||= { no: 1, of: 1 };
  if (!tags.format) tags.format = {};
  tags.format.duration ||= duration;
  return tags;
}
