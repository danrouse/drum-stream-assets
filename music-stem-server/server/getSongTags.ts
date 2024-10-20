import { existsSync } from 'fs';
import { join } from 'path';
import ffprobe from 'ffprobe';
import ffprobeStatic from 'ffprobe-static';
// @ts-expect-error
import { parseFile } from 'music-metadata';
import { parseTime } from './util';

export default async function getSongTags(songBasename: string, isPath: boolean = false, basePath: string) {
  let tags: any = {};
  try {
    const songPath = isPath ? songBasename : join(basePath, `${songBasename}.m4a`);
    tags = await parseFile(songPath);
  } catch (e) {
    const possibleExtensions = ['mkv', 'mp4', 'ogg', 'webm', 'flv'];
    const songPath = isPath ? songBasename :
      possibleExtensions.map((ext) => join(basePath, `${songBasename}.${ext}`))
        .find((path) => existsSync(path));
    if (!songPath) return tags;
    const res = await ffprobe(songPath, { path: ffprobeStatic.path });

    let duration = 0;
    if (res.streams[0].duration) {
      duration = Number(res.streams[0].duration);
    } else if (res.streams[0].tags.DURATION) {
      duration = parseTime(res.streams[0].tags.DURATION);
    }
    const partsMatch = songBasename.match(/([^-]+) - (.+)$/);
    tags = {
      common: {
        artist: partsMatch?.[1],
        title: partsMatch?.[2],
        album: 'YouTube',
        // album: `YouTube - ${partsMatch?.[3]}`,
        track: { no: 1, of: 1 },
      },
      format: { duration },
    };
  }
  return tags;
}
