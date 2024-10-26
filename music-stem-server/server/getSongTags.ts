import ffprobe from 'ffprobe';
import ffprobeStatic from 'ffprobe-static';
// @ts-expect-error
import { parseFile } from 'music-metadata';
import { parseTime } from '../../shared/util';

export default async function getSongTags(songPath: string) {
  let tags: any = {};
  try {
    tags = await parseFile(songPath);
  } catch (e) {
    const res = await ffprobe(songPath, { path: ffprobeStatic.path });

    let duration = 0;
    if (res.streams[0].duration) {
      duration = Number(res.streams[0].duration);
    } else if (res.streams[0].tags.DURATION) {
      duration = parseTime(res.streams[0].tags.DURATION);
    }
    const partsMatch = songPath.match(/([^-]+) - (.+)$/);
    tags = {
      common: {
        artist: partsMatch?.[1],
        title: partsMatch?.[2],
        album: 'YouTube',
        track: { no: 1, of: 1 },
      },
      format: { duration },
    };
  }
  return tags;
}
