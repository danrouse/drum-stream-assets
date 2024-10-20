import { join } from 'path';
import { unlinkSync, existsSync, readFileSync, writeFileSync } from 'fs';
import Demucs from './wrappers/demucs';
import spotdl, { SongDownloadError, MAX_SONG_REQUEST_DURATION } from './wrappers/spotdl';
import getSongTags from './getSongTags';
import * as Paths from './paths';

interface DemucsCallback {
  song: DownloadedSong;
  callback: (song?: ProcessedSong) => void;
}

const updateSongRequestMetadata = (request: SongRequestSource, song: ProcessedSong) => {
  const jsonPath = join(Paths.__dirname, 'songrequests.json');
  const requests = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, 'utf-8')) : [];
  requests.push({
    ...request,
    ...song,
  } satisfies SongRequest);
  writeFileSync(jsonPath, JSON.stringify(requests, null, 2));
};

export default class SongRequestHandler {
  private demucs: Demucs;
  private demucsCallbacks: DemucsCallback[] = [];
  private broadcast: WebSocketBroadcaster;

  constructor(broadcast: WebSocketBroadcaster) {
    this.demucs = new Demucs(Paths.DEMUCS_OUTPUT_PATH);
    this.demucs.onProcessingStart = (song) => broadcast({ type: 'demucs_start', name: song.basename });
    this.demucs.onProcessingProgress = (song, progress) => broadcast({ type: 'demucs_progress', progress, name: song.basename });
    this.demucs.onProcessingComplete = (song) => {
      broadcast({ type: 'demucs_complete', stems: `/stems/${song.basename}` });
      this.demucsCallbacks.filter(s => s.song.basename === song.basename).forEach(s => s.callback(song));
      this.demucsCallbacks = this.demucsCallbacks.filter(s => s.song.basename !== song.basename);
    };
    this.demucs.onProcessingError = (song, errorMessage) => {
      broadcast({ type: 'demucs_error', message: errorMessage });
      this.demucsCallbacks.filter(s => s.song.basename === song.basename).forEach(s => s.callback());
      this.demucsCallbacks = this.demucsCallbacks.filter(s => s.song.basename !== song.basename);
    };

    this.broadcast = broadcast;
  }

  private processDownloadedSong(song: DownloadedSong, callback?: (song?: ProcessedSong) => void) {
    this.demucs.queue(song);
    if (callback) {
      this.demucsCallbacks.push({ song, callback });
    }
  }

  private async downloadSong(query: string) {
    console.info('Attempting to download:', query);
    this.broadcast({ type: 'download_start', query });
    const downloadedSong = await spotdl(query, Paths.DOWNLOADS_PATH);
  
    if (downloadedSong) {
      this.broadcast({ type: 'download_complete', name: downloadedSong.basename });
      console.info('Downloaded:', downloadedSong.basename);
    } else {
      this.broadcast({ type: 'download_error', query });
      console.info('Received no basename from spotdl');
    }
    return downloadedSong;
  }
  
  public execute(query: string, request?: SongRequestSource) {
    return new Promise<ProcessedSong>(async (resolve, reject) => {
      try {
        const downloadedSong = await this.downloadSong(query);
  
        if (downloadedSong) {
          const tags = await getSongTags(downloadedSong.path, true, Paths.DOWNLOADS_PATH);
          if (tags.format?.duration > MAX_SONG_REQUEST_DURATION) {
            reject(new SongDownloadError('TOO_LONG'));
          }

          this.processDownloadedSong(downloadedSong, (processedSong) => {
            if (processedSong) {
              console.info(`Song request added from request "${downloadedSong.basename}", broadcasting message...`);
              try { unlinkSync(Paths.SONG_LIST_PATH); } catch (e) {}
              if (request) updateSongRequestMetadata(request, processedSong);
              this.broadcast({ type: 'song_request_added', name: downloadedSong.basename });
              resolve(processedSong);
            } else {
              reject();
            }
          });
        } else {
          reject();
        }
      } catch (e) {
        reject(e);
      }
    });
  }
}
