import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export const __dirname = dirname(fileURLToPath(import.meta.url));

export const DOWNLOADS_PATH = join(__dirname, '..', 'music-stem-server', 'library', 'downloads');
export const DEMUCS_OUTPUT_PATH = join(__dirname, '..', 'music-stem-server', 'library', 'separated');
// this points to htdemucs directly - we've changed the model to htdemucs_ft
// however htdemucs_ft is symlinked to the original htdemucs,
// so all stems are still stored in the htdemucs directory
export const STEMS_PATH = join(DEMUCS_OUTPUT_PATH, 'htdemucs');

export const STATIC_ASSETS_PATH = join(__dirname, '..', 'music-stem-server', 'static');
export const PLAYER_DIST = join(__dirname, '..', 'music-stem-server', 'player', 'dist');
