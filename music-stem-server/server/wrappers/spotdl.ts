import { execSync, spawn } from 'child_process';
import { join, basename } from 'path';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import * as Paths from '../paths';

const TMP_OUTPUT_FILENAME = 'tmp.spotdl';
const YT_DLP_PATH = 'C:/Users/Dan/Downloads/yt-dlp.exe';

export type SongDownloadErrorType = 'GENERIC' | 'UNSUPPORTED_DOMAIN' | 'DOWNLOAD_FAILED' | 'VIDEO_UNAVAILABLE' | 'NO_PLAYLISTS' | 'TOO_LONG';
export class SongDownloadError extends Error {
  type: SongDownloadErrorType;
  constructor(type: SongDownloadErrorType = 'DOWNLOAD_FAILED') {
    super();
    this.type = type;
  }
}

const isURL = (s: string) => {
  try {
    return Boolean(new URL(s));
  } catch (err) {
    return false;
  }
};

export const MAX_SONG_REQUEST_DURATION = 600;
function handleYouTubeDownload(url: URL, outputPath: string) {
  return new Promise<DownloadedSong>((resolve, reject) => {
    const cmd = spawn(YT_DLP_PATH,
      [
        '--no-playlist',
        '--no-overwrites',
        '--match-filter', `"duration<${MAX_SONG_REQUEST_DURATION}"`,
        // '--max-downloads', '1',
        '--cookies', `"${join(Paths.__dirname, '..', 'www.youtube.com_cookies.txt')}"`,
        '-f', '"bv[height<=?720]+ba"',
        '-S', '"filesize:50M"',
        '--output', `"${join(outputPath, '%(artist|YouTube)s - %(fulltitle)s [%(id)s].%(ext)s')}"`,
        `"${url.toString()}"`
      ],
      { shell: true }
    );
    let downloadedSong: DownloadedSong | undefined;
    cmd.stderr.on('data', msg => {
      const unavailableMatch = msg.toString().match(/\[youtube\] (.+): Video unavailable(.*)/);
      if (unavailableMatch) {
        console.warn(`YouTube video ${unavailableMatch[1]} not available: ${unavailableMatch[2]}`);
        reject(new SongDownloadError('VIDEO_UNAVAILABLE'));
      } else if (msg.toString().match(/\[youtube:tab\] YouTube said: The playlist does not exist/)) {
        reject(new SongDownloadError('VIDEO_UNAVAILABLE'));
      } else {
        console.warn('yt-dlp.exe stderr:', msg.toString());
      }
    });
    cmd.stdout.on('data', msg => {
      if (msg.toString().match(/\[download\] (.+) does not pass filter \(duration/)) {
        return reject(new SongDownloadError('TOO_LONG'));
      }
      const downloadMatch = msg.toString().match(/^\[download\] Destination: (.+)/);
      const dupeMatch = msg.toString().match(/^\[download\] (.+) has already been downloaded/);
      const mergeMatch = msg.toString().match(/^\[Merger\] Merging formats into "(.+)"/);
      const match = downloadMatch || dupeMatch || mergeMatch;
      if (match) {
        downloadedSong = {
          basename: basename(match[1]).replace(/\.(m4a|mkv|mp4|ogg|webm|flv)$/i, ''),
          path: match[1],
        };
      }
    });
    cmd.on('close', () => {
      if (downloadedSong) return resolve(downloadedSong);
      reject(new SongDownloadError('DOWNLOAD_FAILED'));
    });
    cmd.on('error', (err) => {
      console.error('Song download error', err);
      reject(new SongDownloadError('DOWNLOAD_FAILED'));
    });
  });
}
const sleep = (t: number) => new Promise<void>((resolve) => setTimeout(() => resolve(), t));
export default async function spotdl(query: string, outputPath: string, cookies: string): Promise<DownloadedSong> {
  try {
    if (isURL(query)) {
      const url = new URL(query);
      const host = url.host.toLowerCase();
      const youTubeMatch = host.match(/^((www|m|music)\.)?(youtube\.com|youtu.be)/);
      const spotifyMatch = host.match(/^(open\.)?spotify\.com/);
      if (youTubeMatch) {
        if (url.pathname.startsWith('/channel/') || url.pathname.startsWith('/playlist')) {
          throw new SongDownloadError('NO_PLAYLISTS');
        }
        return await handleYouTubeDownload(url, outputPath);
      } else if (spotifyMatch) {
        if (!url.pathname.startsWith('/track/')) {
          throw new SongDownloadError('NO_PLAYLISTS');
        }
      } else {
        throw new SongDownloadError('UNSUPPORTED_DOMAIN');
      }
    }

    return new Promise(async (resolve, reject) => {
      while (existsSync(TMP_OUTPUT_FILENAME)) {
        try { 
          unlinkSync(TMP_OUTPUT_FILENAME);
        } catch (e) {}
        await sleep(1000);
      };
      const cmd = spawn('spotdl',
        [
          '--output', `"${join(outputPath, '{artist} - {title}.{output-ext}')}"`,
          '--save-file', TMP_OUTPUT_FILENAME,
          '--skip-album-art',
          // m4a + bitrate disable + YouTube Premium cookies
          // result in highest quality output
          '--format', 'm4a',
          '--bitrate', 'disable',
          '--cookie-file', `"${cookies}"`,
          'download', `"${isURL(query) ? query : `'${query}'`}"`,
        ],
        { shell: true }
      );
      let resolveTo: DownloadedSong | undefined;
      cmd.stdout.on('data', msg => {
        const wasDownloaded = msg.toString().match(/Downloaded "(.+)":/i);
        const alreadyExists = msg.toString().match(/Skipping (.+) \(file already exists\)/i);

        if (wasDownloaded || alreadyExists) {
          const basename = (wasDownloaded || alreadyExists)![1].replace(/:/g, '-').replace(/\?/g, '');
          const dstPath = join(outputPath, `${basename}.m4a`);
          // Double check that the expected path exists first!
          if (existsSync(dstPath)) {
            resolveTo = {
              basename,
              path: dstPath,
            };
          } else {
            reject(new SongDownloadError());
          }
        }
      });
      cmd.on('close', () => {
        if (resolveTo) {
          try {
            // Load spotdl's output for raw spotify URL
            // to pass to syrics to download synced lyrics from spotify.
            // spotdl can't download lyrics from spotify itself,
            // so its lyrics are often unsynced (no timestamps)
            // and syrics needs a direct URL
            const t = readFileSync(TMP_OUTPUT_FILENAME).toString('utf8');
            const song = JSON.parse(t);
            execSync(`syrics "${song[0].url}"`);
          } catch (e) {
            // If syrics failed, oh well, too bad. It's probably just sp_dc, right?
            // COPIUM
            // NB: This is not needed to fix since we're (HOPEFULLY) moving off syrics soon
            console.error('syrics error', e);
          } finally {
            unlinkSync(TMP_OUTPUT_FILENAME);
          }
          resolve(resolveTo);
        } else {
          console.debug('spotdl failed as it did not match a valid return string');
          reject(new SongDownloadError());
        }
      });
      cmd.on('error', () => {
        reject(new SongDownloadError());
      });
    });
  } catch (err) {
    if (err instanceof SongDownloadError) throw err;
    throw new SongDownloadError();
  }
}
