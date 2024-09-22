import { existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const writeSyricsConfig = () => {
  const configPath = join(
    process.env['APPDATA']!,
    'syrics',
    'config.json'
  );
  const spdcPath = join(
    __dirname,
    '../..',
    'sp_dc.txt'
  );
  // if (!exists)
  writeFileSync(configPath, JSON.stringify({
    sp_dc: readFileSync(spdcPath).toString(),
    download_path: join(__dirname, '..', 'downloads'),
    file_name: '{artist} - {name}',
    synced_lyrics: true,
    force_synced: true,

    // other defaults
    create_folder: true,
    album_folder_name: '{name} - {artists}',
    play_folder_name: '{name} - {owner}',
    force_download: false
  }));
};
