import { readdirSync } from 'fs';
import { join } from 'path';
import { parseFile } from 'music-metadata';
import NodeID3 from 'node-id3tag';

export default async function copyID3Tags(source: string, dstDir: string) {
  // This is jank as hell but I don't feel like looking for more libraries
  // const { parseFile } = await loadMusicMetadata();
  const tags = await parseFile(source);
  for (let file of readdirSync(dstDir)) {
    if (file.endsWith('.mp3')) {
      NodeID3.write(tags.common, join(dstDir, file));
    }
  }
}
