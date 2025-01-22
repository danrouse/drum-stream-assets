import { execSync } from 'child_process';
import { basename } from 'path';
import { sql } from 'kysely';
import Demucs from './wrappers/demucs';
import downloadSong from './downloadSong';
import getSongTags from './getSongTags';
import * as Paths from './paths';
import { db, Song } from './database';
import SongDownloadError from './SongDownloadError';
import { createLogger } from '../../shared/util';
import { SongRequestSource, ProcessedSong, DownloadedSong, WebSocketBroadcaster, WebSocketMessage } from '../../shared/messages';

interface DemucsCallback {
  song: DownloadedSong;
  callback: (song?: ProcessedSong, isDuplicate?: boolean) => void;
}

interface SongRequestOptions {
  priority: number,
  noShenanigans: boolean,
  maxDuration: number,
  minViews: number,
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

  public messageHandler = async (payload: WebSocketMessage) => {
    if (payload.type === 'song_request') {
      try {
        await this.execute(payload.query, { maxDuration: 12000 });
      } catch (e) {
        this.broadcast({ type: 'download_error', query: payload.query });
      }
    } else if (
      (payload.type === 'song_playback_completed' || payload.type === 'song_request_removed') &&
      payload.songRequestId
    ) {
      const nextStatus = payload.type === 'song_playback_completed' ? 'fulfilled' : 'cancelled';
      this.log('Set song request', payload.songRequestId, nextStatus);
      // Update song request in the database
      await db.updateTable('songRequests')
        .set({ status: nextStatus, fulfilledAt: new Date().toUTCString() })
        .where('id', '=', payload.songRequestId)
        .execute();
    }
  };

  private log = createLogger('SongRequestHandler');

  private processDownloadedSong(
    song: DownloadedSong,
    callback?: (song?: ProcessedSong, isDuplicate?: boolean) => void,
    ignoreDuplicates: boolean = true
  ) {
    this.log(`Running ffmpeg-normalize on ${song.basename}`);
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

  private async downloadSong(query: string, options: Partial<SongRequestOptions> = {}) {
    this.log('Attempting to download:', query);
    this.broadcast({ type: 'download_start', query });
    const downloadedSong = await downloadSong(query, Paths.DOWNLOADS_PATH, options);
  
    if (downloadedSong) {
      this.broadcast({ type: 'download_complete', name: downloadedSong.basename });
      this.log('Downloaded:', downloadedSong.basename);
    } else {
      this.broadcast({ type: 'download_error', query });
      this.log('Received no basename from spotdl');
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
      .where(q => q.or([
        q('songRequests.priority', '>', priority[0].priority),
        q.and([q('songRequests.priority', '=', priority[0].priority), q('songRequests.id', '<', songRequestId)])
      ]))
      .orderBy(['songRequests.priority desc', 'songRequests.id asc'])
      .execute();
    return {
      totalDuration: Number(precedingRequests[0].totalDuration),
      numSongRequests: Number(precedingRequests[0].numSongRequests) + 1,
    };
  }

  public async getExistingSongRequest(query: string, requesterName: string) {
    const sameQuery = await db.selectFrom('songRequests')
      .innerJoin('songs', 'songs.id', 'songRequests.songId')
      .select(['songRequests.id', 'songs.artist', 'songs.title'])
      .orderBy('songRequests.createdAt desc')
      .where('query', '=', query)
      .limit(1)
      .execute();
    if (sameQuery.length > 0) return sameQuery[0];
    if (['queue', 'queued song', 'song in queue'].includes(query)) {
      // find most recent request from the same requester
      const sameRequester = await db.selectFrom('songRequests')
        .innerJoin('songs', 'songs.id', 'songRequests.songId')
        .select(['songRequests.id', 'songs.artist', 'songs.title'])
        .orderBy('songRequests.createdAt desc')
        .where('requester', '=', requesterName)
        .limit(1)
        .execute();
      if (sameRequester.length > 0) return sameRequester[0];
    }
  }
  
  public execute(query: string, options: Partial<SongRequestOptions> = {}, request?: SongRequestSource) {
    return new Promise<[ProcessedSong, number]>(async (resolve, reject) => {
      try {
        const downloadedSong = await this.downloadSong(query, options);
  
        if (downloadedSong) {
          const tags = await getSongTags(downloadedSong.path);
          if (options.maxDuration && tags.format?.duration > options.maxDuration) {
            reject(new SongDownloadError('TOO_LONG'));
            this.broadcast({ type: 'download_error', query });
            return;
          }

          const songRequest = await db.insertInto('songRequests').values({
            query,
            priority: options?.priority || 0,
            noShenanigans: Number(options?.noShenanigans || 0),
            order: 0,
            status: 'processing',
            requester: request?.requesterName,
            twitchRewardId: request?.twitchRewardId,
            twitchRedemptionId: request?.twitchRedemptionId,
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
                const existingSongRequest = await db.selectFrom('songRequests')
                  .select('id')
                  .where('songId', '=', song[0].id!)
                  .where('status', '=', 'ready')
                  .execute();
                if (existingSongRequest.length) {
                  // Cancel the new song request because one already exists
                  await db.updateTable('songRequests')
                    .set({ status: 'cancelled' })
                    .where('id', '=', songRequest[0].id)
                    .execute();
                  return reject(new SongDownloadError('REQUEST_ALREADY_EXISTS'));
                }
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
              
              // Recalculate song ordering: bump priority of requests that are more than half an hour old
              const minutesOldToBump = 40;
              await db.updateTable('songRequests')
                .set({ priority: 2 })
                .where('createdAt', '<', sql<any>`datetime(${new Date(Date.now() - (minutesOldToBump * 60 * 1000)).toISOString()})`)
                .where('priority', '<', 2)
                .where('status', '=', 'ready')
                .execute();
              
              this.log(`Song request added from request "${downloadedSong.basename}", broadcasting message...`);
              this.broadcast({ type: 'song_request_added', songRequestId: songRequest[0].id });
              resolve([processedSong, songRequest[0].id]);
            } else {
              await db.updateTable('songRequests')
                .set({ status: 'cancelled' })
                .where('id', '=', songRequest[0].id)
                .execute();
              reject(new SongDownloadError('DEMUCS_FAILURE'));
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
