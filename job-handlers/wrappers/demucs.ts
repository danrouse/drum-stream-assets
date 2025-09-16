import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, basename } from 'path';

type DemucsModel =
  'htdemucs' | 'htdemucs_ft' | 'htdemucs_6s' | 'hdemucs_mmi' |
  'mdx' | 'mdx_extra' | 'mdx_q' | 'mdx_extra_q';

export const DEFAULT_DEMUCS_MODEL: DemucsModel = 'htdemucs_ft';

export default function demucs(
  inputPath: string,
  outputPath: string,
  ignoreDuplicates: boolean = true,
  model: DemucsModel = DEFAULT_DEMUCS_MODEL
) {
  const songBasename = basename(inputPath).replace(/\..{3,4}$/i, '');

  return new Promise<string>((resolve, reject) => {
    // check to see if it's not already been processed first
    const dstPath = join(outputPath, model, songBasename.replace(/\.$/, ''));
    if (existsSync(dstPath) && ignoreDuplicates) {
      console.log('demucs output already exists, skipping');
      return resolve(dstPath);
    }
    const args = [
      '-n', model,
      '-o', `"${outputPath}"`,
      '-d', 'cuda',
      '--mp3',
      `"${inputPath}"`
    ];
    console.info('Spawning demucs on', inputPath);
  
    const child = spawn(
      'demucs',
      args,
      { shell: true }
    );
    child.stderr.on('data', msg => {
      const strippedMessage = msg.toString().replace(/[\r\n]/g, '').replace(/[\udc00|\udb40]/g, '').trim()
      // progress updates are logged to stderr with percentage and an ASCII loading bar
      const parsedProgress = strippedMessage.match(/^\s*(\d+)%/);
      if (parsedProgress) {
        // const progressPercent = Number(parsedProgress[1]) / 100;
        // if (onProcessingProgress) {
        //   onProcessingProgress(song, progressPercent);
        // }
      } else if (strippedMessage.includes('demucs.separate: error')) {
        return reject(strippedMessage);
      } else if (strippedMessage.includes('Torch was not compiled with flash attention')) {
        // ignore this garbage...
        // Did I mention that I have a problem with python because of its ecosystem?
      }
    });
    child.on('close', () => {
      return resolve(dstPath.replace(join(outputPath, model), '').replace(/^[/\\]+/, ''));
    });
    child.on('error', (err) => {
      return reject(err.message);
    });
  });
}
