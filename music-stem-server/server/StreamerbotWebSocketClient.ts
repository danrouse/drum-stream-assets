import { StreamerbotClient, StreamerbotEventPayload } from '@streamerbot/client';
import { SongDownloadError, MAX_SONG_REQUEST_DURATION } from './wrappers/spotdl';
import SongRequestHandler from './SongRequestHandler';
import MIDIIOController from './MIDIIOController';
import { db } from './database';
import { formatTime } from '../../shared/util';
import { loadEmotes } from '../../shared/7tv';
import { ChannelPointReward, WebSocketServerMessage, WebSocketPlayerMessage, WebSocketBroadcaster } from '../../shared/messages';
import { getKitDefinition, td30KitsPastebin } from '../../shared/td30Kits';

// const MINIMUM_SONG_REQUEST_QUERY_LENGTH = 5;

interface IdMap { [name: string]: string }

const REWARD_IDS: { [name in ChannelPointReward["name"]]: string } = {
  SongRequest: '089b77c3-bf0d-41e4-9063-c239bcb6477b',
  SongRequestMeme: 'cf20c890-1365-45f9-85e7-04e084c73798',
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
  OopsAllFarts: 30000,
  ChangeDrumKit: 60000,
  NoShenanigans: 180000,
};

const REWARD_AMOUNTS: { [name in ChannelPointReward["name"]]?: number } = {
  SlowDownCurrentSong: 0.15,
  SpeedUpCurrentSong: 0.15,
};

const MUTUALLY_EXCLUSIVE_REWARD_GROUPS: ChannelPointReward["name"][][] = [
  ['OopsAllFarts', 'ChangeDrumKit'],
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
  private twitchUnpauseTimers: NodeJS.Timeout[] = [];

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

    this.broadcast = broadcast;
    this.songRequestHandler = songRequestHandler;
    this.midiController = midiController;
  }

  public messageHandler = async (payload: WebSocketServerMessage | WebSocketPlayerMessage) => {
    if (payload.type === 'song_speed') {
      const playbackRate = payload.speed;
      const speedDiffSteps = Math.abs(1 - playbackRate) / REWARD_AMOUNTS.SpeedUpCurrentSong!;
      const isFaster = playbackRate > 1;
      const nextSlowDownPrice = Math.round(isFaster ? 100 - (speedDiffSteps * 15) : 100 + (speedDiffSteps * 30));
      const nextSpeedUpPrice = Math.round(!isFaster ? 100 - (speedDiffSteps * 15) : 100 + (speedDiffSteps * 30));
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

  public updateTwitchRedemption(rewardId: string, redemptionId: string, action: 'cancel' | 'fulfill') {
    return this.client.doAction(this.actions['Reward: Update Redemption'], { rewardId, redemptionId, action });
  }

  private async pauseTwitchRedemption(rewardName: ChannelPointReward["name"], duration: number) {
    await this.client.doAction(
      this.actions['Reward: Pause'],
      { rewardId: REWARD_IDS[rewardName] }
    );
    this.twitchUnpauseTimers.push(
      setTimeout(() => this.client.doAction(
        this.actions['Reward: Unpause'],
        { rewardId: REWARD_IDS[rewardName] }
      ), REWARD_DURATIONS[rewardName])
    );
  }

  private async handleTwitchRewardRedemption(payload: StreamerbotEventPayload<"Twitch.RewardRedemption">) {
    if (
      payload.data.reward.id === REWARD_IDS.SongRequest ||
      payload.data.reward.id === REWARD_IDS.SongRequestMeme
    ) {
      try {
        await this.handleSongRequest(
          payload.data.user_input,
          payload.data.user_name,
          payload.data.reward.id,
          payload.data.id,
          payload.data.reward.id === REWARD_IDS.SongRequestMeme
        );
      } catch (e) {
        console.info('Song reward redemption failed with error', (e as any)?.type);
        await this.updateTwitchRedemption(payload.data.reward.id, payload.data.id, 'cancel');
      }
      return;
    }
    
    if (!Object.values(REWARD_IDS).includes(payload.data.reward.id)) {
      // A reward was redeemed that is not defined here, nothing to do!
      return;
    }

    const rewardName = Object.entries(REWARD_IDS)
      .find(([name, id]) => id === payload.data.reward.id)![0] as ChannelPointReward['name'];
    console.log('Redeem', rewardName);

    if (rewardName === 'NoShenanigans') {
      this.midiController.resetKit();
      for (let i in this.twitchUnpauseTimers) {
        clearTimeout(this.twitchUnpauseTimers[i]);
        delete this.twitchUnpauseTimers[i];
      }
      for (let otherRewardName of DISABLEABLE_REWARDS) {
        await this.pauseTwitchRedemption(otherRewardName, REWARD_DURATIONS[rewardName]!);
      }
      await this.pauseTwitchRedemption(rewardName, REWARD_DURATIONS[rewardName]!);
    } else if (rewardName === 'OopsAllFarts') {
      this.midiController.muteToms();
      setTimeout(() => this.midiController.resetKit(), REWARD_DURATIONS[rewardName]);
    } else if (rewardName === 'ChangeDrumKit') {
      const kit = getKitDefinition(payload.data.user_input);
      if (!kit) {
        await this.sendTwitchMessage(`${payload.data.user_name}, please include one of the numbers or names of a kit from here: ${td30KitsPastebin} (refunded!)`);
        await this.updateTwitchRedemption(payload.data.reward.id, payload.data.id, 'cancel');
        return;
      }
      this.midiController.changeKit(kit[0]);
      await this.sendTwitchMessage(`Drum kit has been changed to ${kit[1]} for two minutes!`);
      setTimeout(() => this.midiController.resetKit(), REWARD_DURATIONS[rewardName]);
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
    if (payload.data.command === '!queue') {
      const res = await db.selectFrom('songRequests')
        .leftJoin('songs', 'songs.id', 'songRequests.songId')
        .where('songRequests.status', '=', 'ready')
        .where('songRequests.isMeme', '=', 0)
        .select(({ fn }) => [
          fn<number>('sum', ['songs.duration']).as('totalDuration'),
          fn<number>('count', ['songRequests.id']).as('totalRequests')
        ])
        .execute();
      const { totalRequests, totalDuration } = res[0];
      if (totalRequests === 0) {
        await this.sendTwitchMessage('The song request queue is currently empty!');
      } else {
        await this.sendTwitchMessage(`There ${totalRequests === 1 ? 'is' : 'are'} currently ${totalRequests} song${totalRequests === 1 ? '' : 's'} in the queue, lasting ${formatTime(totalDuration)}.`);
      }
    } else if (payload.data.command === '!when' || payload.data.command === '!whenami') {
      const user = payload.data.user.display; // user.display vs user.name?
    }
  }

  private async handleSongRequest(
    originalMessage: string,
    fromUsername: string,
    rewardId?: string,
    redemptionId?: string,
    isMeme?: boolean,
  ) {
    // Only send a heartbeat message if we didn't process it super quickly
    let hasSentMessage = false;
    setTimeout(async () => {
      if (!hasSentMessage) await this.sendTwitchMessage(`Working on it, ${fromUsername}!`);
    }, 1000);

    // If message has a URL, use only the URL
    const url = originalMessage.match(/https?:\/\/\S+/)?.[0];

    // Strip accidental inclusions on the original message if using that
    const userInput = url || originalMessage.trim().replace(/^\!(sr|ssr|request)\s+/i, '');

    try {
      const song = await this.songRequestHandler.execute(userInput, {
        requesterName: fromUsername,
        rewardId, redemptionId,
        isMeme,
      });
      hasSentMessage = true;
      await this.sendTwitchMessage(`${song.basename} was added, ${fromUsername}!`);
    } catch (e: any) {
      let message = 'There was an error adding your song request!';
      if (e instanceof SongDownloadError) {
        if (e.type === 'VIDEO_UNAVAILABLE') message = 'That video is not available.';
        if (e.type === 'UNSUPPORTED_DOMAIN') message = 'Only Spotify or YouTube links are supported.';
        if (e.type === 'DOWNLOAD_FAILED') message = 'I wasn\'t able to download that link.';
        if (e.type === 'NO_PLAYLISTS') message = 'Playlists aren\'t supported, request a single song instead.';
        if (e.type === 'TOO_LONG') message = `That song is too long! Keep song requests under ${formatTime(MAX_SONG_REQUEST_DURATION)}.`;
      }
      hasSentMessage = true;
      await this.sendTwitchMessage(`@${fromUsername} ${message}`);
      // rethrow to allow to catch for refund
      throw e;
    }
  }
}
