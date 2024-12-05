import { StreamerbotClient, StreamerbotEventPayload, StreamerbotViewer } from '@streamerbot/client';
import { SongDownloadError } from './wrappers/spotdl';
import SongRequestHandler from './SongRequestHandler';
import MIDIIOController from './MIDIIOController';
import { db } from './database';
import { formatTime } from '../../shared/util';
import { get7tvEmotes } from '../../shared/twitchEmotes';
import { ChannelPointReward, WebSocketServerMessage, WebSocketPlayerMessage, WebSocketBroadcaster } from '../../shared/messages';
import { getKitDefinition, td30KitsPastebin } from '../../shared/td30Kits';
import StreamerbotActions from '../../streamer.bot/data/actions.json';

type StreamerbotActionName =
  'Reward: Change Price' |
  'Reward: Pause' |
  'Reward: Unpause' |
  'Reward: Update Redemption' |
  'Twitch chat message' |
  'Toggle OBS graphic' |
  '!how';

interface IdMap { [name: string]: string }

const REWARD_IDS: { [name in ChannelPointReward["name"]]: string } = {
  MuteCurrentSongDrums: '0dc1de6b-26fb-4a00-99ba-367b96d660a6',
  SlowDownCurrentSong: 'b07f3e10-7042-4c96-8ba3-e5e385c63aee',
  SpeedUpCurrentSong: '7f7873d6-a017-4a2f-a075-7ad098e65a92',
  OopsAllFarts: 'e97a4982-a2f8-441a-afa9-f7d2d8ab11e1',
  ChangeDrumKit: '6e366bb7-508d-4419-89a4-32fdcf952419',
  NoShenanigans: '3fe13282-ba0a-412c-99af-f76a7c9f7c68',
  LongSong: '3db680fc-9fea-42c2-aed5-1e1b447b4842',
  PrioritySong: 'a8691f10-c763-45f3-8c77-945037bd4978',
};

const REWARD_DURATIONS: { [name in ChannelPointReward["name"]]?: number } = {
  MuteCurrentSongDrums: 120000,
  SlowDownCurrentSong: 120000,
  SpeedUpCurrentSong: 120000,
  OopsAllFarts: 60000,
  ChangeDrumKit: 120000,
  NoShenanigans: 180000,
};

const REWARD_AMOUNTS: { [name in ChannelPointReward["name"]]?: number } = {
  SlowDownCurrentSong: 0.15,
  SpeedUpCurrentSong: 0.15,
};

const MUTUALLY_EXCLUSIVE_REWARD_GROUPS: ChannelPointReward["name"][][] = [
];

const DISABLEABLE_REWARDS: ChannelPointReward["name"][] = [
  'MuteCurrentSongDrums',
  'SlowDownCurrentSong', 'SpeedUpCurrentSong',
  'OopsAllFarts', 'ChangeDrumKit',
];

const BOT_USER_ID = '1148563762';

enum StreamerbotUserRole {
  Viewer = 1,
  VIP = 2,
  Moderator = 3,
  Broadcaster = 4,
}

export default class StreamerbotWebSocketClient {
  private client: StreamerbotClient;
  private midiController: MIDIIOController;
  private broadcast: WebSocketBroadcaster;
  private songRequestHandler: SongRequestHandler;
  private twitchMessageIdsByUser: IdMap = {};
  private twitchUnpauseTimers: { [rewardName in ChannelPointReward["name"]]?: NodeJS.Timeout } = {};
  private kitResetTimer?: NodeJS.Timeout;
  private isShenanigansEnabled = true;
  private viewers: StreamerbotViewer[] = [];

  constructor(broadcast: WebSocketBroadcaster, songRequestHandler: SongRequestHandler, midiController: MIDIIOController) {
    this.client = new StreamerbotClient({
      onConnect: () => {
        this.updateActiveViewers();
      },
      onDisconnect: () => {
        console.warn('Disconnected from Streamer.bot!');
      },
      onError: (err) => {
        console.warn('Streamer.bot error:', err);
      },
      retries: 3,
    });
    this.client.on('Application.*', async () => {});
    this.client.on('Twitch.ChatMessage', this.handleTwitchChatMessage.bind(this));
    this.client.on('Twitch.RewardRedemption', this.handleTwitchRewardRedemption.bind(this));
    this.client.on('Command.Triggered', this.handleCommandTriggered.bind(this));
    this.client.on('General.Custom', this.handleCustom.bind(this));
    this.client.on('Obs.SceneChanged', this.handleOBSSceneChanged.bind(this));
    setInterval(() => {
      this.updateActiveViewers();
    }, 10000);

    this.broadcast = broadcast;
    this.songRequestHandler = songRequestHandler;
    this.midiController = midiController;
  }

  public messageHandler = async (payload: WebSocketServerMessage | WebSocketPlayerMessage) => {
    if (payload.type === 'song_speed') {
      // Scale the price of speed up/slow down song redemptions based on current speed
      const playbackRate = payload.speed;
      const speedDiffSteps = Math.abs(1 - playbackRate) / REWARD_AMOUNTS.SpeedUpCurrentSong!;
      const isFaster = playbackRate > 1;
      const nextSlowDownPrice = Math.round(isFaster ? 100 - (speedDiffSteps * 50) : 100 + (speedDiffSteps * 100));
      const nextSpeedUpPrice = Math.round(!isFaster ? 100 - (speedDiffSteps * 50) : 100 + (speedDiffSteps * 100));

      await this.doAction('Reward: Change Price', {
        rewardId: REWARD_IDS.SlowDownCurrentSong,
        price: nextSlowDownPrice,
      });
      await this.doAction('Reward: Change Price', {
        rewardId: REWARD_IDS.SpeedUpCurrentSong,
        price: nextSpeedUpPrice,
      });

      // Limit min/max speed within the realm of reason
      const MIN_PLAYBACK_SPEED = 0.4;
      const MAX_PLAYBACK_SPEED = 1.9;
      const slowDownRewardAction = playbackRate <= MIN_PLAYBACK_SPEED ? 'Reward: Pause' : 'Reward: Unpause';
      await this.doAction(slowDownRewardAction, { rewardId: REWARD_IDS.SlowDownCurrentSong });
      const speedUpRewardAction = playbackRate >= MAX_PLAYBACK_SPEED ? 'Reward: Pause' : 'Reward: Unpause';
      await this.doAction(speedUpRewardAction, { rewardId: REWARD_IDS.SpeedUpCurrentSong });
    } else if (payload.type === 'song_changed') {
      // Notify user when their song request is starting
      if (payload.song.requester && payload.song.status === 'ready') {
        await this.sendTwitchMessage(`@${payload.song.requester} ${payload.song.artist} - ${payload.song.title} is starting!`);
      }
    } else if (payload.type === 'guess_the_song_round_complete') {
      if (payload.winner && payload.time) {
        const roundedTime = Math.round(payload.time * 10) / 10;
        await this.sendTwitchMessage(`@${payload.winner} got the right answer in ${roundedTime} seconds!`);
      }
    }
  };

  public doAction(actionName: StreamerbotActionName, args?: any) {
    const actionId = StreamerbotActions.actions.find(action =>
      actionName.toLowerCase() === action.name.toLowerCase()
    )!.id;
    return this.client.doAction(actionId, args);
  }

  public sendTwitchMessage(message: string, replyTo?: string) {
    return this.doAction('Twitch chat message', { message, replyTo });
  }

  private async handleTwitchChatMessage(payload: StreamerbotEventPayload<"Twitch.ChatMessage">) {
    if (payload.data.message.userId === BOT_USER_ID) return;

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
    }

    this.broadcast({
      type: 'chat_message',
      user: payload.data.message.displayName,
      message: payload.data.message.message,
    });
  }

  private async updateActiveViewers() {
    const res = await this.client.getActiveViewers();
    this.viewers = res.viewers;
    this.broadcast({ type: 'viewers_update', viewers: res.viewers });
  }

  public updateTwitchRedemption(rewardId: string, redemptionId: string, action: 'cancel' | 'fulfill') {
    return this.doAction('Reward: Update Redemption', { rewardId, redemptionId, action });
  }

  private async pauseTwitchRedemption(rewardName: ChannelPointReward["name"], duration: number) {
    await this.doAction(
      'Reward: Pause',
      { rewardId: REWARD_IDS[rewardName] }
    );
    if (this.twitchUnpauseTimers[rewardName]) {
      clearTimeout(this.twitchUnpauseTimers[rewardName]);
    }
    this.twitchUnpauseTimers[rewardName] = setTimeout(
      () => this.client.doAction(
        'Reward: Unpause',
        { rewardId: REWARD_IDS[rewardName] }
      ),
      duration
    );
  }

  private async enableShenanigans() {
    this.isShenanigansEnabled = true;
    Object.keys(this.twitchUnpauseTimers).forEach((key) => {
      const rewardName = key as ChannelPointReward["name"];
      this.doAction(
        'Reward: Unpause',
        { rewardId: REWARD_IDS[rewardName] }
      )
      clearTimeout(this.twitchUnpauseTimers[rewardName]);
    });
    await this.doAction('Toggle OBS graphic', {
      sourceName: 'No shenanigans'
    });
  }

  private async disableShenanigans(duration?: number) {
    this.isShenanigansEnabled = false;
    this.midiController.resetKit();
    Object.values(this.twitchUnpauseTimers).forEach(timer => clearTimeout(timer));
    for (let otherRewardName of DISABLEABLE_REWARDS) {
      await this.pauseTwitchRedemption(otherRewardName, duration || (1000 * 60 * 60 * 24));
    }
    await this.doAction('Toggle OBS graphic', {
      sourceName: 'No shenanigans'
    });
  }

  private getMaxDurationForUser(userName: string) {
    const viewer = this.viewers.find(v =>  v.login.toLowerCase() === userName.toLowerCase());
    let maxDuration = 60 * 7; // 7 mins default max
    if (viewer?.role === 'VIP') maxDuration = 60 * 10; // 10 mins for VIP
    if (viewer?.role === 'Moderator') maxDuration = 60 * 20; // 20 mins for mod
    if (viewer?.role === 'Broadcaster') maxDuration = 12000;
    return maxDuration;
  }

  private getSongRequestLimitForUser(userName: string) {
    const viewer = this.viewers.find(v =>  v.login.toLowerCase() === userName.toLowerCase());
    let limit = 2;
    if (viewer?.subscribed) limit = 3;
    if (viewer?.role === 'VIP') limit = 3;
    if (viewer?.role === 'Moderator') limit = 0;
    if (viewer?.role === 'Broadcaster') limit = 0;
    return limit;
  }

  private async handleTwitchRewardRedemption(payload: StreamerbotEventPayload<"Twitch.RewardRedemption">) {  
    if (!Object.values(REWARD_IDS).includes(payload.data.reward.id)) {
      // A reward was redeemed that is not defined here, nothing to do!
      return;
    }

    const rewardName = Object.entries(REWARD_IDS)
      .find(([name, id]) => id === payload.data.reward.id)![0] as ChannelPointReward['name'];
    console.log('Redeem', rewardName);

    if (rewardName === 'NoShenanigans') {
      this.disableShenanigans(REWARD_DURATIONS[rewardName]!);
    } else if (rewardName === 'OopsAllFarts') {
      this.midiController.muteToms(!this.kitResetTimer);
      if (this.kitResetTimer) {
        clearTimeout(this.kitResetTimer);
        delete this.kitResetTimer;
      }
      this.kitResetTimer = setTimeout(() => {
        this.midiController.resetKit();
        delete this.kitResetTimer;
      }, REWARD_DURATIONS[rewardName]);
    } else if (rewardName === 'ChangeDrumKit') {
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
      }, REWARD_DURATIONS[rewardName]);
    } else if (rewardName === 'LongSong') {
      const LONG_SONG_MAX_DURATION = 15 * 60;
      try {
        await this.handleSongRequest(
          payload.data.user_input,
          payload.data.user_name,
          LONG_SONG_MAX_DURATION,
          this.getSongRequestLimitForUser(payload.data.user_name)
        );
      } catch (err) {
        await this.updateTwitchRedemption(payload.data.reward.id, payload.data.id, 'cancel');
      }
      return;
    } else if (rewardName === 'PrioritySong') {
      try {
        await this.handleSongRequest(
          payload.data.user_input,
          payload.data.user_name,
          this.getMaxDurationForUser(payload.data.user_name),
          0,
          true
        );
      } catch (err) {
        await this.updateTwitchRedemption(payload.data.reward.id, payload.data.id, 'cancel');
      }
      return;
    }

    // If we haven't returned from an error yet, broadcast changes to the player UI
    this.broadcast({
      type: 'client_remote_control',
      action: rewardName,
      duration: REWARD_DURATIONS[rewardName],
      amount: REWARD_AMOUNTS[rewardName],
    });
    
    // For mutually-exclusive rewards, pause everything in the category
    // until this redemption expires
    const mutuallyExclusiveGroup = MUTUALLY_EXCLUSIVE_REWARD_GROUPS.find(rewardNames => rewardNames.includes(rewardName));
    if (mutuallyExclusiveGroup && REWARD_DURATIONS[rewardName]) {
      for (let otherRewardName of mutuallyExclusiveGroup) {
        await this.pauseTwitchRedemption(otherRewardName, REWARD_DURATIONS[rewardName]);
      }
    }
  }

  private async handleCommandTriggered(payload: StreamerbotEventPayload<"Command.Triggered">) {
    const message = payload.data.message.trim();
    const userName = payload.data.user.display; // user.display vs user.name?
    // also available: bool user.subscribed, int user.role
    if (['!request', '!sr', '!ssr', '!songrequest', '!rs'].includes(payload.data.command)) {
      try {
        await this.handleSongRequest(message, userName, this.getMaxDurationForUser(userName), this.getSongRequestLimitForUser(userName));
      } catch (e) {
        console.info('Song reward redemption failed with error', e);
      }
    } else if (['!when', '!whenami', '!pos'].includes(payload.data.command)) {
      const songRequest = await this.songRequestHandler.getNextSongRequestByRequester(userName);
      if (!songRequest) {
        await this.sendTwitchMessage(`@${userName} You don't have any songs in the request queue!`);
      } else {
        const remaining = await this.songRequestHandler.getTimeUntilSongRequest(songRequest.id);
        if (remaining.numSongRequests === 1) {
          await this.sendTwitchMessage(`@${userName} Your song (${songRequest.artist} - ${songRequest.title}) is up next!`);
        } else {
          await this.sendTwitchMessage(
            `@${userName} Your next song (${songRequest.artist} - ${songRequest.title}) is in position ` +
            `${remaining.numSongRequests} in the queue, playing in about ${formatTime(remaining.totalDuration)}.`
          );
        }
      }
    } else if (['!remove', '!wrongsong', '!delete'].includes(payload.data.command)) {
      // Find a valid song request to cancel
      const res = await db.selectFrom('songRequests')
        .innerJoin('songs', 'songs.id', 'songRequests.songId')
        .select(['songRequests.id', 'songs.artist', 'songs.title'])
        .where('status', 'in', ['processing', 'ready'])
        .where('requester', '=', userName)
        .orderBy('songRequests.id desc')
        .limit(1)
        .execute();
      if (res[0]) {
        await db.updateTable('songRequests')
          .set({ status: 'cancelled', fulfilledAt: new Date().toUTCString() })
          .where('id', '=', res[0].id)
          .execute();
        this.broadcast({ type: 'song_requests_updated' });
        await this.sendTwitchMessage(`@${userName} ${res[0].artist} - ${res[0].title} has been removed from the queue.`);
      } else {
        await this.sendTwitchMessage(`@${userName} You don't have any queued songs to cancel!`);
      }
    } else if (['!sl', '!songlist', '!list', '!queue'].includes(payload.data.command)) {
      const MAX_RESPONSE_SONGS = 5;
      const res = await db.selectFrom('songRequests')
        .innerJoin('songs', 'songs.id', 'songRequests.songId')
        .where('songRequests.status', '=', 'ready')
        .select(['songs.title', 'songs.artist', 'songs.duration', 'songRequests.id'])
        .orderBy('songRequests.id asc')
        .execute();
      if (res.length === 0) {
        await this.sendTwitchMessage(`@${userName} The song request queue is empty.`);
      } else {
        await this.sendTwitchMessage(
          `@${userName} There ${res.length > 1 ? 'are' : 'is'} ${res.length} song${res.length > 1 ? 's' : ''} in queue: ` +
          res.slice(0, MAX_RESPONSE_SONGS).map(s =>
            `${s.artist} - ${s.title}`.substring(0, 32) + (`${s.artist} - ${s.title}`.length > 32 ? '...' : '') +
            ` [${formatTime(s.duration)}]`
          ).join(', ') +
          (res.length > MAX_RESPONSE_SONGS ? ` (+ ${res.length - MAX_RESPONSE_SONGS} more)` : '')
        );
      }
    }
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
    this.broadcast({
      type: 'obs_scene_changed',
      oldScene: payload.data.oldScene.sceneName,
      scene: payload.data.scene.sceneName,
    });
  }

  private async handleSongRequest(
    originalMessage: string,
    fromUsername: string,
    maxDuration: number,
    perUserLimit?: number,
    priority: boolean = false,
  ) {
    // Check if user already has the maximum ongoing song requests before processing
    const existingRequestCount = await db.selectFrom('songRequests')
      .select(db.fn.countAll().as('count'))
      .where('requester', '=', fromUsername)
      .where('status', '=', 'ready')
      .execute();
    if (perUserLimit && Number(existingRequestCount[0].count) >= perUserLimit) {
      await this.sendTwitchMessage(
        `@${fromUsername} You have the maximum number of ongoing song requests (${perUserLimit}), ` +
        `please wait until one of your songs plays before requesting another!`
      );
      return;
    }

    // Check if the user is on cooldown for their next song request
    if (!priority) {
      const lastRequestTime = await db.selectFrom('songRequests')
        .innerJoin('songs', 'songs.id', 'songRequests.songId')
        .select(['songRequests.createdAt', 'songs.duration'])
        .where('requester', '=', fromUsername)
        .where('status', '=', 'ready')
        .orderBy('songRequests.id desc')
        .execute();
        console.log('lrt', lastRequestTime, fromUsername)
      if (lastRequestTime[0]) {
        const createdAt = new Date(lastRequestTime[0].createdAt + 'Z');
        const availableAt = createdAt.getTime() + (lastRequestTime[0].duration * 1000);
        const now = new Date().getTime();
        if (availableAt > now) {
          await this.sendTwitchMessage(`@${fromUsername} Your next song request will be available in ${formatTime((availableAt - now) / 1000)}! (wait at least the length of your last requested song for your next one)`);
          return;
        }
      }
    }

    // If message has a URL, use only the URL
    const url = originalMessage.match(/https?:\/\/\S+/)?.[0];

    // Strip accidental inclusions on the original message if using that
    let userInput = url || originalMessage.trim().replace(/^\!(sr|ssr|request|songrequest|rs)\s+/i, '');
    if (!url && !userInput.includes('-')) {
      // strip "song by artist" to "song artist" to not confuse spotify search
      userInput = userInput.replace(/ by /i, ' ');
    }

    const MINIMUM_REQUEST_LENGTH = 4;
    if (userInput.length <= MINIMUM_REQUEST_LENGTH) {
      await this.doAction('!how');
      return;
    }

    await this.sendTwitchMessage(`Working on it, @${fromUsername}!`);

    try {
      const [song, songRequestId] = await this.songRequestHandler.execute(
        userInput,
        maxDuration,
        { requesterName: fromUsername },
        priority
      );
      const waitTime = await this.songRequestHandler.getTimeUntilSongRequest(songRequestId);
      const timeRemaining = waitTime.numSongRequests > 1 ? ` (~${formatTime(Number(waitTime.totalDuration))} from now)` : '';
      await this.sendTwitchMessage(`@${fromUsername} ${song.basename} was added to the queue in position ${waitTime.numSongRequests}${timeRemaining}`);
    } catch (e: any) {
      let message = 'There was an error adding your song request!';
      if (e instanceof SongDownloadError) {
        if (e.type === 'VIDEO_UNAVAILABLE') message = 'That video is not available.';
        if (e.type === 'UNSUPPORTED_DOMAIN') message = 'Only Spotify or YouTube links are supported.';
        if (e.type === 'DOWNLOAD_FAILED') message = 'I wasn\'t able to download that link.';
        if (e.type === 'NO_PLAYLISTS') message = 'Playlists aren\'t supported, request a single song instead.';
        if (e.type === 'TOO_LONG') message = `That song is too long! Keep song requests under ${formatTime(maxDuration)}.`;
        if (e.type === 'AGE_RESTRICTED') message = 'The song downloader doesn\'t currently support age-restricted videos.';
      }
      await this.sendTwitchMessage(`@${fromUsername} ${message}`);
      // rethrow to allow to catch for refund
      throw e;
    }
  }
}
