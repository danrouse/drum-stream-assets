import Demucs from './wrappers/demucs';
import spotdl, { SongDownloadError, MAX_SONG_REQUEST_DURATION } from './wrappers/spotdl';
import getSongTags from './getSongTags';
import * as Paths from './paths';
import { db, Song } from './database';
import { SongRequestSource, ProcessedSong, DownloadedSong, WebSocketBroadcaster } from '../../shared/messages';

interface DemucsCallback {
  song: DownloadedSong;
  callback: (song?: ProcessedSong, isDuplicate?: boolean) => void;
}

export default class SongRequestHandler {
  private demucs: Demucs;
  private demucsCallbacks: DemucsCallback[] = [];
  private broadcast: WebSocketBroadcaster;

  constructor(broadcast: WebSocketBroadcaster) {
    this.demucs = new Demucs(Paths.DEMUCS_OUTPUT_PATH);
    this.demucs.onProcessingStart = (song) => broadcast({ type: 'demucs_start', name: song.basename });
    this.demucs.onProcessingProgress = (song, progress) => broadcast({ type: 'demucs_progress', progress, name: song.basename });
    this.demucs.onProcessingComplete = async (song, isDuplicate) => {      
      for (let callback of this.demucsCallbacks.filter(s => s.song.basename === song.basename)) {
        await callback.callback(song, isDuplicate);
      }
      this.demucsCallbacks = this.demucsCallbacks.filter(s => s.song.basename !== song.basename);
      broadcast({ type: 'demucs_complete', stems: `/stems/${song.basename}` });
    };
    this.demucs.onProcessingError = async (song, errorMessage) => {
      for (let callback of this.demucsCallbacks.filter(s => s.song.basename === song.basename)) {
        await callback.callback();
      }
      this.demucsCallbacks = this.demucsCallbacks.filter(s => s.song.basename !== song.basename);
      broadcast({ type: 'demucs_error', message: errorMessage });
    };

    this.broadcast = broadcast;
  }

  private processDownloadedSong(song: DownloadedSong, callback?: (song?: ProcessedSong, isDuplicate?: boolean) => void) {
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
          const tags = await getSongTags(downloadedSong.path);
          if (tags.format?.duration > MAX_SONG_REQUEST_DURATION) {
            reject(new SongDownloadError('TOO_LONG'));
          }

          const songRequest = await db.insertInto('songRequests').values({
            query,
            priority: 0,
            order: 0,
            status: 'processing',
            requester: request?.requesterName,
            twitchRewardId: request?.rewardId,
            twitchRedemptionId: request?.redemptionId,
            isMeme: request?.isMeme || false,
          }).returning('id as id').execute();
          const download = await db.insertInto('downloads').values({
            path: downloadedSong.path,
            lyricsPath: downloadedSong.lyricsPath,
            isVideo: Number(downloadedSong.isVideo),
            songRequestId: songRequest[0].id,
          }).returning('id as id').execute();

          this.processDownloadedSong(downloadedSong, async (processedSong, isDuplicate) => {
            if (processedSong) {
              let song: Partial<Song>[];
              if (isDuplicate) {
                song = await db.selectFrom('songs')
                  .select('id')
                  .where('stemsPath', '=', processedSong.stemsPath)
                  .execute();
              } else {
                song = await db.insertInto('songs').values({
                  artist: String(tags.common?.artist) || '',
                  title: String(tags.common?.title) || '',
                  album: String(tags.common?.album) || '',
                  track: Number(tags.common?.track.no),
                  duration: Number(tags.format!.duration),
                  stemsPath: processedSong.stemsPath,
                  downloadId: download[0].id,
                }).returning('id as id').execute();
              }
              // TODO: calculate ordering here and update in this request
              await db.updateTable('songRequests')
                .set({ status: 'ready', songId: song[0].id })
                .where('id', '=', songRequest[0].id)
                .execute();
              console.info(`Song request added from request "${downloadedSong.basename}", broadcasting message...`);
              this.broadcast({ type: 'song_requests_updated' });
              resolve(processedSong);
            } else {
              await db.updateTable('songRequests')
                .set({ status: 'cancelled' })
                .where('id', '=', songRequest[0].id)
                .execute();
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
