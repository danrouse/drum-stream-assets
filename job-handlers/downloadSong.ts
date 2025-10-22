import { downloadFromYouTube } from './wrappers/yt-dlp';
import { downloadFromSpotDL } from './wrappers/spotdl';
import { isURL } from '../shared/util';
import { SongDownloadErrorTypes } from '../shared/SongDownloadError';

interface SongDownloadOptions {
  maxDuration: number,
  minViews: number,
}

export default async function downloadSong(
  query: string,
  outputPath: string,
  uuid: string,
  options: Partial<SongDownloadOptions> = {}
) {
  try {
    if (isURL(query)) {
      const url = new URL(query);
      const host = url.host.toLowerCase();
      const youTubeMatch = host.match(/^((www|m|music)\.)?(youtube\.com|youtu.be)/);
      const spotifyMatch = host.match(/^(open\.)?spotify\.com/);
      if (youTubeMatch) {
        const htmlText = (await fetch(url)).text();
        const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(htmlText);
        const title = match ? match[1].replace(/\s+/g, " ").trim() : "";
        if (! /creed/i.test(title)) {
          throw new Error('NO_CREED');
        }
        return await downloadFromYouTube(url, outputPath, uuid, options);
      } else if (spotifyMatch) {
        if (!url.pathname.includes('/track/')) {
          throw new Error('NO_PLAYLISTS');
        }
      } else {
        throw new Error('UNSUPPORTED_DOMAIN');
      }
    }
    return await downloadFromSpotDL(query, outputPath, uuid);
  } catch (err) {
    if (err instanceof Error && SongDownloadErrorTypes.includes(err.message)) throw err;
    throw new Error();
  }
}
