import { execSync, spawn } from 'child_process';
import { join, basename } from 'path';
import { existsSync, readFileSync, unlinkSync } from 'fs';

const TMP_OUTPUT_FILENAME = 'tmp.spotdl';

export type SongDownloadErrorType = 'GENERIC' | 'UNSUPPORTED_DOMAIN' | 'DOWNLOAD_FAILED' | 'VIDEO_UNAVAILABLE';
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

function handleYouTubeDownload(url: URL, outputPath: string) {
  return new Promise<string>((resolve, reject) => {
    const cmd = spawn('C:/Users/Dan/Downloads/yt-dlp.exe', // TODO: lol
      [
        '--no-playlist',
        '--no-overwrites',
        // '--max-downloads', '1',
        '-f', '"[height <=? 720]+bestaudio"',
        '--output', `"${join(outputPath, '%(artist|YouTube)s - %(fulltitle)s %(id)s.%(ext)s')}"`,
        `"${url.toString()}"`
      ],
      { shell: true }
    );
    let downloadedBasename = '';
    cmd.stderr.on('data', msg => {
      if (msg.toString().match(/\[youtube\] (.+): Video unavailable/)) {
        throw new SongDownloadError('VIDEO_UNAVAILABLE');
      }
      console.log('stderr', msg.toString());
    });
    cmd.stdout.on('data', msg => {
      const downloadMatch = msg.toString().match(/^\[download\] Destination: (.+)/);
      const dupeMatch = msg.toString().match(/^\[download\] (.+) has already been downloaded/);
      const mergeMatch = msg.toString().match(/^\[Merger\] Merging formats into "(.+)"/);
      if (downloadMatch) {
        downloadedBasename = basename(downloadMatch[1]);
      } else if (dupeMatch) {
        downloadedBasename = basename(dupeMatch[1]);
      } else if (mergeMatch) {
        downloadedBasename = basename(mergeMatch[1]);
      }
      // console.log('stdout', msg.toString(), dupeMatch);
    });
    cmd.on('close', () => {
      if (downloadedBasename) return resolve(downloadedBasename);
      console.error('yt-dlp closed without returning a filename');
      reject(new SongDownloadError('DOWNLOAD_FAILED'));
    });
    cmd.on('error', (err) => {
      console.error('Song download error', err);
      reject(new SongDownloadError('DOWNLOAD_FAILED'));
    });
  });
}

export default async function spotdl(query: string, outputPath: string, cookies: string) {
  try {
    if (isURL(query)) {
      const url = new URL(query);
      const domain = url.host.toLowerCase().replace(/^www\./, '');
      if (domain === 'youtube.com') {
        return await handleYouTubeDownload(url, outputPath);
      } else if (domain === 'spotify.com' || domain === 'open.spotify.com') {
      } else {
        // TODO: better messaging
        throw new SongDownloadError('UNSUPPORTED_DOMAIN');
      }
    }

    const cmd = [
      'spotdl',
      '--output', `"${join(outputPath, '{artist} - {title}.{output-ext}')}"`,
      '--save-file', TMP_OUTPUT_FILENAME,
      '--skip-album-art',
      // m4a + bitrate disable + YouTube Premium cookies
      // result in highest quality output
      '--format', 'm4a',
      '--bitrate', 'disable',
      '--cookie-file', `"${cookies}"`,
      'download', `"${isURL(query) ? query : `'${query}'`}"`,
    ].join(' ');

    const stdout = execSync(cmd, { encoding: 'utf8' })
      .replace(/\s+/g, ' ');

    // It's tricky to find the paths that spotdl saved to,
    // try to parse them from its string output.
    const wasDownloaded = stdout.match(/Downloaded "(.+)":/i);
    const alreadyExists = stdout.match(/Skipping (.+) \(file already exists\)/i);
    // console.log('what the fuck', stdout, wasDownloaded, alreadyExists);
    if (wasDownloaded || alreadyExists) {
      const basename = (wasDownloaded || alreadyExists)![1].replace(/:/g, '-').replace(/\?/g, '');
      const dstPath = join(outputPath, `${basename}.m4a`);
      // Double check that the expected path exists first!
      if (existsSync(dstPath)) {
        try {
          // Load spotdl's output for raw spotify URL
          // to pass to syrics to download synced lyrics from spotify.
          // spotdl can't download lyrics from spotify itself,
          // so its lyrics are often unsynced (no timestamps)
          // and syrics needs a direct URL
          const song = JSON.parse(readFileSync(TMP_OUTPUT_FILENAME).toString('utf8'));
          execSync(`syrics "${song[0].url}"`);
        } catch (e) {
          // If syrics failed, oh well, too bad. It's probably just sp_dc, right?
          // COPIUM
          // NB: This is not needed to fix since we're (HOPEFULLY) moving off syrics soon
        }
        unlinkSync(TMP_OUTPUT_FILENAME);
        return basename;
      } else {
        console.log('dstpath doesnt exist', dstPath);
      }
    }
    console.debug('spotdl failed as it did not match a valid return string');
    console.debug(stdout);
    throw new SongDownloadError();
  } catch (err) {
    console.debug('spotdl failed as an error was thrown');
    if (err instanceof SongDownloadError) throw err;
    throw new SongDownloadError();
  }
}
