import { execSync } from 'child_process';
import { basename } from 'path';
import Demucs from './wrappers/demucs';
import spotdl, { SongDownloadError } from './wrappers/spotdl';
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

  private processDownloadedSong(
    song: DownloadedSong,
    callback?: (song?: ProcessedSong, isDuplicate?: boolean) => void,
    ignoreDuplicates: boolean = true
  ) {
    console.info(`Running ffmpeg-normalize on ${song.basename}`);
    try {
      execSync(`ffmpeg-normalize "${song.path}" -o "${song.path}" -c:a aac -nt rms -t -16 -f`);
    } catch (e) {
      // Let any errors pass, no big deal
    }
    this.demucs.queue(song, ignoreDuplicates);
    if (callback) {
      this.demucsCallbacks.push({ song, callback });
    }
  }

  public async reprocessSong(songId: number) {
    const song = await db.selectFrom('songs')
      .innerJoin('downloads', 'songs.downloadId', 'downloads.id')
      .select(['downloads.path', 'downloads.isVideo', 'songs.stemsPath'])
      .where('songs.id', '=', songId)
      .execute();
    return new Promise<ProcessedSong | undefined>((resolve) => {
      this.processDownloadedSong({
        basename: basename(song[0].path).substring(0, basename(song[0].path).lastIndexOf('.')),
        isVideo: Boolean(song[0].isVideo),
        path: song[0].path,
      }, (processedSong, isDuplicate) => {
        resolve(processedSong);
      }, false);
    });
  }

  private async downloadSong(query: string, maxDuration: number) {
    console.info('Attempting to download:', query);
    this.broadcast({ type: 'download_start', query });
    const downloadedSong = await spotdl(query, Paths.DOWNLOADS_PATH, maxDuration);
  
    if (downloadedSong) {
      this.broadcast({ type: 'download_complete', name: downloadedSong.basename });
      console.info('Downloaded:', downloadedSong.basename);
    } else {
      this.broadcast({ type: 'download_error', query });
      console.info('Received no basename from spotdl');
    }
    return downloadedSong;
  }

  public async getNextSongRequestByRequester(requester: string) {
    const res = await db.selectFrom('songRequests')
      .innerJoin('songs', 'songs.id', 'songRequests.songId')
      .selectAll('songRequests')
      .select(['songs.title', 'songs.artist'])
      .where('songRequests.status', '=', 'ready')
      .where('songRequests.requester', '=', requester)
      .limit(1)
      .orderBy(['songRequests.priority desc', 'songRequests.id asc'])
      .execute();
    return res[0];
  }

  public async getTimeUntilSongRequest(songRequestId: number) {
    const priority = await db.selectFrom('songRequests').select('priority').where('id', '=', songRequestId).execute();
    const precedingRequests = await db.selectFrom('songRequests')
      .innerJoin('songs', 'songs.id', 'songRequests.songId')
      .select(db.fn.sum('duration').as('totalDuration'))
      .select(db.fn.countAll().as('numSongRequests'))
      .where('songRequests.status', '=', 'ready')
      .where(q => q.and([
        q('songRequests.id', '<', songRequestId),
        q('songRequests.priority', '>=', priority[0].priority)
      ]))
      .orderBy(['songRequests.priority desc', 'songRequests.id asc'])
      .execute();
    return {
      totalDuration: Number(precedingRequests[0].totalDuration),
      numSongRequests: Number(precedingRequests[0].numSongRequests) + 1,
    };
  }
  
  public execute(query: string, maxDuration: number, request?: SongRequestSource, priority: boolean = false) {
    return new Promise<[ProcessedSong, number]>(async (resolve, reject) => {
      try {
        const downloadedSong = await this.downloadSong(query, maxDuration);
  
        if (downloadedSong) {
          const tags = await getSongTags(downloadedSong.path);
          if (tags.format?.duration > maxDuration) {
            reject(new SongDownloadError('TOO_LONG'));
            this.broadcast({ type: 'download_error', query });
            return;
          }

          const songRequest = await db.insertInto('songRequests').values({
            query,
            priority: Number(priority),
            order: 0,
            status: 'processing',
            requester: request?.requesterName,
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
              await db.updateTable('songRequests')
                .set({ status: 'ready', songId: song[0].id })
                .where('id', '=', songRequest[0].id)
                .execute();
              console.info(`Song request added from request "${downloadedSong.basename}", broadcasting message...`);
              this.broadcast({ type: 'song_requests_updated' });
              resolve([processedSong, songRequest[0].id]);
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
          this.broadcast({ type: 'download_error', query });
        }
      } catch (e) {
        reject(e);
        this.broadcast({ type: 'download_error', query });
      }
    });
  }
}
