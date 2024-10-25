import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { ProcessedSong, DownloadedSong } from '../../../shared/messages';

type DemucsModel =
  'htdemucs' | 'htdemucs_ft' | 'htdemucs_6s' | 'hdemucs_mmi' | 
  'mdx' | 'mdx_extra' | 'mdx_q' | 'mdx_extra_q';

export const DEFAULT_DEMUCS_MODEL: DemucsModel = 'htdemucs';

export default class Demucs {
  outputPath: string;
  model: string;
  onProcessingStart?: (song: DownloadedSong) => void;
  onProcessingError?: (song: DownloadedSong, errorMessage: string) => void;
  onProcessingProgress?: (song: DownloadedSong, progress: number) => void;
  onProcessingComplete?: (song: ProcessedSong) => void;
  
  private child?: ChildProcessWithoutNullStreams = undefined;
  private _queue: DownloadedSong[] = [];
  private interval: NodeJS.Timeout;

  static POLL_INTERVAL = 500;

  constructor(outputPath: string, model = DEFAULT_DEMUCS_MODEL) {
    this.outputPath = outputPath;
    this.model = model;
    this.interval = setInterval(() => this.handleTimer(), Demucs.POLL_INTERVAL);
  }

  handleTimer() {
    if (!this.child && this._queue.length > 0) {
      const request = this._queue.shift();
      this.execute(request!);
    }
  }

  queue(song: DownloadedSong) {
    this._queue.push(song);
  }

  cancel() {
    this.child?.kill();
  }

  execute(song: DownloadedSong) {
    if (this.child) {
      throw new Error('already have a spawned process');
    }
    // check to see if it's not already been processed first
    const dstPath = join(this.outputPath, this.model || DEFAULT_DEMUCS_MODEL, song.basename.replace(/\.$/, ''));
    if (existsSync(dstPath)) {
      if (this.onProcessingComplete) {
        this.onProcessingComplete({
          basename: song.basename,
          songPath: song.path,
          stemsPath: dstPath,
        });
      }
      return;
    }
    const args = [
      '-n', this.model || DEFAULT_DEMUCS_MODEL,
      '-o', `"${this.outputPath}"`,
      '-d', 'cuda',
      '--mp3',
      `"${song.path}"`
    ];
    console.info('Spawning demucs on', song.path);
    this.child = spawn(
      'demucs',
      args,
      { shell: true }
    );
    this.child.stderr.on('data', msg => {
      const strippedMessage = msg.toString().replace(/[\r\n]/g, '').replace(/[\udc00|\udb40]/g, '').trim()
      // progress updates are logged to stderr with percentage and an ASCII loading bar
      const parsedProgress = strippedMessage.match(/^\s*(\d+)%/);
      if (parsedProgress) {
        const progressPercent = Number(parsedProgress[1]) / 100;
        if (this.onProcessingProgress) {
          this.onProcessingProgress(song, progressPercent);
        }
      } else if (strippedMessage.includes('demucs.separate: error')) {
        if (this.onProcessingError) {
          this.onProcessingError(song, strippedMessage); // jank
        }
      } else if (strippedMessage.includes('Torch was not compiled with flash attention')) {
        // ignore this garbage...
        // Did I mention that I have a problem with python because of its ecosystem?
      }
    });
    this.child.on('close', () => {
      if (this.onProcessingComplete) {
        this.onProcessingComplete({
          basename: song.basename,
          songPath: song.path,
          stemsPath: dstPath,
        });
      }
      this.cleanup();
    });
    this.child.on('error', (err) => {
      if (this.onProcessingError) {
        this.onProcessingError(song, err.message);
      }
      this.cleanup();
    });
  }

  cleanup() {
    if (this.child?.connected) {
      this.child.kill();
    }
    delete this.child;
  }
}
