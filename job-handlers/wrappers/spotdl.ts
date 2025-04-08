import { execSync, spawn } from 'child_process';
import { join, resolve as resolvePath } from 'path';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { sleep } from '../../shared/util';

const TMP_OUTPUT_FILENAME = 'tmp.spotdl';

export async function downloadFromSpotDL(query: string, outputPath: string): Promise<string> {
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
        '--cookie-file', `"${resolvePath('..', '..', 'youtube_cookies.txt')}"`,
        'download', `"${query}"`,
      ],
      { shell: true }
    );
    let resolveTo: string | undefined;
    let buf: string = '';
    cmd.stdout.on('data', msg => {
      buf += msg.toString().replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
      const wasDownloaded = buf.match(/Downloaded "(.+)":/i);
      const alreadyExists = buf.match(/Skipping (.+) \(file already exists\)/i);

      if (wasDownloaded || alreadyExists) {
        const basename = (wasDownloaded || alreadyExists)![1]
          .replace(/:/g, '-')
          .replace(/\?/g, '')
          .replace(/"/g, "'")
          .replace(/\//g, '')
          .replace(/\*/g, '');
        const dstPath = join(outputPath, `${basename}.m4a`);
        // Double check that the expected path exists first!
        if (existsSync(dstPath)) {
          resolveTo = dstPath;
        } else {
          reject(new Error());
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
          unlinkSync(TMP_OUTPUT_FILENAME);
        } catch (e) {
          // If syrics failed, oh well, too bad. It's probably just sp_dc, right?
          // COPIUM
          // NB: This is not needed to fix since we're (HOPEFULLY) moving off syrics soon
          console.error('syrics error', e);
        }
        resolve(resolveTo);
      } else {
        console.debug('spotdl failed as it did not match a valid return string');
        console.debug(buf);
        reject(new Error());
      }
    });
    cmd.on('error', () => {
      reject(new Error());
    });
  });
}
