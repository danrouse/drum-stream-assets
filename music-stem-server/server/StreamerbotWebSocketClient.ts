import { StreamerbotClient, StreamerbotEventPayload, StreamerbotViewer } from '@streamerbot/client';
import { sql } from 'kysely';
import SongRequestModule from './features/SongRequestModule';
import MIDIModule from './features/MIDIModule';
import { db } from './database';
import * as queries from './queries';
import { createLogger, formatTime } from '../../shared/util';
import { get7tvEmotes } from '../../shared/twitchEmotes';
import { WebSocketMessage, WebSocketBroadcaster, SongData } from '../../shared/messages';
import { getKitDefinition, td30KitsPastebin } from '../../shared/td30Kits';
import * as Streamerbot from '../../shared/streamerbot';

type StreamerbotTwitchRewardMeta<T> = { [name in Streamerbot.TwitchRewardName]?: T };

const TwitchRewardDurations: StreamerbotTwitchRewardMeta<number> = {
  'Slow Down Music': 60000,
  'Speed Up Music': 60000,
  'Fart Mode': 30000,
  'Randomize Drums': 30000,
  'Randomize EVERY HIT': 30000,
  'Change Drum Kit': 120000,
  'Disable Shenanigans (Current Song)': 5000000,
  'Reset All Shenanigans': 0,
  'Pin an Emote': 30000,

  'Motorcycle Helmet': 300000,
  'Pick ONE Hat': 180000,
  'Pick TWO Hats': 180000,
  'Pick THREE Hats': 180000,
};

const TwitchRewardAmounts: StreamerbotTwitchRewardMeta<number> = {
  'Slow Down Music': 0.15,
  'Speed Up Music': 0.15,
};

const TwitchRewardGroups: Streamerbot.TwitchRewardName[][] = [
  ['Fart Mode', 'Randomize Drums', 'Randomize EVERY HIT'],
  ['Motorcycle Helmet', 'Pick ONE Hat', 'Pick TWO Hats', 'Pick THREE Hats'],
];

const DisableableShenanigans: Streamerbot.TwitchRewardName[] = [
  'Mute Song\'s Drums', 'Mute Song\'s Vocals',
  'Slow Down Music', 'Speed Up Music',
  'Fart Mode',
  'Randomize Drums', 'Randomize EVERY HIT',
  'Disable Shenanigans (Current Song)', 'Reset All Shenanigans',
  // 'Change Drum Kit'
];

const BOT_TWITCH_USER_ID = '1148563762';

const SONG_REQUEST_MAX_DURATION = 60 * 7;
const LONG_SONG_REQUEST_MAX_DURATION = 15 * 60;
const SPEED_CHANGE_BASE_PRICE = 150;

enum StreamerbotUserRole {
  Viewer = 1,
  VIP = 2,
  Moderator = 3,
  Broadcaster = 4,
}

export default class StreamerbotWebSocketClient {
  private client: StreamerbotClient;
  private midiController: MIDIModule;
  private broadcast: WebSocketBroadcaster;
  private songRequestHandler: SongRequestModule;

  private twitchMessageIdsByUser: { [userName: string]: string } = {};
  private twitchUnpauseTimers: { [rewardName in Streamerbot.TwitchRewardName]?: NodeJS.Timeout } = {};
  private twitchDebounceQueue: { [key: string]: number } = {};
  private userCommandHistory: { [username: string]: [string, number][] } = {};
  private streamerbotActionQueue: Array<[Streamerbot.ActionName, any]> = [];
  private kitResetTimer?: NodeJS.Timeout;
  private updateViewersTimer?: NodeJS.Timeout;
  private currentScene?: string;
  private viewers: Array<StreamerbotViewer & { online: boolean }> = [];
  private previousMessage: string = '';
  private previousMessageUser: string = '';
  private messageRepeatTimer?: NodeJS.Timeout;

  private isConnected = false;
  private isTestMode = false;

  private isShenanigansEnabled = true;
  private lastSongWasNoShens = false;
  private pinNextEmoteForUser?: string;
  private currentSong?: SongData;
  private currentSongSelectedAtTime?: string;

  constructor(
    broadcast: WebSocketBroadcaster,
    songRequestModule: SongRequestModule,
    midiModule: MIDIModule,
    isTestMode?: boolean,
  ) {
    this.client = new StreamerbotClient({
      onConnect: async () => {
        this.isConnected = true;
        while (this.streamerbotActionQueue.length) {
          const action = this.streamerbotActionQueue.shift()!;
          await this.doAction(action[0], action[1]);
        }
        this.updateActiveViewers();
        this.updateViewersTimer = setInterval(() => {
          this.updateActiveViewers();
        }, 10000);
      },
      onDisconnect: () => {
        this.isConnected = false;
        if (this.updateViewersTimer) clearInterval(this.updateViewersTimer);
        this.log('Disconnected from Streamer.bot!');
      },
      onError: (err) => {
        this.log('Streamer.bot error:', err);
      },
      retries: 50,
    });
    this.client.on('Application.*', async () => {});
    this.client.on('Twitch.ChatMessage', this.handleTwitchChatMessage.bind(this));
    this.client.on('Twitch.RewardRedemption', this.handleTwitchRewardRedemption.bind(this));
    this.client.on('Command.Triggered', this.handleCommandTriggered.bind(this));
    this.client.on('General.Custom', this.handleCustom.bind(this));
    this.client.on('Obs.SceneChanged', this.handleOBSSceneChanged.bind(this));
    this.client.on('Obs.StreamingStarted', this.handleOBSStreamingStarted.bind(this));
    this.client.on('Obs.StreamingStopped', this.handleOBSStreamingStopped.bind(this));

    this.broadcast = broadcast;
    this.songRequestHandler = songRequestModule;
    this.midiController = midiModule;
    this.isTestMode = Boolean(isTestMode);
    if (isTestMode) {
      this.log('Starting in test mode');
    }
  }

  public messageHandler = async (payload: WebSocketMessage) => {
    if (payload.type === 'song_speed') {
      this.handleSongSpeedChanged(payload.speed);
    } else if (payload.type === 'song_changed') {
      this.handleSongChanged(payload.song);
    } else if (payload.type === 'guess_the_song_round_complete') {
      this.handleGuessTheSongRoundComplete(payload.winner, payload.time, payload.otherWinners);
    } else if (payload.type === 'song_played') {
      await this.doAction('Queue: Pause', { queueName: 'TTS' });
    } else if (payload.type === 'song_playpack_paused') {
      await this.doAction('Queue: Unpause', { queueName: 'TTS' });
    } else if (payload.type === 'song_playback_started') {
      this.handleSongStarted(payload.id, payload.songRequestId);
    } else if (payload.type === 'song_playback_completed') {
      this.handleSongEnded(payload.id, payload.songRequestId);
    } else if (payload.type === 'song_request_removed') {
      // Refund reward redemption SRs if removed
      // REFUND DISABLED: priority song requests were getting refunded if
      // not going directly (like "my song in queue" and then doing it manually)

      // const row = await db.selectFrom('songRequests')
      //   .select(['twitchRewardId', 'twitchRedemptionId'])
      //   .where('id', '=', payload.songRequestId)
      //   .execute();
      // if (row[0].twitchRewardId && row[0].twitchRedemptionId) {
      //   this.updateTwitchRedemption(row[0].twitchRewardId, row[0].twitchRedemptionId, 'cancel');
      // }
    }
  };

  private log = createLogger('StreamerbotWSC');

  public async doAction(actionName: Streamerbot.ActionName, args?: any) {
    if (!this.isConnected) {
      this.streamerbotActionQueue.push([actionName, args]);
      this.log('Disconnected, queuing action', actionName, args);
      return;
    }
    const action = Streamerbot.Actions.actions.find(action =>
      actionName.toLowerCase() === action.name.toLowerCase()
    );
    if (!action) {
      this.log('doAction: Unknown action', actionName);
      return;
    }
    const actionId = action.id;
    this.log('doAction', actionName, actionId, args);
    if (this.isTestMode) return;

    // const result = await this.client.doAction(actionId, args);
    const result = await this.client.request({
      request: "DoAction",
      action: {
        id: actionId,
        name: undefined,
      },
      args
    }, undefined, 30000);

    if (result.status === 'error') {
      this.streamerbotActionQueue.push([actionName, args]);
      this.log('doAction error, queueing retry...');
    }
    return result;
  }

  private async handleSongStarted(songId: number, songRequestId?: number | null) {
    // Create stream marker for song request start
    let markerName = `Song Start: Song #${songId}`;
    if (songRequestId) {
      markerName += ` SR #${songRequestId}`;
    }
    await this.doAction('Create Stream Marker', { description: markerName });
  }

  private async handleSongEnded(songId: number, songRequestId?: number | null) {
    // Create stream marker for song request end
    let markerName = `Song End: Song #${songId}`;
    if (songRequestId) {
      markerName += ` SR #${songRequestId}`;
    }
    await this.doAction('Create Stream Marker', { description: markerName });

    // Add playback to history
    await db.insertInto('songHistory')
      .values([{
        songId: songId,
        songRequestId: songRequestId,
        startedAt: this.currentSongSelectedAtTime,
        endedAt: new Date().toISOString(),
      }])
      .execute();

    // Notify chat of any votes that happened during playback
    const votes = await queries.songVotesSinceTime(songId, this.currentSongSelectedAtTime!);
    if (Number(votes[0].voteCount) > 0) {
      await this.sendTwitchMessage(`${this.currentSong?.artist} - ${this.currentSong?.title} score: ${votes[0].value}`);
    }
  }

  private async handleSongChanged(song: SongData) {
    // Notify user when their song request is starting
    if (song.requester && song.status === 'ready') {
      await this.sendTwitchMessage(`@${song.requester} ${song.artist} - ${song.title} is starting!`);
    }

    // Allow for "no-shenanigans" SRs
    if (song.noShenanigans) {
      await this.disableShenanigans();
      this.lastSongWasNoShens = true;
    } else if (this.lastSongWasNoShens) {
      await this.enableShenanigans();
      this.lastSongWasNoShens = false;
    }

    this.currentSong = song;
    this.currentSongSelectedAtTime = new Date().toISOString();
    this.updateFullscreenVideoEnabled();

    // Leave fullscreen video if we switch to a song that isn't a video
    if (this.currentScene === 'Fullscreen Video' && !this.currentSong?.isVideo) {
      await this.doAction('Set OBS Scene', {
        sceneName: 'Drums main'
      });
    }
  }

  private async handleSongSpeedChanged(playbackRate: number) {
    // Scale the price of speed up/slow down song redemptions based on current speed
    const speedDiffSteps = Math.abs(1 - playbackRate) / TwitchRewardAmounts['Speed Up Music']!;
    const isFaster = playbackRate > 1;
    const nextSlowDownPrice = Math.round(isFaster ?
      SPEED_CHANGE_BASE_PRICE - (speedDiffSteps * (SPEED_CHANGE_BASE_PRICE / 2)) :
      SPEED_CHANGE_BASE_PRICE + (speedDiffSteps * (SPEED_CHANGE_BASE_PRICE / 2)));
    const nextSpeedUpPrice = Math.round(!isFaster ?
      SPEED_CHANGE_BASE_PRICE - (speedDiffSteps * (SPEED_CHANGE_BASE_PRICE / 2)) :
      SPEED_CHANGE_BASE_PRICE + (speedDiffSteps * (SPEED_CHANGE_BASE_PRICE / 2)));

    await this.doAction('Reward: Change Price', {
      rewardId: Streamerbot.TwitchRewardIds['Slow Down Music'],
      price: nextSlowDownPrice,
    });
    await this.doAction('Reward: Change Price', {
      rewardId: Streamerbot.TwitchRewardIds['Speed Up Music'],
      price: nextSpeedUpPrice,
    });

    // Limit min/max speed within the realm of reason
    const MIN_PLAYBACK_SPEED = 0.4;
    const MAX_PLAYBACK_SPEED = 1.9;
    const slowDownRewardAction = playbackRate <= MIN_PLAYBACK_SPEED ? 'Reward: Pause' : 'Reward: Unpause';
    await this.doAction(slowDownRewardAction, { rewardId: Streamerbot.TwitchRewardIds['Slow Down Music'] });
    const speedUpRewardAction = playbackRate >= MAX_PLAYBACK_SPEED ? 'Reward: Pause' : 'Reward: Unpause';
    await this.doAction(speedUpRewardAction, { rewardId: Streamerbot.TwitchRewardIds['Speed Up Music'] });

    // Re-disable the rewards if shenanigans are off
    if (!this.isShenanigansEnabled) {
      await this.pauseTwitchRedemption('Slow Down Music', 1000 * 60 * 60 * 24);
      await this.pauseTwitchRedemption('Speed Up Music', 1000 * 60 * 60 * 24);
    }
  }

  private async handleGuessTheSongRoundComplete(winner?: string, time?: number, otherWinners: string[] = []) {
    if (winner && time) {
      // Record this round's winner
      const roundedTime = Math.round(time * 10) / 10;
      let message = `${winner} got the right answer quickest in ${roundedTime} seconds!`;
      if (otherWinners.length) message += ` (${otherWinners.join(', ')} also got it right!)`
      await this.sendTwitchMessage(message);

      db.insertInto('nameThatTuneScores').values([{
        name: winner,
        placement: 1,
      }].concat(otherWinners.map((name, i) => ({
        name,
        placement: i + 2,
      })))).execute();

      // Report win streaks
      const streak = await queries.nameThatTuneWinStreak();
      if (streak[0].streak > 1) {
        await this.sendTwitchMessage(`${winner} is on a ${streak[0].streak} round win streak!`);
      }
    }

    // Update scores in leaderboard
    const dailyScores = await queries.nameThatTuneScores()
      .where(sql<any>`datetime(createdAt) > (select datetime(createdAt) from streamHistory order by id desc limit 1)`)
      .execute();
    const weeklyScores = await queries.nameThatTuneScores()
      .where('createdAt', '>', sql<any>`datetime(\'now\', \'-7 day\')`)
      .execute();
    const lifetimeScores = await queries.nameThatTuneScores()
      .execute();
    this.broadcast({ type: 'guess_the_song_scores', daily: dailyScores, weekly: weeklyScores, lifetime: lifetimeScores });
  }

  public sendTwitchMessage(message: string, replyTo?: string, debounceKey?: string, debounceTime?: number) {
    if (debounceKey) {
      const now = Date.now();
      if (debounceTime && this.twitchDebounceQueue[debounceKey] + debounceTime > now) {
        return;
      }
      this.twitchDebounceQueue[debounceKey] = now;
    }
    return this.doAction('Twitch chat message', { message, replyTo });
  }

  public async handleTwitchChatMessage(payload: StreamerbotEventPayload<"Twitch.ChatMessage">) {
    if (payload.data.message.userId === BOT_TWITCH_USER_ID) return;

    // Streamerbot Command.Triggered events which were triggered by Twitch messages
    // don't include the messageId which triggered them, but the Twitch.ChatMessage
    // event gets triggered first, so store a mapping of userIds to messageIds for replies
    this.twitchMessageIdsByUser[payload.data.message.userId] = payload.data.message.msgId;

    const emotes = [
      ...payload.data.message.emotes.map(e => e.imageUrl),
      ...(await get7tvEmotes(payload.data.message.message.split(' '))),
    ];
    if (emotes.length) {
      this.broadcast({ type: 'emote_used', emoteURLs: emotes });

      // if someone redeemed Pin an Emote, take the first emote and pin it
      if (this.pinNextEmoteForUser?.toLowerCase() === payload.data.message.username.toLowerCase()) {
        this.broadcast({
          type: 'emote_pinned',
          emoteURL: emotes[0],
        });
        this.pauseTwitchRedemption('Pin an Emote', TwitchRewardDurations['Pin an Emote'], () => {
          this.broadcast({
            type: 'emote_pinned',
            emoteURL: null,
          });
        });
      }

      // if two people sent the same emote-only message twice in a row, echo it
      if (payload.data.message.message === this.previousMessage && payload.data.message.username !== this.previousMessageUser && !this.messageRepeatTimer) {
        const wholeMessageIsTwitchEmote = payload.data.message.emotes[0]?.startIndex === 0 &&
          payload.data.message.emotes[0]?.endIndex === payload.data.message.message.length - 1;
        const isOwnTwitchEmote = payload.data.message.emotes[0]?.name.startsWith('dannyt75');
        const wholeMessage7tvEmote = await get7tvEmotes([payload.data.message.message]);

        if ((wholeMessageIsTwitchEmote && isOwnTwitchEmote) || wholeMessage7tvEmote.length) {
          await this.sendTwitchMessage(payload.data.message.message);
          this.messageRepeatTimer = setTimeout(() => { delete this.messageRepeatTimer; }, 30000);
        }
      }
    }

    this.previousMessage = payload.data.message.message;
    this.previousMessageUser = payload.data.message.username;
    this.broadcast({
      type: 'chat_message',
      user: payload.data.message.displayName,
      message: payload.data.message.message,
    });
  }

  private async updateActiveViewers() {
    const res = await this.client.getActiveViewers();
    const viewers = res.viewers.map(v => ({ ...v, online: true }));
    for (let prevViewer of this.viewers) {
      if (!viewers.find(v => v.id === prevViewer.id)) {
        // viewer was in previous list but is no longer showing online
        // retain the viewer information but mark as offline
        prevViewer.online = false;
        viewers.push(prevViewer)
      }
    }
    this.viewers = viewers;
    this.broadcast({ type: 'viewers_update', viewers });
  }

  public updateTwitchRedemption(rewardId: string, redemptionId: string, action: 'cancel' | 'fulfill') {
    return this.doAction('Reward: Update Redemption', { rewardId, redemptionId, action });
  }

  private async pauseTwitchRedemption(rewardName: Streamerbot.TwitchRewardName, duration?: number, unpauseCallback?: () => void) {
    await this.doAction(
      'Reward: Pause',
      { rewardId: Streamerbot.TwitchRewardIds[rewardName] }
    );
    if (this.twitchUnpauseTimers[rewardName]) {
      clearTimeout(this.twitchUnpauseTimers[rewardName]);
    }
    if (duration) {
      this.twitchUnpauseTimers[rewardName] = setTimeout(
        () => {
          this.doAction(
            'Reward: Unpause',
            { rewardId: Streamerbot.TwitchRewardIds[rewardName] }
          );
          unpauseCallback?.();
        },
        duration
      );
    }
  }

  private async enableShenanigans() {
    this.isShenanigansEnabled = true;
    for (let rewardName of DisableableShenanigans) {
      if (this.twitchUnpauseTimers[rewardName]) {
        clearTimeout(this.twitchUnpauseTimers[rewardName]);
        delete this.twitchUnpauseTimers[rewardName];
      }
      if (Streamerbot.TwitchRewardIds[rewardName]) {
        this.doAction(
          'Reward: Unpause',
          { rewardId: Streamerbot.TwitchRewardIds[rewardName] }
        );
      }
    }
    await this.doAction('OBS Visibility Off', {
      sourceName: 'No shenanigans'
    });
  }

  private async disableShenanigans(duration?: number) {
    this.midiController.resetKit();
    Object.values(this.twitchUnpauseTimers).forEach(timer => clearTimeout(timer));

    this.broadcast({
      type: 'client_remote_control',
      action: 'Disable Shenanigans (Current Song)',
    });
    const actualDuration = duration === undefined ? 1000 * 60 * 60 * 24 : duration;
    if (actualDuration > 0) {
      this.isShenanigansEnabled = false;
      this.lastSongWasNoShens = true;
      for (let rewardName of DisableableShenanigans) {
        await this.pauseTwitchRedemption(rewardName);
      }
      await this.doAction('OBS Visibility On', {
        sourceName: 'No shenanigans'
      });
      this.twitchUnpauseTimers['Disable Shenanigans (Current Song)'] = setTimeout(() => {
        this.enableShenanigans();
      }, actualDuration);
    }
  }

  private async getViewer(userName: string) {
    let viewer = this.viewers.find(v => v.login.toLowerCase() === userName.toLowerCase());
    if (!viewer) {
      // Try one time to update the viewer list to find them
      await this.updateActiveViewers();
      viewer = this.viewers.find(v => v.login.toLowerCase() === userName.toLowerCase());
    }
    return viewer;
  }

  private async songRequestMaxDurationForUser(userName: string) {
    const viewer = await this.getViewer(userName);
    let maxDuration = SONG_REQUEST_MAX_DURATION; // 7 mins default max
    if (viewer?.role.toUpperCase() === 'VIP') maxDuration = 60 * 10; // 10 mins for VIP
    if (viewer?.role === 'Moderator') maxDuration = 60 * 20; // 20 mins for mod
    if (viewer?.role === 'Broadcaster') maxDuration = 12000;
    return maxDuration;
  }

  private async songRequestMaxCountForUser(userName: string) {
    const viewer = await this.getViewer(userName);
    let limit = 1;
    if (viewer?.subscribed) limit = 2;
    if (viewer?.role.toUpperCase() === 'VIP') limit = 2;
    if (viewer?.role === 'Moderator') limit = 0;
    if (viewer?.role === 'Broadcaster') limit = 0;
    return limit;
  }

  private async songRequestMinViewsForUser(userName: string) {
    const viewer = await this.getViewer(userName);
    let minViews: number | undefined = 1000;
    if (viewer?.subscribed) minViews = 100;
    if (viewer?.role.toUpperCase() === 'VIP') minViews = undefined;
    if (viewer?.role === 'Moderator') minViews = undefined;
    if (viewer?.role === 'Broadcaster') minViews = undefined;
    return minViews;
  }

  private async isUserAdmin(userName: string) {
    const viewer = await this.getViewer(userName);
    return viewer?.role === 'Broadcaster' || viewer?.role === 'Moderator';
  }

  private updateFullscreenVideoEnabled() {
    if (this.currentScene?.startsWith('Drums') && this.currentSong?.isVideo) {
      this.doAction(
        'Reward: Unpause',
        { rewardId: Streamerbot.TwitchRewardIds['Fullscreen Video'] }
      );
    } else {
      this.pauseTwitchRedemption('Fullscreen Video');
    }
  }

  private enableFartMode(duration: number) {
    this.midiController.muteToms(!this.kitResetTimer);
    if (this.kitResetTimer) {
      clearTimeout(this.kitResetTimer);
      delete this.kitResetTimer;
    }
    this.kitResetTimer = setTimeout(() => {
      this.midiController.resetKit();
      delete this.kitResetTimer;
    }, duration);
  }

  private enableRandomizedDrums(duration: number, randomizeEveryHit: boolean) {
    this.midiController.randomize(!randomizeEveryHit);
    if (this.kitResetTimer) {
      clearTimeout(this.kitResetTimer);
      delete this.kitResetTimer;
    }
    this.kitResetTimer = setTimeout(() => {
      this.midiController.resetKit();
      delete this.kitResetTimer;
    }, duration);
  }

  private async handleTwitchRewardRedemption(payload: StreamerbotEventPayload<"Twitch.RewardRedemption">) {
    if (!Object.values(Streamerbot.TwitchRewardIds).includes(payload.data.reward.id)) {
      // A reward was redeemed that is not defined here, nothing to do!
      return;
    }

    const rewardName = Object.entries(Streamerbot.TwitchRewardIds)
      .find(([name, id]) => id === payload.data.reward.id)![0] as Streamerbot.TwitchRewardName;
    this.log(`Channel point redemption by ${payload.data.user_name}: ${rewardName}`);

    if (rewardName === 'Disable Shenanigans (Current Song)' || rewardName === 'Reset All Shenanigans') {
      this.disableShenanigans(TwitchRewardDurations[rewardName]!);
    } else if (rewardName === 'Fart Mode') {
      this.enableFartMode(TwitchRewardDurations[rewardName]!);
    } else if (rewardName === 'Randomize Drums' || rewardName === 'Randomize EVERY HIT') {
      this.enableRandomizedDrums(TwitchRewardDurations[rewardName]!, rewardName === 'Randomize Drums');
    } else if (rewardName === 'Change Drum Kit') {
      const kit = getKitDefinition(payload.data.user_input);
      if (!kit) {
        await this.sendTwitchMessage(`${payload.data.user_name}, please include one of the numbers or names of a kit from here: ${td30KitsPastebin} (refunded!)`);
        await this.updateTwitchRedemption(payload.data.reward.id, payload.data.id, 'cancel');
        return;
      }
      this.midiController.changeKit(kit[0], !this.kitResetTimer);
      if (this.kitResetTimer) {
        clearTimeout(this.kitResetTimer);
        delete this.kitResetTimer;
      }
      await this.sendTwitchMessage(`Drum kit has been changed to ${kit[1]} for two minutes!`);
      this.kitResetTimer = setTimeout(() => {
        this.midiController.resetKit();
        delete this.kitResetTimer;
      }, TwitchRewardDurations[rewardName]);
    } else if (rewardName === 'Long Song Request') {
      try {
        await this.handleSongRequest(
          payload.data.user_input,
          payload.data.user_name,
          LONG_SONG_REQUEST_MAX_DURATION,
          await this.songRequestMaxCountForUser(payload.data.user_name),
          0,
          false,
          payload.data.reward.id,
          payload.data.id
        );
      } catch (err) {
        await this.updateTwitchRedemption(payload.data.reward.id, payload.data.id, 'cancel');
        await this.sendTwitchMessage(`@${payload.data.user_name} ${rewardName} has been refunded`);
      }
      return;
    } else if (rewardName === 'Priority Song Request') {
      const existingRequest = await this.songRequestHandler.getExistingSongRequest(
        payload.data.user_input.trim().toLowerCase(),
        payload.data.user_name
      );
      if (existingRequest) {
        await db.updateTable('songRequests')
          .set({ priority: 5 })
          .where('id', '=', existingRequest.id)
          .execute();
        await this.sendTwitchMessage(`@${payload.data.user_name} Your song request for ${existingRequest.artist} - ${existingRequest.title} has been bumped!`);
      } else {
        try {
          await this.handleSongRequest(
            payload.data.user_input,
            payload.data.user_name,
            await this.songRequestMaxDurationForUser(payload.data.user_name),
            0,
            5,
            false,
            payload.data.reward.id,
            payload.data.id
          );
        } catch (err) {
          await this.updateTwitchRedemption(payload.data.reward.id, payload.data.id, 'cancel');
          await this.sendTwitchMessage(`@${payload.data.user_name} ${rewardName} has been refunded`);
        }
      }
      return;
    } else if (rewardName === 'No Shens Song Request') {
      const existingRequest = await this.songRequestHandler.getExistingSongRequest(
        payload.data.user_input.trim().toLowerCase(),
        payload.data.user_name
      );
      if (existingRequest) {
        await db.updateTable('songRequests')
          .set({ noShenanigans: 1 })
          .where('id', '=', existingRequest.id)
          .execute();
      } else {
        try {
          await this.handleSongRequest(
            payload.data.user_input,
            payload.data.user_name,
            await this.songRequestMaxDurationForUser(payload.data.user_name),
            await this.songRequestMaxCountForUser(payload.data.user_name),
            0,
            true,
            payload.data.reward.id,
            payload.data.id
          );
        } catch (err) {
          await this.updateTwitchRedemption(payload.data.reward.id, payload.data.id, 'cancel');
          await this.sendTwitchMessage(`@${payload.data.user_name} ${rewardName} has been refunded`);
        }
      }
      return;
    } else if (rewardName === 'Fullscreen Video') {
      if (this.currentSong?.isVideo) {
        await this.doAction('Set OBS Scene', {
          sceneName: 'Fullscreen Video'
        });
      }
    } else if (rewardName === "Pin an Emote") {
      this.pinNextEmoteForUser = payload.data.user_name;
    }

    // If we haven't returned from an error yet, broadcast changes to the player UI
    this.broadcast({
      type: 'client_remote_control',
      action: rewardName,
      duration: TwitchRewardDurations[rewardName],
      amount: TwitchRewardAmounts[rewardName],
    });

    // For mutually-exclusive rewards, pause everything in the category
    // until this redemption expires
    const mutuallyExclusiveGroup = TwitchRewardGroups.find(rewardNames => rewardNames.includes(rewardName));
    if (mutuallyExclusiveGroup && TwitchRewardDurations[rewardName]) {
      for (let otherRewardName of mutuallyExclusiveGroup) {
        await this.pauseTwitchRedemption(otherRewardName, TwitchRewardDurations[rewardName]);
      }
    }
  }

  public async handleCommandTriggered(payload: StreamerbotEventPayload<"Command.Triggered">) {
    const message = payload.data.message.trim();
    const userName = payload.data.user.display; // user.display vs user.name?
    const commandName = Streamerbot.CommandAliases[payload.data.command];

    // Unregistered command triggered
    if (!commandName) return;

    this.log('Command triggered', payload.data.command, commandName, userName, message);

    this.userCommandHistory[userName] ||= [];
    const [_, lastUsage] = this.userCommandHistory[userName].findLast(([command, time]) => command === commandName) || [];
    const now = Date.now();

    if (commandName === 'song request') {
      try {
        await this.handleSongRequest(
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
        await this.sendTwitchMessage(`@${userName} You don't have any songs in the request queue!`);
      } else {
        const FIVE_MINUTES = 5 * 60 * 1000;
        if (lastUsage && now - lastUsage < FIVE_MINUTES) {
          // const pastUsageCount = this.commandHistory[userName].filter(([command, time]) => command === commandName && now - time < FIVE_MINUTES).length;
          // if (pastUsageCount > 2) {
          //   await this.sendTwitchMessage(`@${userName} Your song has been removed from the queue, you can go listen to it on Spotify instead.`);
          // } else {
            await this.sendTwitchMessage(`@${userName} Your song could be playing *right now* if you go to spotify.com - no paid account needed! Be patient.`);
          // }
        } else {
          const remaining = await queries.getTimeUntilSongRequest(songRequest[0].id);
          if (remaining.numSongRequests === 1) {
            await this.sendTwitchMessage(`@${userName} Your song (${songRequest[0].artist} - ${songRequest[0].title}) is up next!`);
          } else {
            await this.sendTwitchMessage(
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
        this.broadcast({
          type: 'song_request_removed',
          songRequestId: res[0].id,
        });
        await this.sendTwitchMessage(`@${userName} ${res[0].artist} - ${res[0].title} has been removed from the queue.`);
      } else {
        await this.sendTwitchMessage(`@${userName} You don't have any queued songs to cancel!`);
      }
    } else if (commandName === '!songlist') {
      const MAX_RESPONSE_SONGS = 5;
      const res = await queries.songRequestQueue();
      if (res.length === 0) {
        await this.sendTwitchMessage(`@${userName} The song request queue is empty.`);
      } else {
        await this.sendTwitchMessage(
          `There ${res.length > 1 ? 'are' : 'is'} ${res.length} song${res.length > 1 ? 's' : ''} in queue: ` +
          res.slice(0, MAX_RESPONSE_SONGS).map(s =>
            `${s.artist} - ${s.title}`.substring(0, 32) + (`${s.artist} - ${s.title}`.length > 32 ? '...' : '') +
            ` [${formatTime(s.duration)}]`
          ).join(', ') +
          (res.length > MAX_RESPONSE_SONGS ? ` (+ ${res.length - MAX_RESPONSE_SONGS} more)` : '')
        );
        const totalTime = res.reduce((acc, cur) => acc + cur.duration, 0);
        await this.sendTwitchMessage(`The queue has ${res.length} song${res.length > 1 ? 's' : ''} and a length of ${formatTime(totalTime)}.`)
      }
    } else if (commandName === 'Vote ++' || commandName === 'Vote --') {
      if (!this.currentSong) return;
      let value = 1;
      if (commandName === 'Vote --') value = -1;
      const existingVote = await queries.existingSongVoteForUser(this.currentSong.id, userName);
      if (existingVote.length > 0) {
        await db.updateTable('songVotes')
          .set({ value, createdAt: sql`current_timestamp` })
          .where('id', '=', existingVote[0].id)
          .execute();
      } else {
        await db.insertInto('songVotes').values([{
          songId: this.currentSong!.id,
          voterName: userName,
          value,
        }]).execute();
      }
      const newSongValue = await queries.songVoteScore(this.currentSong.id);
      await this.sendTwitchMessage(
        `@${userName} Current score for ${this.currentSong.artist} - ${this.currentSong.title}: ${newSongValue[0].value}`,
        undefined,
        'songVoteResponse',
        5000
      );
    } else if (commandName === '!today') {
      const res = await queries.songsPlayedTodayCount();
      await this.sendTwitchMessage(`${res[0].count} songs have been played today. ${'🥁'.repeat(res[0].count)}`);
    }

    this.userCommandHistory[userName].push([commandName, now]);
  }

  private handleCustom(payload: StreamerbotEventPayload<"General.Custom">) {
    if (payload.data.data === 'NoShenanigans') {
      if (this.isShenanigansEnabled) {
        this.disableShenanigans();
      } else {
        this.enableShenanigans();
      }
    }
  }

  private handleOBSSceneChanged(payload: StreamerbotEventPayload<"Obs.SceneChanged">) {
    this.currentScene = payload.data.scene.sceneName;
    this.updateFullscreenVideoEnabled();
    this.broadcast({
      type: 'obs_scene_changed',
      oldScene: payload.data.oldScene.sceneName,
      scene: payload.data.scene.sceneName,
    });
  }

  private async handleOBSStreamingStarted(payload: StreamerbotEventPayload<"Obs.StreamingStarted">) {
    await db.insertInto('streamHistory')
      .defaultValues()
      .execute();
  }

  private async handleOBSStreamingStopped(payload: StreamerbotEventPayload<"Obs.StreamingStopped">) {
    const record = await queries.currentStreamHistory();
    await db.updateTable('streamHistory')
      .set('endedAt', sql`current_timestamp`)
      .where('id', '=', record[0].id)
      .execute();
  }

  private async handleSongRequest(
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
      await this.sendTwitchMessage(
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
          await this.sendTwitchMessage(`@${fromUsername} Your next song request will be available in ${formatTime((availableAt - now) / 1000)}! (wait at least the length of your last requested song for your next one)`);
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
      await this.doAction('!how');
      throw new Error('MINIMUM_QUERY_LENGTH');
    }

    let hasResponded = false;
    setTimeout(async () => {
      if (!hasResponded) {
        await this.sendTwitchMessage(`Working on it, @${fromUsername}! Give me a moment to download that song.`);
      }
    }, 500);

    const minViews = await this.songRequestMinViewsForUser(fromUsername);
    const songRequestId = await this.songRequestHandler.execute(
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
        const viewer = this.viewers.find(v => v.login.toLowerCase() === fromUsername.toLowerCase());
        if (viewer?.subscribed) {
          const requestsFromUserToday = await queries.requestsByUserToday(fromUsername);
          if (requestsFromUserToday.length === 1 && requestsFromUserToday[0].priority === 0) {
            await db.updateTable('songRequests')
              .set({ priority: 1 })
              .where('id', '=', songRequestId)
              .execute();
            await this.sendTwitchMessage(`@${fromUsername} Your first song request of the day has been bumped up!`);
          }
        }

        const waitTime = await queries.getTimeUntilSongRequest(songRequestId);
        const timeRemaining = waitTime.numSongRequests > 1 ? ` (~${formatTime(Number(waitTime.totalDuration))} from now)` : '';
        await this.sendTwitchMessage(`@${fromUsername} ${songTitle} was added to the queue in position ${waitTime.numSongRequests}${timeRemaining}`);
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
        await this.sendTwitchMessage(`@${fromUsername} ${message}`);
        hasResponded = true;
        // TODO: rethrow to allow to catch for refund
        // throw e;
      }
    );
  }
}
