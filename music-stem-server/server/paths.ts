import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_DEMUCS_MODEL } from './wrappers/demucs';

export const __dirname = dirname(fileURLToPath(import.meta.url));
export const DOWNLOADS_PATH = join(__dirname, 'downloads');
export const DEMUCS_OUTPUT_PATH = join(__dirname, 'separated');
export const STEMS_PATH = join(DEMUCS_OUTPUT_PATH, DEFAULT_DEMUCS_MODEL);
export const STATIC_ASSETS_PATH = join(__dirname, '..', 'static');
export const SONG_LIST_PATH = join(__dirname, 'songlist.json');
export const PLAYER_DIST = join(__dirname, '..', 'player', 'dist');

export const YT_DLP_PATH = join(__dirname, '..', '..', 'bin', 'yt-dlp.exe');
