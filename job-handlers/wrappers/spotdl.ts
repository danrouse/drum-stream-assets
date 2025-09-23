import { spawn } from 'child_process';
import { join, resolve as resolvePath } from 'path';
import { existsSync, unlinkSync } from 'fs';
import { sleep } from '../../shared/util';

const TMP_OUTPUT_FILENAME = 'tmp.spotdl';

export async function downloadFromSpotDL(query: string, outputPath: string, uuid: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    while (existsSync(TMP_OUTPUT_FILENAME)) {
      try {
        unlinkSync(TMP_OUTPUT_FILENAME);
      } catch (e) {}
      await sleep(1000);
    };
    const cmd = spawn('spotdl',
      [
        '--output', `"${join(outputPath, `${uuid}.{output-ext}`)}"`,
        '--skip-album-art',
        // m4a + bitrate disable + YouTube Premium cookies
        // result in highest quality output
        '--format', 'm4a',
        '--bitrate', 'disable',
        '--cookie-file', `"${resolvePath('..', '..', 'youtube_cookies.txt')}"`,
        '--lyrics', 'synced',
        '--generate-lrc',
        'download', `"${query}"`,
      ],
      {
        shell: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      }
    );
    let resolveTo: string | undefined;
    let buf: string = '';
    cmd.stdout.on('data', msg => {
      buf += msg.toString().replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
      const wasDownloaded = buf.match(/Downloaded "(.+)":/i);
      const alreadyExists = buf.match(/Skipping (.+) \(file already exists\)/i);

      if (wasDownloaded || alreadyExists) {
        const dstPath = join(outputPath, `${uuid}.m4a`);
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
