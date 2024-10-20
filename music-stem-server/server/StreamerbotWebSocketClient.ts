import { StreamerbotClient, StreamerbotEventPayload } from '@streamerbot/client';
import { SongDownloadError, MAX_SONG_REQUEST_DURATION } from './wrappers/spotdl';
import formatTime from '../player/formatTime';
import SongRequestHandler from './SongRequestHandler';
import { loadEmotes } from '../../shared/7tv';

// const MINIMUM_SONG_REQUEST_QUERY_LENGTH = 5;

interface IdMap { [name: string]: string }

const REWARD_IDS: { [name: string]: string } = {
  SongRequest: '089b77c3-bf0d-41e4-9063-c239bcb6477b',
  MuteCurrentSongDrums: '0dc1de6b-26fb-4a00-99ba-367b96d660a6',
  SlowDownCurrentSong: 'b07f3e10-7042-4c96-8ba3-e5e385c63aee',
  SpeedUpCurrentSong: '7f7873d6-a017-4a2f-a075-7ad098e65a92',
};

export default class StreamerbotWebSocketClient {
  private client: StreamerbotClient;
  private broadcast: WebSocketBroadcaster;
  private songRequestHandler: SongRequestHandler;
  private actions: IdMap = {};
  private twitchMessageIdsByUser: IdMap = {};
  private emotes: IdMap = {};

  constructor(broadcast: WebSocketBroadcaster, songRequestHandler: SongRequestHandler) {
    this.client = new StreamerbotClient({
      onConnect: () => this.loadActions(),      
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
  }

  public messageHandler(payload: WebSocketServerMessage | WebSocketPlayerMessage) {
    if (payload.type === 'price_change') {
      const rewardId = REWARD_IDS[payload.action];
      this.client.doAction(this.actions['Change reward price'], { rewardId, ...payload });
    }
  }

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
    this.client.doAction(this.actions['Twitch chat message'], { message, replyTo });
  }

  private async handleTwitchChatMessage(payload: StreamerbotEventPayload<"Twitch.ChatMessage">) {
    // Streamerbot Command.Triggered events which were triggered by Twitch messages
    // don't include the messageId which triggered them, but the Twitch.ChatMessage
    // event gets triggered first, so store a mapping of userIds to messageIds for replies
    this.twitchMessageIdsByUser[payload.data.message.userId] = payload.data.message.msgId;
    
    const words = payload.data.message.message.split(' ');
    const emotes = [
      ...payload.data.message.emotes.map(e => e.imageUrl),
      ...words.filter(word => this.emotes.hasOwnProperty(word))
    ];
    if (emotes.length) {
      const emote = emotes[Math.floor(Math.random() * emotes.length)];
      this.broadcast({ type: 'emote_used', emote });
    }
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
        this.client.doAction(this.actions['Refund song request'], {
          rewardId: payload.data.reward.id,
          redemptionId: payload.data.id,
        });
      }
    } else {
      const rewards = Object.entries(REWARD_IDS);
      const matchingReward = rewards.find(([name, rewardId]) => rewardId === payload.data.reward.id);
      if (matchingReward) {
        this.broadcast({ type: 'client_remote_control', action: matchingReward[0] });
      }
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
