import { downloadFromYouTube } from './wrappers/yt-dlp';
import { downloadFromSpotDL } from './wrappers/spotdl';
import SongDownloadError from './SongDownloadError';
import { isURL } from '../../shared/util';

interface SongDownloadOptions {
  maxDuration: number,
  minViews: number,
}

export default async function downloadSong(query: string, outputPath: string, options: Partial<SongDownloadOptions> = {}) {
  try {
    if (isURL(query)) {
      const url = new URL(query);
      const host = url.host.toLowerCase();
      const youTubeMatch = host.match(/^((www|m|music)\.)?(youtube\.com|youtu.be)/);
      const spotifyMatch = host.match(/^(open\.)?spotify\.com/);
      if (youTubeMatch) {
        return await downloadFromYouTube(url, outputPath, options);
      } else if (spotifyMatch) {
        if (!url.pathname.includes('/track/')) {
          throw new SongDownloadError('NO_PLAYLISTS');
        }
      } else {
        throw new SongDownloadError('UNSUPPORTED_DOMAIN');
      }
    }
    return await downloadFromSpotDL(query, outputPath);
  } catch (err) {
    if (err instanceof SongDownloadError) throw err;
    throw new SongDownloadError();
  }
}
