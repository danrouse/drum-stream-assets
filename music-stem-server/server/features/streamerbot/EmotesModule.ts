/**
 * Twitch Emotes module
 *
 * Responds to twitch emotes, broadcasts when they are used,
 * allows for emote pinning, and echoes emotes sometimes.
 */

import { StreamerbotEventPayload } from '@streamerbot/client';
import StreamerbotWebSocketClient, { TwitchRewardDurations} from '../../StreamerbotWebSocketClient';
import { get7tvEmotes } from '../../../../shared/twitchEmotes';
import { WebSocketBroadcaster } from '../../../../shared/messages';
import * as Streamerbot from '../../../../shared/streamerbot';

export default class EmotesModule {
  private client: StreamerbotWebSocketClient;
  private broadcast: WebSocketBroadcaster;

  private previousMessage: string = '';
  private previousMessageUser: string = '';
  private messageRepeatTimer?: NodeJS.Timeout;
  private pinNextEmoteForUser?: string;

  constructor(client: StreamerbotWebSocketClient, broadcast: WebSocketBroadcaster) {
    this.client = client;
    this.broadcast = broadcast;

    this.client.on('Twitch.ChatMessage', this.handleTwitchChatMessage);
    this.client.on('Twitch.RewardRedemption', this.handleTwitchRewardRedemption);
  }

  private handleTwitchChatMessage = async (payload: StreamerbotEventPayload<"Twitch.ChatMessage">) => {
    if (payload.data.message.userId === StreamerbotWebSocketClient.BOT_TWITCH_USER_ID) return;

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
        this.client.pauseTwitchRedemption('Pin an Emote', TwitchRewardDurations['Pin an Emote'], () => {
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
          await this.client.sendTwitchMessage(payload.data.message.message);
          this.messageRepeatTimer = setTimeout(() => { delete this.messageRepeatTimer; }, 30000);
        }
      }
    }

    this.previousMessage = payload.data.message.message;
    this.previousMessageUser = payload.data.message.username;
  };

  private handleTwitchRewardRedemption = async (payload: StreamerbotEventPayload<"Twitch.RewardRedemption">) => {
    const rewardName = Streamerbot.rewardNameById(payload.data.reward.id);
    if (!rewardName) return;

    if (rewardName === 'Pin an Emote') {
      this.pinNextEmoteForUser = payload.data.user_name;
    }
  };
}
