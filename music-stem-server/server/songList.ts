import { join } from 'path';
import { readdirSync, statSync } from 'fs';
import getSongTags from './getSongTags';
import * as Paths from './paths';

export default async function generateSongList() {
  const output: SongData[] = [];
  const stemmedSongs = readdirSync(Paths.STEMS_PATH)
    .filter(s => statSync(join(Paths.STEMS_PATH, s)).isDirectory());
  for (let songBasename of stemmedSongs) {
    const stems = readdirSync(join(Paths.STEMS_PATH, songBasename));
    if (!stems.length) continue;
    const stat = statSync(join(Paths.STEMS_PATH, songBasename, stems[0]));
    const tags = await getSongTags(songBasename, false, Paths.DOWNLOADS_PATH);
    output.push({
      name: songBasename,
      artist: String(tags.common?.artist) || '',
      title: String(tags.common?.title) || '',
      stems: stems,
      downloadDate: stat.mtime,
      album: String(tags.common?.album) || '',
      track: [tags.common?.track.no || 1, tags.common?.track.of || 1],
      duration: tags.format?.duration,
    });
  }
  return output;
}
