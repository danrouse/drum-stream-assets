/**
 * Discord module
 *
 * Handles announcements to the song request queue channel in Discord
 * when song requests are added, removed, or completed.
 * Also supports updating those messages with additional information,
 * such as links to song request VODs or timestamps within a larger VOD.
 */
import { Client, Events, GatewayIntentBits, TextChannel, ChannelType } from 'discord.js';
import WebSocketCoordinatorServer from '../WebSocketCoordinatorServer';
import { db } from '../database';
import { WebSocketMessage } from '../../../shared/messages';
import { formatTime, isURL, createLogger } from '../../../shared/util';
type DiscordEvent = 'ready';

export default class DiscordModule {
  private discordClient: Client;
  public songRequestsChannel?: TextChannel;
  private eventHandlers: { [key: string]: Array<(client: Client) => void> } = {};

  constructor(
    wss?: WebSocketCoordinatorServer,
    isTestMode: boolean = false,
    songRequestsChannelName: string = '🤖song-request-queue',
  ) {
    this.discordClient = new Client({
      intents: [GatewayIntentBits.Guilds]
    });
    this.discordClient.once(Events.ClientReady, async (client) => {
      for (let cache of client.channels.cache) {
        if (
          cache[1].type === ChannelType.GuildText &&
          cache[1].name === songRequestsChannelName
        ) {
          this.log('Found song requests channel:', cache[1].name, cache[1].id);
          if (!isTestMode) {
            this.songRequestsChannel = cache[1];
          }
        }
      }
      this.eventHandlers.ready?.forEach(handler => handler(client));
    });
    this.discordClient.login(process.env.DISCORD_TOKEN);

    wss?.registerHandler('song_request_added', this.handleSongRequestAdded);
    wss?.registerHandler('song_request_removed', this.handleSongRequestRemoved);
    wss?.registerHandler('song_playback_completed', this.handleSongRequestRemoved);
  }

  public on(event: DiscordEvent, handler: (client: Client) => void) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
  }

  private log = createLogger('Discord');

  private getMessageByFooterText(text: string) {
    return this.songRequestsChannel?.messages.cache?.find(message =>
      message.embeds.find(embed => embed.footer?.text === text));
  }

  private formatSongRequestFooter(songRequestId: number) {
    return `🆔 ${songRequestId}`;
  }

  private async announceNewSongRequest(songRequestId: number) {
    this.log('announceNewSongRequest', songRequestId);
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

  public async updateCompletedSongRequest(
    songRequestId: number,
    timestamp?: number,
    vodUrl?: string,
  ) {
    this.log('updateCompletedSongRequest', songRequestId);
    const row = await db.selectFrom('songRequests')
      .select(['songRequests.status'])
      .where('songRequests.id', '=', songRequestId)
      .execute();
    const isCompleted = row[0].status === 'fulfilled';
    const msg = this.getMessageByFooterText(this.formatSongRequestFooter(songRequestId));
    if (!msg) return;
    if (timestamp) {
      await msg.edit({
        embeds: [{
          ...msg?.embeds[0].data,
          color: isCompleted ? 0x00ff00 : 0xaaaaaa,
          fields: msg?.embeds[0].fields.concat([{
            name: isCompleted ? 'Played at' : 'Skipped at',
            value: `<t:${timestamp}:R>`,
            inline: true,
          }]),
        }],
      });
    }
    if (vodUrl) {
      await msg.edit({
        embeds: [{
          ...msg?.embeds[0].data,
          fields: msg?.embeds[0].fields
            .filter(field => field.name !== 'VOD') // Remove previous VOD attachment
            .concat([{
              name: 'VOD',
              value: vodUrl,
            }]),
        }],
      });
    }

    // await msg.react(isCompleted ? '✅' : '❎');
  }

  private handleSongRequestAdded = async (payload: WebSocketMessage<'song_request_added'>) => {
    if (!this.songRequestsChannel) return;
    const requester = await db.selectFrom('songRequests').select('requester').where('id', '=', payload.songRequestId).execute();
    if (requester[0].requester !== 'danny_the_liar') {
      await this.announceNewSongRequest(payload.songRequestId);
    }
  };

  private handleSongRequestRemoved = async (payload: WebSocketMessage<'song_request_removed' | 'song_playback_completed'>) => {
    if (!this.songRequestsChannel || !payload.songRequestId) return;
    await this.updateCompletedSongRequest(payload.songRequestId, Math.floor(Date.now() / 1000));
  };
}
