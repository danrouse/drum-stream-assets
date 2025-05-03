/**
 * Song Request submodule
 *
 * Sends song requests to RabbitMQ for job-handlers to process
 * Handles song request data in the db
 * Handles the channel point redemption for special song requests
 * Gives chatters helpful info about their song requests
 *   via progress messages and some ! commands
 */
import { sql } from 'kysely';
import { StreamerbotEventPayload } from '@streamerbot/client';
import StreamerbotWebSocketClient from '../../StreamerbotWebSocketClient';
import { db } from '../../database';
import * as queries from '../../queries';
import { Queues, Payloads, JobInterface } from '../../../../shared/RabbitMQ';
import { createLogger, isURL, formatTime } from '../../../../shared/util';
import { WebSocketMessage } from '../../../../shared/messages';
import WebSocketCoordinatorServer from '../../WebSocketCoordinatorServer';

interface SongRequestOptions {
  priority: number,
  noShenanigans: boolean,
  maxDuration: number,
  minViews: number,
  requesterName: string,
  twitchRewardId?: string,
  twitchRedemptionId?: string,
}

const SONG_REQUEST_MAX_DURATION = 60 * 6;
const LONG_SONG_REQUEST_MAX_DURATION = 60 * 12;

export default class SongRequestModule {
  private client: StreamerbotWebSocketClient;
  private wss: WebSocketCoordinatorServer;
  private jobs: JobInterface;
  private successCallbacks: { [id: number]: (songTitle: string) => void } = {};
  private failureCallbacks: { [id: number]: (errorType: string) => void } = {};
  private userCommandHistory: { [username: string]: [string, number][] } = {};

  public static MINIMUM_QUERY_LENGTH = 4;
  public static PRIORITY_REQUEST_VALUE = 5;

  constructor(
    client: StreamerbotWebSocketClient,
    wss: WebSocketCoordinatorServer
  ) {
    this.client = client;
    this.wss = wss;

    this.client.registerCommandHandler('song request', async (payload) => {
      try {
        const query = await this.prepareUserSongRequest(
          payload.message,
          payload.user,
          await this.songRequestMaxCountForUser(payload.user)
        );
        await this.handleUserSongRequest(
          query,
          payload.user,
          await this.songRequestMaxDurationForUser(payload.user)
        );
      } catch (e) {
        this.log('Song request error', e);
      }
    });


    this.client.registerCommandHandler('!replace', async (payload) => {
      const { songRequest, query: strippedQuery, isAmbiguous } = await this.disambiguate(
        payload.user, payload.message, 'Use !edit <number> <query> to select which song to replace.'
      );
      if (isAmbiguous) return;
      if (!songRequest) {
        await this.client.sendTwitchMessage(`@${payload.user} You don't have any active song requests to change!`);
        return;
      }

      let query;
      try {
        query = this.prepareSongRequestQuery(strippedQuery);
      } catch (err) {
        await this.client.doAction('!how');
        throw err;
      }
      await this.handleUserSongRequest(
        query,
        payload.user,
        await this.songRequestMaxDurationForUser(payload.user),
        songRequest.priority,
        Boolean(songRequest.noShenanigans),
        undefined,
        undefined,
        songRequest.id,
      );
    });
    this.client.registerCommandHandler('!when', async (payload) => {
      const songRequests = await queries.songRequestsByUser(payload.user);
      if (!songRequests.length) {
        await this.client.sendTwitchMessage(`@${payload.user} You don't have any songs in the request queue!`);
      } else {
        this.userCommandHistory[payload.user] ||= [];
        const [_, lastUsage] = this.userCommandHistory[payload.user].findLast(([command, time]) => command === '!when') || [];
        const FIVE_MINUTES = 5 * 60 * 1000;
        const now = Date.now();
        if (lastUsage && now - lastUsage < FIVE_MINUTES && !this.isUserAdmin(payload.user)) {
          // const pastUsageCount = this.commandHistory[payload.user].filter(([command, time]) => command === commandName && now - time < FIVE_MINUTES).length;
          // if (pastUsageCount > 2) {
          //   await this.sendTwitchMessage(`@${payload.user} Your song has been removed from the queue, you can go listen to it on Spotify instead.`);
          // } else {
            await this.client.sendTwitchMessage(`@${payload.user} Your song could be playing *right now* if you go to spotify.com - no paid account needed! Please be patient :)`);
          // }
        } else {
          const messageParts = [`@${payload.user}`];
          if (songRequests.length > 1) {
            messageParts.push(`You have ${songRequests.length} song${songRequests.length !== 1 ? 's' : ''} in the queue.`);
          }
          for (let songRequest of songRequests) {
            const remaining = await queries.getTimeUntilSongRequest(songRequest.id);
            if (remaining.numSongRequests === 1) {
              messageParts.push(`№${remaining.numSongRequests}: ${songRequest.artist} - ${songRequest.title} is up next!`);
            } else {
              messageParts.push(`№${remaining.numSongRequests}: ${songRequest.artist} - ${songRequest.title} (in ~${formatTime(remaining.totalDuration)})`);
            }
          }
          await this.client.sendTwitchMessage(messageParts.join(' '));
        }
        this.userCommandHistory[payload.user].push(['!when', now]);
      }
    });
    this.client.registerCommandHandler('!remove', async (payload) => {
      const { songRequest, isAmbiguous } = await this.disambiguate(
        payload.user, payload.message, 'Use !remove <number> to select which song to remove.'
      );
      if (isAmbiguous) return;
      if (!songRequest) {
        await this.client.sendTwitchMessage(`@${payload.user} You don't have any queued song requests to remove!`);
        return;
      }

      await db.updateTable('songRequests')
        .set({ status: 'cancelled', fulfilledAt: new Date().toUTCString() })
        .where('id', '=', songRequest.id)
        .execute();
      this.wss.broadcast({
        type: 'song_request_removed',
        songRequestId: songRequest.id,
      });
      await this.client.sendTwitchMessage(`@${payload.user} ${songRequest.artist} - ${songRequest.title} has been removed from the queue.`);
    });
    this.client.registerCommandHandler('!songlist', async (payload) => {
      const MAX_RESPONSE_SONGS = 5;
      const res = await queries.songRequestQueue();
      if (res.length === 0) {
        await this.client.sendTwitchMessage(`@${payload.user} The song request queue is empty.`);
      } else {
        await this.client.sendTwitchMessage(
          `There ${res.length > 1 ? 'are' : 'is'} ${res.length} song${res.length > 1 ? 's' : ''} in queue: ` +
          res.slice(0, MAX_RESPONSE_SONGS).map(s =>
            `${s.artist} - ${s.title}`.substring(0, 32) + (`${s.artist} - ${s.title}`.length > 32 ? '...' : '') +
            ` [${formatTime(s.duration)}]`
          ).join(', ') +
          (res.length > MAX_RESPONSE_SONGS ? ` (+ ${res.length - MAX_RESPONSE_SONGS} more)` : '')
        );
        const totalTime = res.reduce((acc, cur) => acc + cur.duration, 0);
        await this.client.sendTwitchMessage(`The queue has ${res.length} song${res.length > 1 ? 's' : ''} and a length of ${formatTime(totalTime)}.`)
      }
    });
    this.client.registerCommandHandler('!bump', async (payload) => {
      const { songRequest, isAmbiguous } = await this.disambiguate(
        payload.user, payload.message, 'Use !bump <number> to select which song to bump up.'
      );
      if (isAmbiguous) return;
      if (!songRequest) {
        await this.client.sendTwitchMessage(`@${payload.user} You don't have any queued song requests to bump!`);
        return;
      }

      const viewer = await this.client.getViewer(payload.user);
      let user = await db.selectFrom('users')
        .select(['availableBumps', 'lastFreeBumpStreamHistoryId'])
        .where(q => q.fn<string>('lower', ['name']), '=', payload.user.toLowerCase())
        .execute();
      if (!user[0]) {
        user = await db.insertInto('users').values({
          name: payload.user
        }).returningAll().execute();
      }
      let availableBumps = user[0].availableBumps;
      let userUpdate = db.updateTable('users').where('name', '=', payload.user);
      if (viewer?.subscribed) {
        // Check to see if subscriber has gotten their free bump of the stream
        const currentStreamId = (await queries.currentStreamHistory())[0].id;
        if (user[0].lastFreeBumpStreamHistoryId !== currentStreamId) {
          availableBumps += 1;
          await this.client.sendTwitchMessage(`@${payload.user} You've been given a free bump of the day, thanks for subscribing! dannyt75Heart`);
        }
        userUpdate = userUpdate.set('lastFreeBumpStreamHistoryId', currentStreamId);
      }

      if (availableBumps > 0) {
        // Bump the song
        userUpdate = userUpdate.set('availableBumps', availableBumps - 1);
        await db.updateTable('songRequests')
          .where('id', '=', songRequest.id)
          .set('effectiveCreatedAt', sql`datetime(songRequests.effectiveCreatedAt, '-30 minutes')`)
          .execute();
        const remaining = await queries.getTimeUntilSongRequest(songRequest.id);
        await this.client.sendTwitchMessage(`@${payload.user} ${songRequest.artist} - ${songRequest.title} has been bumped up to position ${remaining.numSongRequests}!`);
      } else {
        await this.client.sendTwitchMessage(`@${payload.user} You don't have any bumps available to use!`);
      }
      await userUpdate.execute();
    });
    this.client.registerCommandHandler('!longsr', async (payload) => {
      let user = await db.selectFrom('users')
        .select(['availableLongSongs', 'lastLongSongStreamHistoryId'])
        .where(q => q.fn<string>('lower', ['name']), '=', payload.user.toLowerCase())
        .execute();
      if (!user[0]) {
        user = await db.insertInto('users').values({
          name: payload.user
        }).returningAll().execute();
      }
      const currentStreamId = (await queries.currentStreamHistory())[0].id;
      if (user[0].lastLongSongStreamHistoryId === currentStreamId) {
        await this.client.sendTwitchMessage(`@${payload.user} You can only request one Long Song per stream!`);
        throw new Error('ONE_LONG_SONG_PER_DAY');
      }

      let availableLongSongs = user[0].availableLongSongs;
      if (availableLongSongs > 0) {
        const query = await this.prepareUserSongRequest(
          payload.message,
          payload.user,
          await this.songRequestMaxCountForUser(payload.user)
        );
        await this.handleUserSongRequest(
          query,
          payload.user,
          LONG_SONG_REQUEST_MAX_DURATION,
        );
        await db.updateTable('users')
          .where('name', '=', payload.user)
          .set({
            availableLongSongs: availableLongSongs - 1,
            lastLongSongStreamHistoryId: currentStreamId
          })
          .execute();
      } else {
        await this.client.sendTwitchMessage(`@${payload.user} You don't have any long song requests available to use!`);
      }
    });

    this.client.registerTwitchRedemptionHandler('Long Song Request', async (payload) => {
      try {
        let user = await db.selectFrom('users')
          .select(['lastLongSongStreamHistoryId'])
          .where(q => q.fn<string>('lower', ['name']), '=', payload.user.toLowerCase())
          .execute();
        if (!user[0]) {
          user = await db.insertInto('users').values({
            name: payload.user
          }).returningAll().execute();
        }
        const currentStreamId = (await queries.currentStreamHistory())[0].id;
        if (user[0].lastLongSongStreamHistoryId === currentStreamId) {
          await this.client.sendTwitchMessage(`@${payload.user} You can only request one Long Song per stream!`);
          throw new Error('ONE_LONG_SONG_PER_DAY');
        }

        const query = await this.prepareUserSongRequest(
          payload.input,
          payload.user,
          await this.songRequestMaxCountForUser(payload.user)
        );
        await this.handleUserSongRequest(
          query,
          payload.user,
          LONG_SONG_REQUEST_MAX_DURATION,
          0,
          false,
          payload.rewardId,
          payload.redemptionId,
        );

        await db.updateTable('users')
          .where(q => q.fn<string>('lower', ['name']), '=', payload.user.toLowerCase())
          .set({ lastLongSongStreamHistoryId: currentStreamId })
          .execute();
      } catch (err) {
        await this.client.updateTwitchRedemption(payload.rewardId, payload.redemptionId, 'cancel');
        await this.client.sendTwitchMessage(`@${payload.user} Long Song Request has been refunded`);
      }
    });
    this.client.registerTwitchRedemptionHandler('Priority Song Request', async (payload) => {
      try {
        const existingRequest = await this.getExistingSongRequest(
          payload.input.trim().toLowerCase(),
          payload.user
        );
        if (existingRequest) {
          await db.updateTable('songRequests')
            .set({ priority: SongRequestModule.PRIORITY_REQUEST_VALUE })
            .where('id', '=', existingRequest.id)
            .execute();
          await this.client.sendTwitchMessage(`@${payload.user} Your song request for ${existingRequest.artist} - ${existingRequest.title} has been bumped!`);
        } else {
          const query = await this.prepareUserSongRequest(
            payload.input,
            payload.user,
            0,
            false,
          );
          await this.handleUserSongRequest(
            query,
            payload.user,
            await this.songRequestMaxDurationForUser(payload.user),
            SongRequestModule.PRIORITY_REQUEST_VALUE,
            false,
            payload.rewardId,
            payload.redemptionId,
          );
        }
      } catch (err) {
        await this.client.updateTwitchRedemption(payload.rewardId, payload.redemptionId, 'cancel');
        await this.client.sendTwitchMessage(`@${payload.user} Priority Song Request has been refunded`);
      }
    });
    this.client.registerTwitchRedemptionHandler('No Shens Song Request', async (payload) => {
      try {
        const existingRequest = await this.getExistingSongRequest(
          payload.input.trim().toLowerCase(),
          payload.user
        );
        if (existingRequest) {
          await db.updateTable('songRequests')
            .set({ noShenanigans: 1 })
            .where('id', '=', existingRequest.id)
            .execute();
        } else {
          const query = await this.prepareUserSongRequest(
            payload.input,
            payload.user,
            await this.songRequestMaxCountForUser(payload.user)
          );
          await this.handleUserSongRequest(
            query,
            payload.user,
            await this.songRequestMaxDurationForUser(payload.user),
            0,
            true,
            payload.rewardId,
            payload.redemptionId,
          );
        }
      } catch (err) {
        await this.client.updateTwitchRedemption(payload.rewardId, payload.redemptionId, 'cancel');
        await this.client.sendTwitchMessage(`@${payload.user} No Shens Song Request has been refunded`);
      }
    });
    this.client.registerCustomEventHandler<'Twitch.GiftSub' | 'Twitch.GiftBomb'>('add bumps', async (payload) => {
      if (payload.triggerName === 'Gift Subscription' || payload.triggerName === 'Gift Bomb') {
        // @ts-expect-error Twitch.GiftBomb payload definition is incomplete
        const giftedCount: number = payload.gifts || payload.subBombCount || 1;
        // NB: is it worth having an upper limit on number of bumps given?
        if (payload.isTest) return;
        await db.updateTable('users')
          .where('name', '=', payload.userName)
          .set(q => ({ availableBumps: q('availableBumps', '+', giftedCount) }))
          .execute();
        await this.client.sendTwitchMessage(`@${payload.userName} Thanks for gifting ${giftedCount === 1 ? 'a sub' : giftedCount + ' subs'}! ` +
          `dannyt75Heart You've been given ${giftedCount === 1 ? 'one song !bump' : giftedCount + ' !bumps'} to use whenever you want.`);
      }
    });

    this.wss.registerHandler('song_request', payload => this.execute(payload.query, { maxDuration: 12000 }));
    this.wss.registerHandler('song_playback_completed', this.handleSongPlaybackCompleted);
    this.wss.registerHandler('song_request_removed', this.handleSongPlaybackCompleted);
    this.wss.registerHandler('song_changed', this.handleSongChanged);

    this.jobs = new JobInterface();
    this.jobs.listen(Queues.SONG_REQUEST_COMPLETE, this.handleSongRequestComplete);
    this.jobs.listen(Queues.SONG_REQUEST_ERROR, this.handleSongRequestError);
  }

  private handleSongPlaybackCompleted = async (payload: WebSocketMessage<'song_playback_completed' | 'song_request_removed'>) => {
    if (!payload.songRequestId) return;
    const nextStatus = payload.type === 'song_playback_completed' ? 'fulfilled' : 'cancelled';
    this.log('Set song request', payload.songRequestId, nextStatus);
    // Update song request in the database
    await db.updateTable('songRequests')
      .set({ status: nextStatus, fulfilledAt: new Date().toUTCString() })
      .where('id', '=', payload.songRequestId)
      .execute();
  };

  private log = createLogger('SongRequestHandler');

  private async disambiguate(
    user: string,
    message: string,
    helpString: string,
  ) {
    const songRequests = await queries.songRequestsByUser(user);
    let songRequest: typeof songRequests[0] | undefined = songRequests[0];
    let query = message;
    let isAmbiguous = false;
    if (songRequests.length > 1) {
      const reqNumberMatch = query.match(/^\s*#?\s*(\d+)\s*(.*)/);
      if (!reqNumberMatch || Number.isNaN(Number(reqNumberMatch[1]))) {
        const requestNames = songRequests
          .map((sr, i) => `${i + 1}: ${[sr.artist, sr.title].filter(s => s).join(' - ')}`)
          .join(', ');
        await this.client.sendTwitchMessage(`@${user} You have multiple songs in the queue! ${helpString}`);
        await this.client.sendTwitchMessage(`@${user} ${requestNames}`)
        isAmbiguous = true;
      } else {
        songRequest = songRequests[Number(reqNumberMatch[1]) - 1];
        query = reqNumberMatch[2];
      }
    }

    return {
      songRequest,
      query,
      isAmbiguous,
    };
  }

  private async songRequestMaxDurationForUser(userName: string) {
    const viewer = await this.client.getViewer(userName);
    let maxDuration = SONG_REQUEST_MAX_DURATION; // 7 mins default max
    if (viewer?.role.toUpperCase() === 'VIP') maxDuration = 60 * 10; // 10 mins for VIP
    if (viewer?.role === 'Moderator') maxDuration = 60 * 20; // 20 mins for mod
    if (viewer?.role === 'Broadcaster') maxDuration = 12000;
    return maxDuration;
  }

  private async songRequestMaxCountForUser(userName: string) {
    const viewer = await this.client.getViewer(userName);
    let limit = 1;
    if (viewer?.subscribed) limit = 2;
    if (viewer?.role.toUpperCase() === 'VIP') limit = 2;
    if (viewer?.role === 'Moderator') limit = 0;
    if (viewer?.role === 'Broadcaster') limit = 0;
    return limit;
  }

  private async songRequestMinViewsForUser(userName: string) {
    const viewer = await this.client.getViewer(userName);
    let minViews: number | undefined = 1000;
    if (viewer?.subscribed) minViews = 100;
    if (viewer?.role.toUpperCase() === 'VIP') minViews = undefined;
    if (viewer?.role === 'Moderator') minViews = undefined;
    if (viewer?.role === 'Broadcaster') minViews = undefined;
    return minViews;
  }

  private async isUserAdmin(userName: string) {
    const viewer = await this.client.getViewer(userName);
    return viewer?.role === 'Broadcaster' || viewer?.role === 'Moderator';
  }

  private async getExistingSongRequest(query: string, requesterName: string) {
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

  private async execute(
    query: string,
    options: Partial<SongRequestOptions> = {},
    onSuccess?: (songTitle: string) => void,
    onFailure?: (errorType: string) => void,
  ) {
    // remove unnecessary query params from URLs to help with duplicate detection
    if (isURL(query)) {
      const url = new URL(query);
      url.searchParams.delete('si');
      url.searchParams.delete('index');
      url.searchParams.delete('playlist');
      url.searchParams.delete('context');
      url.searchParams.delete('feature');
      url.searchParams.delete('ab_channel');
      url.searchParams.delete('list');
      url.searchParams.delete('pp');
      url.search = url.searchParams.toString();
      query = url.toString();
    }
    let existingSongId: number | undefined | null;
    const priorSongRequest = (await db.selectFrom('songRequests')
      .leftJoin('songs', 'songId', 'songs.id')
      .leftJoin('downloads', 'downloadId', 'downloads.id')
      .select(['songId', 'stemsPath', 'artist', 'title', 'album', 'track', 'downloads.path as downloadPath', 'lyricsPath', 'isVideo'])
      .selectAll('songs')
      .where('query', '=', query)
      .execute())[0];
    if (priorSongRequest) {
      existingSongId = priorSongRequest.songId;
    }

    const songRequest = (await db.insertInto('songRequests').values({
      songId: existingSongId,
      query,
      priority: options?.priority || 0,
      noShenanigans: Number(options?.noShenanigans || 0),
      status: 'processing',
      requester: options?.requesterName,
      twitchRewardId: options?.twitchRewardId,
      twitchRedemptionId: options?.twitchRedemptionId,
    }).returning('id as id').execute())[0];

    if (onSuccess) this.successCallbacks[songRequest.id] = onSuccess;
    if (onFailure) this.failureCallbacks[songRequest.id] = onFailure;

    if (existingSongId) {
      setImmediate(async () => {
        this.handleSongRequestComplete({
          id: songRequest.id,
          stemsPath: priorSongRequest.stemsPath!,
          downloadPath: priorSongRequest.downloadPath!,
          lyricsPath: priorSongRequest.lyricsPath!,
          isVideo: Boolean(priorSongRequest.isVideo),
          artist: priorSongRequest.artist!,
          title: priorSongRequest.title!,
          album: priorSongRequest.album!,
          track: priorSongRequest.track!,
          duration: priorSongRequest.duration!,
        });
      });
    } else {
      this.jobs.publish(Queues.SONG_REQUEST_CREATED, {
        id: songRequest.id,
        query,
        maxDuration: options.maxDuration,
        minViews: options.minViews,
      });
    }
    return songRequest.id;
  }

  private handleSongRequestComplete = async (payload: Payloads[typeof Queues.SONG_REQUEST_COMPLETE]) =>  {
    this.log('handleSongRequestComplete', payload);

    try {
      let song = (await db.selectFrom('songs')
        .select('id')
        .where('stemsPath', '=', payload.stemsPath)
        .execute())[0];
      if (song) {
        const existingSongRequest = await db.selectFrom('songRequests')
          .select('id')
          .where('songId', '=', song.id)
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

      this.wss.broadcast({ type: 'song_request_added', songRequestId: payload.id });

      this.successCallbacks[payload.id]?.([payload.artist, payload.title].filter(s => s).join(' - '));
    } catch (e) {
      return this.handleSongRequestError({
        errorMessage: e instanceof Error ? e.message : (e as string),
        id: payload.id,
      });
    }
  };

  private handleSongRequestError = async (payload: Payloads[typeof Queues.SONG_REQUEST_ERROR]) => {
    await db.updateTable('songRequests')
      .set({ status: 'cancelled' })
      .where('id', '=', payload.id)
      .execute();
    this.failureCallbacks[payload.id]?.(payload.errorMessage);
  };

  private prepareSongRequestQuery(query: string) {
    // If message has a URL, use only the URL
    const url = query.match(/https?:\/\/\S+/)?.[0];

    // Strip accidental inclusions on the original message if using that
    let userInput = url || query.trim().replace(/^\!(sr|ssr|request|songrequest|rs)\s+/i, '');
    // Remove brackets that users included (like !sr <foo bar> instead of !sr foo bar)
    userInput = userInput.replace(/^</, '').replace(/>$/, '');
    if (!url && !userInput.includes('-')) {
      // strip "song by artist" to "song artist" to not confuse spotify search
      userInput = userInput.replace(/ by /i, ' ');
    }

    if (userInput.length <= SongRequestModule.MINIMUM_QUERY_LENGTH) {
      throw new Error('MINIMUM_QUERY_LENGTH');
    }
    return userInput;
  }

  private async prepareUserSongRequest(
    query: string,
    fromUsername: string,
    perUserLimit?: number,
    hasCooldown: boolean = true,
  ) {
    // Check if user already has the maximum ongoing song requests before processing
    const existingRequestCount = await queries.numRequestsByUser(fromUsername);
    if (perUserLimit && Number(existingRequestCount[0].count) >= perUserLimit) {
      await this.client.sendTwitchMessage(
        `@${fromUsername} You have the maximum number of ongoing song requests (${perUserLimit}), ` +
        `please wait until one of your songs has played before requesting another!`
      );
      throw new Error('TOO_MANY_REQUESTS');
    }

    // Check if the user is on cooldown for their next song request
    if (hasCooldown && !(await this.isUserAdmin(fromUsername))) {
      const lastRequestTime = await queries.lastRequestTimeByUser(fromUsername);
      if (lastRequestTime[0]) {
        const createdAt = new Date(lastRequestTime[0].createdAt + 'Z');
        const availableAt = createdAt.getTime() + (lastRequestTime[0].duration * 1000);
        const now = new Date().getTime();
        if (availableAt > now) {
          await this.client.sendTwitchMessage(`@${fromUsername} Your next song request will be available in ${formatTime((availableAt - now) / 1000)}! (wait at least the length of your last requested song for your next one)`);
          throw new Error('COOLDOWN');
        }
      }
    }

    try {
      const userInput = this.prepareSongRequestQuery(query);
      return userInput;
    } catch (err) {
      await this.client.doAction('!how');
      throw err;
    }
  }

  private async handleUserSongRequest(
    query: string,
    requesterName: string,
    maxDuration: number,
    priority: number = 0,
    noShenanigans: boolean = false,
    twitchRewardId?: string,
    twitchRedemptionId?: string,
    songRequestToReplaceId?: number,
  ) {
    let hasResponded = false;
    setTimeout(async () => {
      if (!hasResponded) {
        await this.client.sendTwitchMessage(`Working on it, @${requesterName}! Give me a moment to download that song.`);
      }
    }, 500);

    const minViews = await this.songRequestMinViewsForUser(requesterName);
    const songRequestId = await this.execute(
      query,
      {
        priority,
        noShenanigans,
        maxDuration,
        minViews,
        requesterName,
        twitchRewardId,
        twitchRedemptionId,
      },
      async (songTitle: string) => {
        if (songRequestToReplaceId) {
          const oldSongRequest = await db.updateTable('songRequests')
            .where('id', '=', songRequestToReplaceId)
            .set('status', 'cancelled')
            .returning(['effectiveCreatedAt'])
            .execute();
          await db.updateTable('songRequests')
            .where('id', '=', songRequestId)
            .set('effectiveCreatedAt', oldSongRequest[0].effectiveCreatedAt)
            .execute();
          const waitTime = await queries.getTimeUntilSongRequest(songRequestId);
          const timeRemaining = waitTime.numSongRequests > 1 ? ` (in ~${formatTime(Number(waitTime.totalDuration))})` : '';
          await this.client.sendTwitchMessage(`@${requesterName} Your request has been replaced with ${songTitle} (at position ${waitTime.numSongRequests}${timeRemaining})`);
        } else {
          const waitTime = await queries.getTimeUntilSongRequest(songRequestId);
          const timeRemaining = waitTime.numSongRequests > 1 ? ` (in ~${formatTime(Number(waitTime.totalDuration))})` : '';
          await this.client.sendTwitchMessage(`@${requesterName} ${songTitle} was added to the queue in position ${waitTime.numSongRequests}${timeRemaining}`);
        }
        hasResponded = true;
      },
      async (errorMessage) => {
        let message = 'There was an error adding your song request!';
        if (errorMessage === 'VIDEO_UNAVAILABLE') message = 'That video is not available.';
        if (errorMessage === 'UNSUPPORTED_DOMAIN') message = 'Only Spotify or YouTube links are supported.';
        if (errorMessage === 'DOWNLOAD_FAILED') message = 'I wasn\'t able to download that link.';
        if (errorMessage === 'NO_PLAYLISTS') message = 'Playlists aren\'t supported, request a single song instead.';
        if (errorMessage === 'TOO_LONG') message = `That song is too long! Keep song requests under ${formatTime(maxDuration)} (for songs up to ${formatTime(LONG_SONG_REQUEST_MAX_DURATION)}, redeem a Long Song Request!)`;
        if (errorMessage === 'AGE_RESTRICTED') message = 'The song downloader doesn\'t currently support age-restricted videos.';
        if (errorMessage === 'MINIMUM_VIEWS') message = `Videos with under ${minViews} views are not allowed.`;
        if (errorMessage === 'REQUEST_ALREADY_EXISTS') message = 'That song is already in the song request queue.';
        await this.client.sendTwitchMessage(`@${requesterName} ${message}`);
        hasResponded = true;
        // TODO: rethrow to allow to catch for refund
        // throw e;
      }
    );
  }

  private handleSongChanged = async (payload: WebSocketMessage<'song_changed'>) => {
    // Notify user when their song request is starting
    if (payload.song.requester && payload.song.status === 'ready') {
      await this.client.sendTwitchMessage(`@${payload.song.requester} ${payload.song.artist} - ${payload.song.title} is starting!`);
    }
  };
}
