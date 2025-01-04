import { Client, Events, GatewayIntentBits, TextChannel, ChannelType } from 'discord.js';
import { WebSocketMessage } from '../../shared/messages';
import { db } from './database';
import { formatTime, isURL } from '../../shared/util';

export default class DiscordIntegration {
  private client: Client;
  private songRequestsChannel?: TextChannel;

  constructor(
    isTestMode: boolean = false,
    songRequestsChannelName: string = '🤖song-request-queue',
  ) {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds]
    });
    this.client.once(Events.ClientReady, async (client) => {
      for (let cache of client.channels.cache) {
        if (
          cache[1].type === ChannelType.GuildText &&
          cache[1].name === songRequestsChannelName
        ) {
          console.info('Found song requests channel:', cache[1].name, cache[1].id);
          if (!isTestMode) {
            this.songRequestsChannel = cache[1];
          }
        }
      }
    });
    this.client.login(process.env.DISCORD_TOKEN);
  }

  private getMessageByFooterText(text: string) {
    return this.songRequestsChannel?.messages.cache?.find(message =>
      message.embeds.find(embed => embed.footer?.text === text));
  }

  private formatSongRequestFooter(songRequestId: number) {
    return `🆔 ${songRequestId}`;
  }

  private async announceNewSongRequest(songRequestId: number) {
    const row = await db.selectFrom('songRequests')
      .innerJoin('songs', 'songs.id', 'songRequests.songId')
      .select(['songRequests.query', 'songRequests.requester', 'songs.artist', 'songs.title', 'songs.duration'])
      .where('songRequests.id', '=', songRequestId)
      .execute();
    
    // Ignore internal song requests
    if (!row[0].requester) return;

    return this.songRequestsChannel?.send({
      embeds: [{
        title: [row[0].artist, row[0].title].filter(s => s).join(' - '),
        description: `!sr ${row[0].query}`,
        url: isURL(row[0].query) ? row[0].query : undefined,
        fields: [{
          name: 'Requested by',
          value: row[0].requester,
          inline: true,
        }, {
          name: 'Duration',
          value: formatTime(row[0].duration),
          inline: true,
        }],
        footer: {
          text: this.formatSongRequestFooter(songRequestId),
        },
      }]
    });
  }

  private async updateCompletedSongRequest(
    songRequestId: number,
    timestamp: number = Math.floor(Date.now() / 1000),
  ) {
    const row = await db.selectFrom('songRequests')
      .select(['songRequests.status'])
      .where('songRequests.id', '=', songRequestId)
      .execute();
    const isCompleted = row[0].status === 'fulfilled';
    const msg = this.getMessageByFooterText(this.formatSongRequestFooter(songRequestId));
    if (!msg) return;
    await msg.edit({
      embeds: [{
        ...msg?.embeds[0].data,
        color: isCompleted ? 0x00ff00 : 0xaaaaaa,
        fields: msg?.embeds[0].fields.concat([{
          name: isCompleted ? 'Played at' : 'Skipped at',
          value: `<t:${timestamp}:R>`,
          inline: true,
        }]),
      }]
    });
    // await msg.react(isCompleted ? '✅' : '❎');
  }

  public messageHandler = async (payload: WebSocketMessage) => {
    if (!this.songRequestsChannel) return;

    if (payload.type === 'song_request_added') {
      await this.announceNewSongRequest(payload.songRequestId);
    } else if (payload.type === 'song_request_removed' || (payload.type === 'song_playback_completed' && payload.songRequestId)) {
      await this.updateCompletedSongRequest(payload.songRequestId!);
    }
  };
}
