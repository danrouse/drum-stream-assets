import { StreamerbotClient, StreamerbotEventPayload } from '@streamerbot/client';
import { SongDownloadError, MAX_SONG_REQUEST_DURATION } from './wrappers/spotdl';
import SongRequestHandler from './SongRequestHandler';
import MIDIIOController from './MIDIIOController';
import { db } from './database';
import { formatTime } from '../../shared/util';
import { loadEmotes } from '../../shared/7tv';
import { ChannelPointReward, WebSocketServerMessage, WebSocketPlayerMessage, WebSocketBroadcaster } from '../../shared/messages';
import { getKitDefinition, td30KitsPastebin } from '../../shared/td30Kits';

interface IdMap { [name: string]: string }

const REWARD_IDS: { [name in ChannelPointReward["name"]]: string } = {
  MuteCurrentSongDrums: '0dc1de6b-26fb-4a00-99ba-367b96d660a6',
  SlowDownCurrentSong: 'b07f3e10-7042-4c96-8ba3-e5e385c63aee',
  SpeedUpCurrentSong: '7f7873d6-a017-4a2f-a075-7ad098e65a92',
  OopsAllFarts: 'e97a4982-a2f8-441a-afa9-f7d2d8ab11e1',
  ChangeDrumKit: '6e366bb7-508d-4419-89a4-32fdcf952419',
  NoShenanigans: '3fe13282-ba0a-412c-99af-f76a7c9f7c68',
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

export default class StreamerbotWebSocketClient {
  private client: StreamerbotClient;
  private midiController: MIDIIOController;
  private broadcast: WebSocketBroadcaster;
  private songRequestHandler: SongRequestHandler;
  private actions: IdMap = {};
  private twitchMessageIdsByUser: IdMap = {};
  private emotes: IdMap = {};
  private twitchUnpauseTimers: Set<NodeJS.Timeout> = new Set();
  private kitResetTimer?: NodeJS.Timeout;

  constructor(broadcast: WebSocketBroadcaster, songRequestHandler: SongRequestHandler, midiController: MIDIIOController) {
    this.client = new StreamerbotClient({
      onConnect: () => {
        this.loadActions();
        this.loadEmotes();
      },
      retries: 0,
    });
    this.client.on('Application.*', async () => {
      await this.loadActions();
      await this.loadEmotes();
    });
    this.client.on('Twitch.ChatMessage', this.handleTwitchChatMessage.bind(this));
    this.client.on('Twitch.RewardRedemption', this.handleTwitchRewardRedemption.bind(this));
    this.client.on('Command.Triggered', this.handleCommandTriggered.bind(this));
    setInterval(() => {
      this.updateActiveViewers();
    }, 10000);

    this.broadcast = broadcast;
    this.songRequestHandler = songRequestHandler;
    this.midiController = midiController;
  }

  public messageHandler = async (payload: WebSocketServerMessage | WebSocketPlayerMessage) => {
    if (payload.type === 'song_speed') {
      const playbackRate = payload.speed;
      const speedDiffSteps = Math.abs(1 - playbackRate) / REWARD_AMOUNTS.SpeedUpCurrentSong!;
      const isFaster = playbackRate > 1;
      const nextSlowDownPrice = Math.round(isFaster ? 100 - (speedDiffSteps * 25) : 100 + (speedDiffSteps * 50));
      const nextSpeedUpPrice = Math.round(!isFaster ? 100 - (speedDiffSteps * 25) : 100 + (speedDiffSteps * 50));
      const MIN_PLAYBACK_SPEED = 0.25; // TODO: Share this somehow, should be 0.1 + reward_amount

      await this.client.doAction(this.actions['Reward: Change Price'], {
        rewardId: REWARD_IDS.SlowDownCurrentSong,
        price: nextSlowDownPrice,
      });
      await this.client.doAction(this.actions['Reward: Change Price'], {
        rewardId: REWARD_IDS.SpeedUpCurrentSong,
        price: nextSpeedUpPrice,
      });

      const slowDownRewardAction = playbackRate <= MIN_PLAYBACK_SPEED ? 'Reward: Pause' : 'Reward: Unpause';
      await this.client.doAction(this.actions[slowDownRewardAction], { rewardId: REWARD_IDS.SlowDownCurrentSong });
    }
  };

  private async loadActions() {
    const mapping: IdMap = {};
    const res = await this.client.getActions();
    res.actions.forEach((action) => {
      mapping[action.name] = action.id;
    });
    this.actions = mapping;
  }

  private async loadEmotes() {
    this.emotes = await loadEmotes();
  }

  public sendTwitchMessage(message: string, replyTo?: string) {
    return this.client.doAction(this.actions['Twitch chat message'], { message, replyTo });
  }

  private async handleTwitchChatMessage(payload: StreamerbotEventPayload<"Twitch.ChatMessage">) {
    // Streamerbot Command.Triggered events which were triggered by Twitch messages
    // don't include the messageId which triggered them, but the Twitch.ChatMessage
    // event gets triggered first, so store a mapping of userIds to messageIds for replies
    this.twitchMessageIdsByUser[payload.data.message.userId] = payload.data.message.msgId;
    
    const words = payload.data.message.message.split(' ');
    const emotes = [
      ...payload.data.message.emotes.map(e => e.imageUrl),
      ...words.filter(word => this.emotes.hasOwnProperty(word)).map(emote => this.emotes[emote])
    ];
    if (emotes.length) {
      const emoteURL = emotes[Math.floor(Math.random() * emotes.length)];
      this.broadcast({ type: 'emote_used', emoteURL });
    }
  }

  private async updateActiveViewers() {
    const res = await this.client.getActiveViewers();
    this.broadcast({ type: 'viewers_update', viewers: res.viewers });
  }

  public updateTwitchRedemption(rewardId: string, redemptionId: string, action: 'cancel' | 'fulfill') {
    return this.client.doAction(this.actions['Reward: Update Redemption'], { rewardId, redemptionId, action });
  }

  private async pauseTwitchRedemption(rewardName: ChannelPointReward["name"], duration: number) {
    await this.client.doAction(
      this.actions['Reward: Pause'],
      { rewardId: REWARD_IDS[rewardName] }
    );
    this.twitchUnpauseTimers.add(
      setTimeout(() => this.client.doAction(
        this.actions['Reward: Unpause'],
        { rewardId: REWARD_IDS[rewardName] }
      ), REWARD_DURATIONS[rewardName])
    );
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
      this.midiController.resetKit();
      this.twitchUnpauseTimers.forEach(timer => {
        clearTimeout(timer);
        this.twitchUnpauseTimers.delete(timer);
      });
      for (let otherRewardName of DISABLEABLE_REWARDS) {
        await this.pauseTwitchRedemption(otherRewardName, REWARD_DURATIONS[rewardName]!);
      }
      await this.pauseTwitchRedemption(rewardName, REWARD_DURATIONS[rewardName]!);
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
        // moderator/admin no limit, subs 3, normies 2
        const limit = payload.data.user.role >= 3 ? 0 :
          payload.data.user.subscribed ? 3 : 2;
        await this.handleSongRequest(message, userName, limit);
      } catch (e) {
        console.info('Song reward redemption failed with error', e);
      }
    } else if (['!queue'].includes(payload.data.command)) {
      const res = await db.selectFrom('songRequests')
        .leftJoin('songs', 'songs.id', 'songRequests.songId')
        .where('songRequests.status', '=', 'ready')
        .select(({ fn }) => [
          fn<number>('sum', ['songs.duration']).as('totalDuration'),
          fn<number>('count', ['songRequests.id']).as('totalRequests')
        ])
        .execute();
      const { totalRequests, totalDuration } = res[0];
      if (totalRequests === 0) {
        await this.sendTwitchMessage('The song request queue is currently empty!');
      } else {
        await this.sendTwitchMessage(
          `There ${totalRequests === 1 ? 'is' : 'are'} currently ${totalRequests} song${totalRequests === 1 ? '' : 's'} `,
          `in the queue, lasting ${formatTime(totalDuration)}.`
        );
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
    } else if (['!remove', '!wrongsong'].includes(payload.data.command)) {
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
    }
  }

  private async handleSongRequest(
    originalMessage: string,
    fromUsername: string,
    perUserLimit?: number
  ) {
    // Check if user already has the maximum ongoing song requests before processing
    const existingRequests = await db.selectFrom('songRequests')
      .select(db.fn.countAll().as('count'))
      .where('requester', '=', fromUsername)
      .where('status', '=', 'ready')
      .execute();
    if (perUserLimit && Number(existingRequests[0].count) >= perUserLimit) {
      await this.sendTwitchMessage(
        `@${fromUsername} You have the maximum number of ongoing song requests (${perUserLimit}), ` +
        `please wait until one of your songs plays before requesting another!`
      );
      return;
    }
    
    // Only send a heartbeat message if we didn't process it super quickly
    let hasSentMessage = false;
    setTimeout(async () => {
      if (!hasSentMessage) await this.sendTwitchMessage(`Working on it, ${fromUsername}!`);
    }, 1000);

    // If message has a URL, use only the URL
    const url = originalMessage.match(/https?:\/\/\S+/)?.[0];

    // Strip accidental inclusions on the original message if using that
    let userInput = url || originalMessage.trim().replace(/^\!(sr|ssr|request)\s+/i, '');
    if (!url && !userInput.includes('-')) {
      // strip "song by artist" to "song artist" to not confuse spotify search
      userInput = userInput.replace(/ by /i, ' ');
    }

    try {
      const [song, songRequestId] = await this.songRequestHandler.execute(userInput, {
        requesterName: fromUsername,
      });
      const waitTime = await this.songRequestHandler.getTimeUntilSongRequest(songRequestId);
      const timeRemaining = waitTime.numSongRequests > 1 ? ` (~${formatTime(Number(waitTime.totalDuration))} from now)` : '';
      hasSentMessage = true;
      await this.sendTwitchMessage(`@${fromUsername} ${song.basename} was added to the queue in position ${waitTime.numSongRequests}${timeRemaining}`);
    } catch (e: any) {
      let message = 'There was an error adding your song request!';
      if (e instanceof SongDownloadError) {
        if (e.type === 'VIDEO_UNAVAILABLE') message = 'That video is not available.';
        if (e.type === 'UNSUPPORTED_DOMAIN') message = 'Only Spotify or YouTube links are supported.';
        if (e.type === 'DOWNLOAD_FAILED') message = 'I wasn\'t able to download that link.';
        if (e.type === 'NO_PLAYLISTS') message = 'Playlists aren\'t supported, request a single song instead.';
        if (e.type === 'TOO_LONG') message = `That song is too long! Keep song requests under ${formatTime(MAX_SONG_REQUEST_DURATION)}.`;
        if (e.type === 'AGE_RESTRICTED') message = 'The song downloader doesn\'t currently support age-restricted videos.';
      }
      hasSentMessage = true;
      await this.sendTwitchMessage(`@${fromUsername} ${message}`);
      // rethrow to allow to catch for refund
      throw e;
    }
  }
}
