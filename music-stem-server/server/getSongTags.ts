import ffprobe from 'ffprobe';
import ffprobeStatic from 'ffprobe-static';
import { basename } from 'path';
// @ts-expect-error
import { parseFile } from 'music-metadata';
import { parseTime } from '../../shared/util';

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
  const videoTitle = basename(songPath).replace(/^YouTube - /, '');
  const partsMatch = videoTitle.match(/(([^-]+) - )?(.+)( \[\S{11}\])\.(...)$/);
  if (!tags.common) tags.common = {};
  tags.common.artist ||= partsMatch?.[2] || 'Unknown';
  tags.common.title ||= partsMatch?.[3];
  tags.common.album ||= `YouTube${partsMatch?.[4] || ''}`;
  tags.common.track ||= { no: 1, of: 1 };
  if (!tags.format) tags.format = {};
  tags.format.duration ||= duration;
  return tags;
}
