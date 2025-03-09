import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export const __dirname = dirname(fileURLToPath(import.meta.url));

export const DOWNLOADS_PATH = join(__dirname, '..', 'music-stem-server', 'library', 'downloads');
export const DEMUCS_OUTPUT_PATH = join(__dirname, '..', 'music-stem-server', 'library', 'separated');
export const STEMS_PATH = join(DEMUCS_OUTPUT_PATH, 'htdemucs'); // not using DEFAULT_DEMUCS_MODEL hm

export const STATIC_ASSETS_PATH = join(__dirname, '..', 'music-stem-server', 'static');
export const PLAYER_DIST = join(__dirname, '..', 'music-stem-server', 'player', 'dist');

export const YT_DLP_PATH = join(__dirname, '..', 'bin', 'yt-dlp.exe');
