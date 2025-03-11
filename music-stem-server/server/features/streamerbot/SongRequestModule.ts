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
import * as Streamerbot from '../../../../shared/streamerbot';
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

const SONG_REQUEST_MAX_DURATION = 60 * 7;
const LONG_SONG_REQUEST_MAX_DURATION = 15 * 60;

export default class SongRequestModule {
  private client: StreamerbotWebSocketClient;
  private wss: WebSocketCoordinatorServer;
  private jobs: JobInterface;
  private successCallbacks: { [id: number]: (songTitle: string) => void } = {};
  private failureCallbacks: { [id: number]: (errorType: string) => void } = {};
  private userCommandHistory: { [username: string]: [string, number][] } = {};

  constructor(
    client: StreamerbotWebSocketClient,
    wss: WebSocketCoordinatorServer
  ) {
    this.client = client;
    this.wss = wss;

    this.client.on('Twitch.RewardRedemption', this.handleTwitchRewardRedemption);
    this.client.on('Command.Triggered', this.handleCommandTriggered);

    this.wss.registerHandler('song_request', payload => this.execute(payload.query, { maxDuration: 12000 }));
    this.wss.registerHandler('song_playback_completed', this.handleSongPlaybackCompleted);
    this.wss.registerHandler('song_request_removed', this.handleSongPlaybackCompleted);
    this.wss.registerHandler('song_changed', this.handleSongChanged);

    this.jobs = new JobInterface();
    this.jobs.listen(Queues.SONG_REQUEST_COMPLETE, this.handleSongRequestComplete.bind(this));
    this.jobs.listen(Queues.SONG_REQUEST_ERROR, this.handleSongRequestError.bind(this));
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
      order: 0,
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

      // Recalculate song ordering: bump priority of requests that are more than half an hour old
      const minutesOldToBump = 40;
      await db.updateTable('songRequests')
        .set({ priority: 2 })
        .where('createdAt', '<', sql<any>`datetime(${new Date(Date.now() - (minutesOldToBump * 60 * 1000)).toISOString()})`)
        .where('priority', '<', 2)
        .where('status', '=', 'ready')
        .execute();

      this.wss.broadcast({ type: 'song_request_added', songRequestId: payload.id });

      this.successCallbacks[payload.id]?.([payload.artist, payload.title].filter(s => s).join(' - '));
    } catch (e) {
      return this.handleSongRequestError({
        errorMessage: e instanceof Error ? e.message : (e as string),
        id: payload.id,
      });
    }
  }

  private async handleSongRequestError(payload: Payloads[typeof Queues.SONG_REQUEST_ERROR]) {
    await db.updateTable('songRequests')
      .set({ status: 'cancelled' })
      .where('id', '=', payload.id)
      .execute();
    this.failureCallbacks[payload.id]?.(payload.errorMessage);
  }

  private async handleUserSongRequest(
    originalMessage: string,
    fromUsername: string,
    maxDuration: number,
    perUserLimit?: number,
    priority: number = 0,
    noShenanigans: boolean = false,
    twitchRewardId?: string,
    twitchRedemptionId?: string,
  ) {
    // Check if user already has the maximum ongoing song requests before processing
    const existingRequestCount = await queries.numRequestsByUser(fromUsername);
    if (perUserLimit && Number(existingRequestCount[0].count) >= perUserLimit) {
      await this.client.sendTwitchMessage(
        `@${fromUsername} You have the maximum number of ongoing song requests (${perUserLimit}), ` +
        `please wait until one of your songs plays before requesting another!`
      );
      throw new Error('TOO_MANY_REQUESTS');
    }

    // Check if the user is on cooldown for their next song request
    if (!priority && !(await this.isUserAdmin(fromUsername))) {
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

    // If message has a URL, use only the URL
    const url = originalMessage.match(/https?:\/\/\S+/)?.[0];

    // Strip accidental inclusions on the original message if using that
    let userInput = url || originalMessage.trim().replace(/^\!(sr|ssr|request|songrequest|rs)\s+/i, '');
    // Remove brackets that users included (like !sr <foo bar> instead of !sr foo bar)
    userInput = userInput.replace(/^</, '').replace(/>$/, '');
    if (!url && !userInput.includes('-')) {
      // strip "song by artist" to "song artist" to not confuse spotify search
      userInput = userInput.replace(/ by /i, ' ');
    }

    const MINIMUM_REQUEST_LENGTH = 4;
    if (userInput.length <= MINIMUM_REQUEST_LENGTH) {
      await this.client.doAction('!how');
      throw new Error('MINIMUM_QUERY_LENGTH');
    }

    let hasResponded = false;
    setTimeout(async () => {
      if (!hasResponded) {
        await this.client.sendTwitchMessage(`Working on it, @${fromUsername}! Give me a moment to download that song.`);
      }
    }, 500);

    const minViews = await this.songRequestMinViewsForUser(fromUsername);
    const songRequestId = await this.execute(
      userInput,
      {
        priority,
        noShenanigans,
        maxDuration,
        minViews,
        requesterName: fromUsername,
        twitchRewardId,
        twitchRedemptionId,
      },
      async (songTitle: string) => {
        // If it's a sub's first song request of the stream, set it to priority 1
        // Waiting until the song request is added to ensure it doesn't get set erroneously
        const viewer = await this.client.getViewer(fromUsername);
        if (viewer?.subscribed) {
          const requestsFromUserToday = await queries.requestsByUserToday(fromUsername);
          if (requestsFromUserToday.length === 1 && requestsFromUserToday[0].priority === 0) {
            await db.updateTable('songRequests')
              .set({ priority: 1 })
              .where('id', '=', songRequestId)
              .execute();
            await this.client.sendTwitchMessage(`@${fromUsername} Your first song request of the day has been bumped up!`);
          }
        }

        const waitTime = await queries.getTimeUntilSongRequest(songRequestId);
        const timeRemaining = waitTime.numSongRequests > 1 ? ` (~${formatTime(Number(waitTime.totalDuration))} from now)` : '';
        await this.client.sendTwitchMessage(`@${fromUsername} ${songTitle} was added to the queue in position ${waitTime.numSongRequests}${timeRemaining}`);
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
        await this.client.sendTwitchMessage(`@${fromUsername} ${message}`);
        hasResponded = true;
        // TODO: rethrow to allow to catch for refund
        // throw e;
      }
    );
  }

  private async handleSongChanged(payload: WebSocketMessage<'song_changed'>) {
    // Notify user when their song request is starting
    if (payload.song.requester && payload.song.status === 'ready') {
      await this.client.sendTwitchMessage(`@${payload.song.requester} ${payload.song.artist} - ${payload.song.title} is starting!`);
    }
  }

  private handleCommandTriggered = async (payload: StreamerbotEventPayload<"Command.Triggered">) => {
    const message = payload.data.message.trim();
    const userName = payload.data.user.display;
    const commandName = Streamerbot.CommandAliases[payload.data.command];

    this.userCommandHistory[userName] ||= [];
    const [_, lastUsage] = this.userCommandHistory[userName].findLast(([command, time]) => command === commandName) || [];
    const now = Date.now();

    if (commandName === 'song request') {
      try {
        await this.handleUserSongRequest(
          message,
          userName,
          await this.songRequestMaxDurationForUser(userName),
          await this.songRequestMaxCountForUser(userName)
        );
      } catch (e) {
        this.log('Song reward redemption failed with error', e);
      }
    } else if (commandName === '!when') {
      const songRequest = await queries.nextSongByUser(userName);
      if (!songRequest) {
        await this.client.sendTwitchMessage(`@${userName} You don't have any songs in the request queue!`);
      } else {
        const FIVE_MINUTES = 5 * 60 * 1000;
        if (lastUsage && now - lastUsage < FIVE_MINUTES) {
          // const pastUsageCount = this.commandHistory[userName].filter(([command, time]) => command === commandName && now - time < FIVE_MINUTES).length;
          // if (pastUsageCount > 2) {
          //   await this.sendTwitchMessage(`@${userName} Your song has been removed from the queue, you can go listen to it on Spotify instead.`);
          // } else {
            await this.client.sendTwitchMessage(`@${userName} Your song could be playing *right now* if you go to spotify.com - no paid account needed! Be patient.`);
          // }
        } else {
          const remaining = await queries.getTimeUntilSongRequest(songRequest[0].id);
          if (remaining.numSongRequests === 1) {
            await this.client.sendTwitchMessage(`@${userName} Your song (${songRequest[0].artist} - ${songRequest[0].title}) is up next!`);
          } else {
            await this.client.sendTwitchMessage(
              `@${userName} Your next song (${songRequest[0].artist} - ${songRequest[0].title}) is in position ` +
              `${remaining.numSongRequests} in the queue, playing in about ${formatTime(remaining.totalDuration)}.`
            );
          }
        }
      }
    } else if (commandName === '!remove') {
      // Find a valid song request to cancel
      const res = await queries.mostRecentlyRequestedSongByUser(userName);
      if (res[0]) {
        await db.updateTable('songRequests')
          .set({ status: 'cancelled', fulfilledAt: new Date().toUTCString() })
          .where('id', '=', res[0].id)
          .execute();
        this.wss.broadcast({
          type: 'song_request_removed',
          songRequestId: res[0].id,
        });
        await this.client.sendTwitchMessage(`@${userName} ${res[0].artist} - ${res[0].title} has been removed from the queue.`);
      } else {
        await this.client.sendTwitchMessage(`@${userName} You don't have any queued songs to cancel!`);
      }
    } else if (commandName === '!songlist') {
      const MAX_RESPONSE_SONGS = 5;
      const res = await queries.songRequestQueue();
      if (res.length === 0) {
        await this.client.sendTwitchMessage(`@${userName} The song request queue is empty.`);
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
    }

    this.userCommandHistory[userName].push([commandName, now]);
  };

  private handleTwitchRewardRedemption = async (payload: StreamerbotEventPayload<"Twitch.RewardRedemption">) => {
    const rewardName = Streamerbot.rewardNameById(payload.data.reward.id);
    if (!rewardName) return;

    try {
      if (rewardName === 'Long Song Request') {
        await this.handleUserSongRequest(
          payload.data.user_input,
          payload.data.user_name,
          LONG_SONG_REQUEST_MAX_DURATION,
          await this.songRequestMaxCountForUser(payload.data.user_name),
          0,
          false,
          payload.data.reward.id,
          payload.data.id
        );
      } else if (rewardName === 'Priority Song Request') {
        const existingRequest = await this.getExistingSongRequest(
          payload.data.user_input.trim().toLowerCase(),
          payload.data.user_name
        );
        if (existingRequest) {
          await db.updateTable('songRequests')
            .set({ priority: 5 })
            .where('id', '=', existingRequest.id)
            .execute();
          await this.client.sendTwitchMessage(`@${payload.data.user_name} Your song request for ${existingRequest.artist} - ${existingRequest.title} has been bumped!`);
        } else {
          await this.handleUserSongRequest(
            payload.data.user_input,
            payload.data.user_name,
            await this.songRequestMaxDurationForUser(payload.data.user_name),
            0,
            5,
            false,
            payload.data.reward.id,
            payload.data.id
          );
        }
      } else if (rewardName === 'No Shens Song Request') {
        const existingRequest = await this.getExistingSongRequest(
          payload.data.user_input.trim().toLowerCase(),
          payload.data.user_name
        );
        if (existingRequest) {
          await db.updateTable('songRequests')
            .set({ noShenanigans: 1 })
            .where('id', '=', existingRequest.id)
            .execute();
        } else {
          await this.handleUserSongRequest(
            payload.data.user_input,
            payload.data.user_name,
            await this.songRequestMaxDurationForUser(payload.data.user_name),
            await this.songRequestMaxCountForUser(payload.data.user_name),
            0,
            true,
            payload.data.reward.id,
            payload.data.id
          );
        }
      }
    } catch (err) {
      await this.client.updateTwitchRedemption(payload.data.reward.id, payload.data.id, 'cancel');
      await this.client.sendTwitchMessage(`@${payload.data.user_name} ${rewardName} has been refunded`);
    }
  }
}
