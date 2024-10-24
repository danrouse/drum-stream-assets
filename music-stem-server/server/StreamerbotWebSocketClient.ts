import { StreamerbotClient, StreamerbotEventPayload } from '@streamerbot/client';
import { SongDownloadError, MAX_SONG_REQUEST_DURATION } from './wrappers/spotdl';
import formatTime from '../player/formatTime';
import SongRequestHandler from './SongRequestHandler';
import MIDIIOController from './MIDIIOController';
import { loadEmotes } from '../../shared/7tv';
import { ChannelPointReward, WebSocketServerMessage, WebSocketPlayerMessage, WebSocketBroadcaster } from '../../shared/messages';
import { getKitDefinition, td30KitsPastebin } from '../../shared/td30Kits';

// const MINIMUM_SONG_REQUEST_QUERY_LENGTH = 5;

interface IdMap { [name: string]: string }

const REWARD_IDS: { [name in ChannelPointReward["name"]]: string } = {
  SongRequest: '089b77c3-bf0d-41e4-9063-c239bcb6477b',
  MuteCurrentSongDrums: '0dc1de6b-26fb-4a00-99ba-367b96d660a6',
  SlowDownCurrentSong: 'b07f3e10-7042-4c96-8ba3-e5e385c63aee',
  SpeedUpCurrentSong: '7f7873d6-a017-4a2f-a075-7ad098e65a92',
  OopsAllFarts: 'e97a4982-a2f8-441a-afa9-f7d2d8ab11e1',
  ChangeDrumKit: '6e366bb7-508d-4419-89a4-32fdcf952419',
};

const REWARD_DURATIONS: { [name in ChannelPointReward["name"]]?: number } = {
  MuteCurrentSongDrums: 120000,
  SlowDownCurrentSong: 120000,
  SpeedUpCurrentSong: 120000,
  OopsAllFarts: 30000,
  ChangeDrumKit: 120000,
};

const REWARD_AMOUNTS: { [name in ChannelPointReward["name"]]?: number } = {
  SlowDownCurrentSong: 0.15,
  SpeedUpCurrentSong: 0.15,
};

const MUTUALLY_EXCLUSIVE_REWARD_GROUPS: ChannelPointReward["name"][][] = [
  ['OopsAllFarts', 'ChangeDrumKit'],
];

export default class StreamerbotWebSocketClient {
  private client: StreamerbotClient;
  private midiController: MIDIIOController;
  private broadcast: WebSocketBroadcaster;
  private songRequestHandler: SongRequestHandler;
  private actions: IdMap = {};
  private twitchMessageIdsByUser: IdMap = {};
  private emotes: IdMap = {};

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

  private refundTwitchRewardRedemption(rewardId: string, redemptionId: string) {
    return this.client.doAction(this.actions['Refund'], { rewardId, redemptionId });
  }

  private async handleTwitchRewardRedemption(payload: StreamerbotEventPayload<"Twitch.RewardRedemption">) {
    if (payload.data.reward.id === REWARD_IDS.SongRequest) {
      try {
        await this.handleSongRequest(
          payload.data.user_input,
          payload.data.user_name,
          payload.data.reward.id,
          payload.data.id
        );
      } catch (e) {
        console.info('Song reward redemption failed with error', (e as any)?.type);
        await this.refundTwitchRewardRedemption(payload.data.reward.id, payload.data.id);
      }
      return;
    }
    
    if (!Object.values(REWARD_IDS).includes(payload.data.reward.id)) {
      // A reward was redeemed that is not defined here, nothing to do!
      return;
    }

    const rewardName = Object.entries(REWARD_IDS)
      .find(([name, id]) => id === payload.data.reward.id)![0] as ChannelPointReward['name'];
    console.log('Redeem', payload.data.reward.id);

    if (rewardName === 'OopsAllFarts') {
      this.midiController.muteToms();
      setTimeout(() => this.midiController.resetKit(), REWARD_DURATIONS[rewardName]);
    } else if (rewardName === 'ChangeDrumKit') {
      const kit = getKitDefinition(payload.data.user_input);
      if (!kit) {
        await this.sendTwitchMessage(`${payload.data.user_name}, please include one of the numbers or names of a kit from here: ${td30KitsPastebin} (refunded!)`);
        await this.refundTwitchRewardRedemption(payload.data.reward.id, payload.data.id);
        return;
      }
      this.midiController.changeKit(kit[0]);
      await this.sendTwitchMessage(`Drum kit has been changed to ${kit[1]} for two minutes!`);
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
    if (mutuallyExclusiveGroup) {
      mutuallyExclusiveGroup.forEach((otherRewardName) =>
        this.client.doAction(this.actions['Reward: Pause'], { rewardId: REWARD_IDS[otherRewardName] }));
      setTimeout(() => {
        mutuallyExclusiveGroup.forEach((otherRewardName) =>
          this.client.doAction(this.actions['Reward: Unpause'], { rewardId: REWARD_IDS[otherRewardName] }));
      }, REWARD_DURATIONS[rewardName])
    }
  }

  private async handleSongRequest(
    originalMessage: string,
    fromUsername: string,
    rewardId?: string,
    redemptionId?: string,
  ) {
    // Only send a heartbeat message if we didn't process it super quickly
    let hasSentMessage = false;
    setTimeout(async () => {
      if (!hasSentMessage) await this.sendTwitchMessage(`Working on it, ${fromUsername}!`);
    }, 1000);

    // Strip accidental inclusions on the original message
    const userInput = originalMessage.trim().replace(/^\!(sr|ssr|request)\s+/i, '');

    try {
      const song = await this.songRequestHandler.execute(userInput, {
        requesterName: fromUsername,
        rewardId, redemptionId,
        time: new Date(),
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
