import { spawn } from 'child_process';
import { join, basename } from 'path';
import * as Paths from '../paths';
import SongDownloadError from '../SongDownloadError';
import { DownloadedSong } from '../../../shared/messages';

interface YouTubeDownloadOptions {
  maxDuration: number,
  minViews: number,
}

export function downloadFromYouTube(url: URL, outputPath: string, options: Partial<YouTubeDownloadOptions>) {
  if (url.pathname.startsWith('/channel/') || url.pathname.startsWith('/playlist')) {
    throw new SongDownloadError('NO_PLAYLISTS');
  }

  return new Promise<DownloadedSong>((resolve, reject) => {
    const cmd = spawn(Paths.YT_DLP_PATH,
      [
        '--no-playlist',
        '--no-overwrites',
        ...(options.maxDuration ? ['--match-filter', `"duration<${options.maxDuration}"`] : []),
        ...(options.minViews ? ['--min-views', String(options.minViews)] : []),
        // '--min-views', '1000',
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
      } else if (msg.toString().match('Sign in to confirm your age')) {
        reject(new SongDownloadError('AGE_RESTRICTED'));
      } else {
        console.warn('yt-dlp.exe stderr:', msg.toString());
      }
    });
    cmd.stdout.on('data', msg => {
      if (msg.toString().match(/\[download\] (.+) does not pass filter \(duration\)/)) {
        return reject(new SongDownloadError('TOO_LONG'));
      } else if (msg.toString().match('because it has not reached minimum view count')) {
        return reject(new SongDownloadError('MINIMUM_VIEWS'));
      }
      const downloadMatch = msg.toString().match(/^\[download\] Destination: (.+)/);
      const dupeMatch = msg.toString().match(/^\[download\] (.+) has already been downloaded/);
      const mergeMatch = msg.toString().match(/^\[Merger\] Merging formats into "(.+)"/);
      const match = downloadMatch || dupeMatch || mergeMatch;
      if (match) {
        downloadedSong = {
          basename: basename(match[1]).replace(/\.(m4a|mkv|mp4|ogg|webm|flv)$/i, ''),
          path: match[1],
          isVideo: true,
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
