import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync, readFileSync, unlinkSync } from 'fs';

const TMP_OUTPUT_FILENAME = 'tmp.spotdl';

const isURL = (s: string) => {
  try {
    return Boolean(new URL(s));
  } catch (err) {
    return false;
  }
};

export default function spotdl(query: string, outputPath: string, cookies: string) {
  try {
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
        // Load spotdl's output for raw spotify URL
        // to pass to syrics to download synced lyrics from spotify
        // (Yes, this is incredibly jank)
        // spotdl can't download lyrics from spotify itself,
        // and syrics needs a direct URL
        // We're going to just set it and forget it
        // If it blows up, oh well, that's too bad
        const song = JSON.parse(readFileSync(TMP_OUTPUT_FILENAME).toString('utf8'));
        execSync(`syrics "${song[0].url}"`);
        unlinkSync(TMP_OUTPUT_FILENAME);
        return basename;
      } else {
        console.log('dstpath doesnt exist', dstPath);
      }
    }
    console.debug('spotdl failed as it did not match a valid return string');
    console.debug(stdout);
    return false;
  } catch (err) {
    console.debug('spotdl failed as an error was thrown');
    return false;
  }
}
