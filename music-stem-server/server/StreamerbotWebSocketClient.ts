import { StreamerbotClient, StreamerbotEventPayload, StreamerbotViewer } from '@streamerbot/client';
import { sql } from 'kysely';
import { db } from './database';
import * as queries from './queries';
import { createLogger } from '../../shared/util';
import { get7tvEmotes } from '../../shared/twitchEmotes';
import { WebSocketMessage, WebSocketBroadcaster, SongData } from '../../shared/messages';
import * as Streamerbot from '../../shared/streamerbot';

export const TwitchRewardDurations: Streamerbot.TwitchRewardMeta<number> = {
  'Pin an Emote': 30000,

  'Motorcycle Helmet': 300000,
  'Pick ONE Hat': 180000,
  'Pick TWO Hats': 180000,
  'Pick THREE Hats': 180000,

  // TODO: Find a way to relocate these into ShenanigansModule
  'Slow Down Music': 60000,
  'Speed Up Music': 60000,
  'Fart Mode': 30000,
  'Randomize Drums': 30000,
  'Randomize EVERY HIT': 30000,
  'Change Drum Kit': 120000,
};

const TwitchRewardGroups: Streamerbot.TwitchRewardName[][] = [
  ['Fart Mode', 'Randomize Drums', 'Randomize EVERY HIT'],
  ['Motorcycle Helmet', 'Pick ONE Hat', 'Pick TWO Hats', 'Pick THREE Hats'],
];

const BOT_TWITCH_USER_ID = '1148563762';

export default class StreamerbotWebSocketClient {
  private client: StreamerbotClient;
  private broadcast: WebSocketBroadcaster;

  private twitchMessageIdsByUser: { [userName: string]: string } = {};
  private twitchUnpauseTimers: { [rewardName in Streamerbot.TwitchRewardName]?: NodeJS.Timeout } = {};
  private twitchDebounceQueue: { [key: string]: number } = {};
  private streamerbotActionQueue: Array<[Streamerbot.ActionName, any]> = [];
  private updateViewersTimer?: NodeJS.Timeout;
  private currentScene?: string;
  private viewers: Array<StreamerbotViewer & { online: boolean }> = [];
  private previousMessage: string = '';
  private previousMessageUser: string = '';
  private messageRepeatTimer?: NodeJS.Timeout;

  private isConnected = false;
  private isTestMode = false;

  private pinNextEmoteForUser?: string;
  private currentSong?: SongData;
  private currentSongSelectedAtTime?: string;

  public on: typeof StreamerbotClient.prototype.on;

  constructor(
    broadcast: WebSocketBroadcaster,
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
    this.client.on('Obs.SceneChanged', this.handleOBSSceneChanged.bind(this));
    this.client.on('Obs.StreamingStarted', this.handleOBSStreamingStarted.bind(this));
    this.client.on('Obs.StreamingStopped', this.handleOBSStreamingStopped.bind(this));
    this.on = this.client.on;

    this.broadcast = broadcast;
    this.isTestMode = Boolean(isTestMode);
    if (isTestMode) {
      this.log('Starting in test mode');
    }
  }

  public messageHandler = async (payload: WebSocketMessage) => {
    if (payload.type === 'song_changed') {
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

  public async pauseTwitchRedemption(
    rewardName: Streamerbot.TwitchRewardName,
    duration?: number,
    unpauseCallback?: () => void
  ) {
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

  public unpauseTwitchRedemption(rewardName: Streamerbot.TwitchRewardName) {
    if (this.twitchUnpauseTimers[rewardName]) {
      clearTimeout(this.twitchUnpauseTimers[rewardName]);
      delete this.twitchUnpauseTimers[rewardName];
    }
    return this.client.doAction(
      'Reward: Unpause',
      { rewardId: Streamerbot.TwitchRewardIds[rewardName] }
    );
  }

  public destroyUnpauseTimers() {
    Object.values(this.twitchUnpauseTimers).forEach(timer => clearTimeout(timer));
  }

  public async getViewer(userName: string) {
    let viewer = this.viewers.find(v => v.login.toLowerCase() === userName.toLowerCase());
    if (!viewer) {
      // Try one time to update the viewer list to find them
      await this.updateActiveViewers();
      viewer = this.viewers.find(v => v.login.toLowerCase() === userName.toLowerCase());
    }
    return viewer;
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

  private async handleTwitchRewardRedemption(payload: StreamerbotEventPayload<"Twitch.RewardRedemption">) {
    const rewardName = Streamerbot.rewardNameById(payload.data.reward.id);
    if (!rewardName) return;

    this.log(`Channel point redemption by ${payload.data.user_name}: ${rewardName}`);

    if (rewardName === 'Fullscreen Video') {
      if (this.currentSong?.isVideo) {
        await this.doAction('Set OBS Scene', {
          sceneName: 'Fullscreen Video'
        });
      }
    } else if (rewardName === 'Pin an Emote') {
      this.pinNextEmoteForUser = payload.data.user_name;
    }

    // For mutually-exclusive rewards, pause everything in the category
    // until this redemption expires
    const mutuallyExclusiveGroup = TwitchRewardGroups.find(rewardNames => rewardNames.includes(rewardName));
    if (mutuallyExclusiveGroup && TwitchRewardDurations[rewardName]) {
      for (let otherRewardName of mutuallyExclusiveGroup) {
        await this.pauseTwitchRedemption(otherRewardName, TwitchRewardDurations[rewardName]);
      }
    }
  }

  private async handleCommandTriggered(payload: StreamerbotEventPayload<"Command.Triggered">) {
    const userName = payload.data.user.display;
    const commandName = Streamerbot.CommandAliases[payload.data.command];

    // Unregistered command triggered
    if (!commandName) return;

    this.log('Command triggered', payload.data.command, commandName, userName, payload.data.message);

    if (commandName === 'Vote ++' || commandName === 'Vote --') {
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
}
