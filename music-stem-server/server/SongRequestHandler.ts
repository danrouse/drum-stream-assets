import { sql } from 'kysely';
import { db } from './database';
import { Queues, Payloads, JobInterface } from '../../shared/RabbitMQ';
import { createLogger } from '../../shared/util';
import { WebSocketBroadcaster, WebSocketMessage } from '../../shared/messages';

interface SongRequestOptions {
  priority: number,
  noShenanigans: boolean,
  maxDuration: number,
  minViews: number,
  requesterName: string,
  twitchRewardId?: string,
  twitchRedemptionId?: string,
}

export default class SongRequestHandler {
  private broadcast: WebSocketBroadcaster;
  private jobs: JobInterface;
  private successCallbacks: { [id: number]: (songTitle: string) => void } = {};
  private failureCallbacks: { [id: number]: (errorType: string) => void } = {};

  constructor(broadcast: WebSocketBroadcaster) {
    this.broadcast = broadcast;
    this.jobs = new JobInterface();
    this.jobs.listen(Queues.SONG_REQUEST_COMPLETE, this.handleSongRequestComplete.bind(this));
    this.jobs.listen(Queues.SONG_REQUEST_ERROR, this.handleSongRequestError.bind(this));
  }

  public messageHandler = async (payload: WebSocketMessage) => {
    if (payload.type === 'song_request') {
      await this.execute(payload.query, { maxDuration: 12000 });
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
  
  public async execute(
    query: string,
    options: Partial<SongRequestOptions> = {},
    onSuccess?: (songTitle: string) => void,
    onFailure?: (errorType: string) => void,
  ) {
    // TODO: Preprocess query to remove URL args
    // TODO: Check for exact match of song request.
    let existingSongId: number | undefined | null;
    const priorSongRequest = await db.selectFrom('songRequests')
      .leftJoin('songs', 'songId', 'songs.id')
      .select(['songId', 'songs.stemsPath'])
      .selectAll('songs')
      .where('query', '=', query)
      .execute();
    if (priorSongRequest.length) {
      existingSongId = priorSongRequest[0].songId;
    }
    //       If it exists, create a new record but tie it to the existing records.
    const songRequest = await db.insertInto('songRequests').values({
      songId: existingSongId,
      query,
      priority: options?.priority || 0,
      noShenanigans: Number(options?.noShenanigans || 0),
      order: 0,
      status: 'processing',
      requester: options?.requesterName,
      twitchRewardId: options?.twitchRewardId,
      twitchRedemptionId: options?.twitchRedemptionId,
    }).returning('id as id').execute();

    if (onSuccess) this.successCallbacks[songRequest[0].id] = onSuccess;
    if (onFailure) this.failureCallbacks[songRequest[0].id] = onFailure;

    if (existingSongId) {
      setImmediate(async () => {
        this.handleSongRequestComplete({
          id: songRequest[0].id,
          downloadPath: '',
          stemsPath: priorSongRequest[0].stemsPath!,
          lyricsPath: '',
          isVideo: false,
          artist: '',
          title: '',
          album: '',
          track: 0,
          duration: 0,
        });
      });
    } else {
      this.jobs.publish(Queues.SONG_REQUEST_CREATED, {
        id: songRequest[0].id,
        query,
      });
    }
    return songRequest[0].id;
  }

  private async handleSongRequestComplete(payload: Payloads[typeof Queues.SONG_REQUEST_COMPLETE]) {
    this.log('handleSongRequestComplete', payload);

    try {
      let song = (await db.selectFrom('songs')
        .select('id')
        .where('stemsPath', '=', payload.stemsPath)
        .execute())[0];
      if (song) {
        const existingSongRequest = await db.selectFrom('songRequests')
          .select('id')
          .where('songId', '=', song.id!)
          .where('status', '=', 'ready')
          .execute();
        if (existingSongRequest.length) {
          // Cancel the new song request because one already exists
          await db.updateTable('songRequests')
            .set({ status: 'cancelled' })
            .where('id', '=', payload.id)
            .execute();
          throw new Error('REQUEST_ALREADY_EXISTS');
        }
      } else {
        const download = await db.insertInto('downloads').values({
          path: payload.downloadPath,
          lyricsPath: payload.lyricsPath,
          isVideo: Number(payload.isVideo),
          songRequestId: payload.id,
        }).returning('id as id').execute();
        song = (await db.insertInto('songs').values({
          artist: payload.artist,
          title: payload.title,
          album: payload.album,
          track: payload.track,
          duration: payload.duration,
          stemsPath: payload.stemsPath,
          downloadId: download[0].id,
        }).returning('id as id').execute())[0];
      }
      await db.updateTable('songRequests')
        .set({ status: 'ready', songId: song.id })
        .where('id', '=', payload.id)
        .execute();
      
      // Recalculate song ordering: bump priority of requests that are more than half an hour old
      const minutesOldToBump = 40;
      await db.updateTable('songRequests')
        .set({ priority: 2 })
        .where('createdAt', '<', sql<any>`datetime(${new Date(Date.now() - (minutesOldToBump * 60 * 1000)).toISOString()})`)
        .where('priority', '<', 2)
        .where('status', '=', 'ready')
        .execute();
      
      this.broadcast({ type: 'song_request_added', songRequestId: payload.id });

      this.successCallbacks[payload.id]?.([payload.artist, payload.title].filter(s => s).join(' - '));
    } catch (e) {
      return this.handleSongRequestError({
        error: e instanceof Error ? e : new Error(e as string),
        id: payload.id,
      });
    }
  }

  private async handleSongRequestError(payload: Payloads[typeof Queues.SONG_REQUEST_ERROR]) {
    await db.updateTable('songRequests')
      .set({ status: 'cancelled' })
      .where('id', '=', payload.id)
      .execute();
    this.failureCallbacks[payload.id]?.(payload.error.message);
  }
}
