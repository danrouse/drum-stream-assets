import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

type DemucsModel =
  'htdemucs' | 'htdemucs_ft' | 'htdemucs_6s' | 'hdemucs_mmi' | 
  'mdx' | 'mdx_extra' | 'mdx_q' | 'mdx_extra_q';

export const DEFAULT_DEMUCS_MODEL: DemucsModel = 'htdemucs';

export default class Demucs {
  outputPath: string;
  model: string;
  onProcessingStart?: (query: string) => void;
  onProcessingComplete?: (query: string) => void;
  onProcessingError?: (query: string, errorMessage: string) => void;
  onProcessingProgress?: (query: string, progress: number) => void;
  
  private child?: ChildProcessWithoutNullStreams = undefined;
  private currentQuery?: string;
  private _queue: string[] = [];
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

  queue(query: string) {
    this._queue.push(query);
  }

  cancel(query: string) {
    if (query === this.currentQuery) {
      this.child?.kill();
    }
  }

  execute(query: string) {
    if (this.child) {
      throw new Error('already have a spawned process');
    }
    this.currentQuery = query;
    this.child = spawn(
      'demucs',
      [
        '-n', this.model || DEFAULT_DEMUCS_MODEL,
        '-o', `"${this.outputPath}"`,
        '-d', 'cuda',
        '--mp3',
        `"${query}"`
      ],
      { shell: true }
    );
    this.child.stderr.on('data', msg => {
      const strippedMessage = msg.toString().trim();
      // progress updates are logged to stderr with percentage and an ASCII loading bar
      const parsedProgress = strippedMessage.match(/^\s*(\d+)%/);
      if (parsedProgress) {
        const progressPercent = Number(parsedProgress[1]) / 100;
        if (this.onProcessingProgress) {
          this.onProcessingProgress(this.currentQuery!, progressPercent);
        }
      } else if (strippedMessage.includes('demucs.separate: error')) {
        if (this.onProcessingError) {
          this.onProcessingError(this.currentQuery!, strippedMessage); // jank
        }
      } else if (!strippedMessage.includes('Torch was not compiled with flash attention')) {
        // Just notify via logs, it's probably fine
        // Demucs spits out a fair amount of garbage in stderr sometimes
        console.debug('demucs unhandled stderr:\n', strippedMessage);
      }
    });
    this.child.on('close', () => {
      if (this.onProcessingComplete) {
        this.onProcessingComplete(this.currentQuery!);
      }
      this.cleanup();
    });
    this.child.on('error', (err) => {
      if (this.onProcessingError) {
        this.onProcessingError(this.currentQuery!, err.message);
      }
      this.cleanup();
    });
  }

  cleanup() {
    if (this.child?.connected) {
      this.child.kill();
    }
    delete this.child;
    delete this.currentQuery;
  }
}
