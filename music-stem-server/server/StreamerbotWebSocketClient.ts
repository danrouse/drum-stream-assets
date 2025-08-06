import { StreamerbotClient, StreamerbotEventPayload, StreamerbotViewer, StreamerbotEventName } from '@streamerbot/client';
import WebSocketCoordinatorServer from './WebSocketCoordinatorServer';
import { db } from './database';
import * as queries from './queries';
import { createLogger } from '../../shared/util';
import { WebSocketMessage, WebSocketBroadcaster, SongData } from '../../shared/messages';
import * as Streamerbot from '../../shared/streamerbot';

export const TwitchRewardDurations: Streamerbot.TwitchRewardMeta<number> = {
  'Motorcycle Helmet': 300000,
  'Pick ONE Hat': 180000,
  'Pick TWO Hats': 180000,
  'Pick THREE Hats': 180000,

  // TODO: Relocate into EmotesModule
  'Pin an Emote': 30000,

  // TODO: Relocate into ShenanigansModule
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

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type CommandPayload = {
  user: string;
  message: string;
};
export type TwitchRedemptionPayload = {
  user: string;
  input: string;
  rewardId: string;
  redemptionId: string;
};

export default class StreamerbotWebSocketClient {
  private client: StreamerbotClient;
  private wss: WebSocketCoordinatorServer;

  private twitchUnpauseTimers: { [rewardName in Streamerbot.TwitchRewardName]?: NodeJS.Timeout } = {};
  private twitchDebounceQueue: { [key: string]: number } = {};
  private streamerbotActionQueue: Array<[Streamerbot.ActionName, any]> = [];
  private updateViewersTimer?: NodeJS.Timeout;
  private viewers: Array<StreamerbotViewer & { online: boolean }> = [];
  private commandHandlers: { [command in Streamerbot.CommandName]?: (payload: CommandPayload) => void } = {};
  private twitchRedemptionHandlers: { [reward in Streamerbot.TwitchRewardName]?: (payload: TwitchRedemptionPayload) => void } = {};
  private customEventHandlers: { [event: string]: (payload: any) => void } = {};

  private isConnected = false;
  private isTestMode = false;

  public currentSong?: SongData;
  public currentSongSelectedAtTime?: string;

  public on: typeof StreamerbotClient.prototype.on;

  public static readonly BOT_TWITCH_USER_ID = '1148563762';

  constructor(
    wss: WebSocketCoordinatorServer,
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
    this.client.on('Custom.Event', this.handleCustomEvent.bind(this));

    this.on = this.client.on.bind(this.client);

    this.wss = wss;

    this.isTestMode = Boolean(isTestMode);
    if (isTestMode) {
      this.log('Starting in test mode');
    }

    this.wss.registerHandler('song_changed', this.handleSongChanged);
    this.wss.registerHandler('song_played', () => this.doAction('Queue: Pause', { queueName: 'TTS' }));
    this.wss.registerHandler('song_playpack_paused', () => this.doAction('Queue: Unpause', { queueName: 'TTS' }));
    this.wss.registerHandler('song_playback_completed', this.handleSongEnded);

    this.registerCommandHandler('!song', async (payload) => {
      if (this.currentSong) {
        await this.sendTwitchMessage(`@${payload.user} The current song is ${this.currentSong.artist} - ${this.currentSong.title}`);
      }
    });

    this.registerCommandHandler('!inventory', async (payload) => {
      const user = await this.getUser(payload.user);
      await this.sendTwitchMessage(`@${payload.user} You have ${user.nameThatTunePoints} points, ${user.availableLongSongs} long song requests, and ${user.availableBumps} bumps available to use`);
    });
    const PRICE_BUMP = 10;
    const PRICE_LONG_SR = 15;
    this.registerCommandHandler('!buy', async (payload) => {
      const user = await this.getUser(payload.user);
      const userUpdate = db.updateTable('users').where('id', '=', user.id);
      const args = payload.message.trim().toLowerCase().replace(/^!/, '').split(' ');
      let count = 1, item;
      for (const arg of args) {
        const itemMatch = arg.match(/<?(bump|longsr)s?>?/);
        if (itemMatch) {
          item = itemMatch[1];
          continue;
        }
        const countMatch = arg.match(/^(\d+)$/);
        if (countMatch) {
          count = Number(countMatch[1]);
          continue;
        }
      }
      if (item === 'bump') {
        if (user.nameThatTunePoints < (PRICE_BUMP * count)) {
          await this.sendTwitchMessage(`@${payload.user} You don't have enough points! ${count === 1 ? 'A bump' : `${count} bumps`} costs ${PRICE_BUMP * count} and you have ${user.nameThatTunePoints || '0'}`);
        } else {
          await userUpdate.set({
            availableBumps: user.availableBumps + count,
            nameThatTunePoints: user.nameThatTunePoints - (PRICE_BUMP * count),
          }).execute();
          await this.sendTwitchMessage(`@${payload.user} ${count === 1 ? 'Bump' : `${count} bumps`} acquired! Use ${count === 1 ? 'it' : 'them'} with !bump. You now have ${user.availableBumps + count} bumps and ${user.nameThatTunePoints - (PRICE_BUMP * count)} points`);
        }
      } else if (item === 'longsr') {
        if (user.nameThatTunePoints < (PRICE_LONG_SR * count)) {
          await this.sendTwitchMessage(`@${payload.user} You don't have enough points! ${count === 1 ? 'A long song request' : `${count} long song requests`} costs ${PRICE_LONG_SR * count} and you have ${user.nameThatTunePoints || '0'}`);
        } else {
          await userUpdate.set({
            availableLongSongs: user.availableLongSongs + count,
            nameThatTunePoints: user.nameThatTunePoints - (PRICE_LONG_SR * count),
          }).execute();
          await this.sendTwitchMessage(`@${payload.user} ${count === 1 ? 'Long song request' : `${count} Long SRs`} acquired! Use ${count === 1 ? 'it' : 'them'} with !longsr. You now have ${user.availableLongSongs + count} long song requests and ${user.nameThatTunePoints - (PRICE_LONG_SR * count)} points`);
        }
      } else {
        await this.sendTwitchMessage(`@${payload.user} Usage: !buy bump # (for ${PRICE_BUMP} pts) | !buy longsr # (for ${PRICE_LONG_SR} pts)`);
        return;
      }
    });

    this.registerCommandHandler('!give', async (payload) => {
      // !give <person> <item> <number=1>
      // allow arguments in any position!
      const args = payload.message.toLowerCase().split(' ');
      let count = 1, item, recipient;
      for (const arg of args) {
        const itemMatch = arg.match(/<?(bump|longsr)s?>?/);
        if (itemMatch) {
          item = itemMatch[1];
          continue;
        }
        const countMatch = arg.match(/^(\d+)$/);
        if (countMatch) {
          count = Number(countMatch[1]);
          continue;
        }
        recipient = arg.replace(/@/g, '');
      }
      if (!count || !item || !recipient) {
        await this.sendTwitchMessage(`@${payload.user} Usage: !give @person <longsr|bump> #`);
        return;
      }
      // ensure giver has enough
      const givingUser = await this.getUser(payload.user);
      if (
        (item === 'bump' && givingUser.availableBumps < count) ||
        (item === 'longsr' && givingUser.availableLongSongs < count)
      ) {
        await this.sendTwitchMessage(`@${payload.user} You don't have enough to give!`);
      } else {
        const col = item === 'bump' ? 'availableBumps' : 'availableLongSongs';
        // update giver
        await db.updateTable('users')
          .where('id', '=', givingUser.id)
          .set(q => ({
            [col]: q(col, '-', count)
          }))
          .execute();

        // update recipient
        const receivingUser = await this.getUser(recipient);
        await db.updateTable('users')
          .where('id', '=', receivingUser.id)
          .set(q => ({
            [col]: q(col, '+', count)
          }))
          .execute();

        await this.sendTwitchMessage(`@${payload.user} has given @${recipient} ${count === 1 ? `a ${item}` : `${count} ${item}s`}!`);
      }
    });
  }

  public registerCommandHandler(
    command: Streamerbot.CommandName,
    handler: (payload: CommandPayload) => void
  ) {
    if (this.commandHandlers[command]) {
      throw new Error(`Duplicate command handler registered for ${command}`);
    }
    this.commandHandlers[command] = handler;
  }

  public registerTwitchRedemptionHandler(
    reward: Streamerbot.TwitchRewardName,
    handler: (payload: TwitchRedemptionPayload) => void
  ) {
    if (this.twitchRedemptionHandlers[reward]) {
      throw new Error(`Duplicate twitch redemption handler registered for ${reward}`);
    }
    this.twitchRedemptionHandlers[reward] = handler;
  }

  // There is no type safety on defining these handlers!
  public registerCustomEventHandler<TEvent extends StreamerbotEventName>(
    eventName: string,
    handler: (payload: StreamerbotEventPayload<TEvent>['data'] & { triggerName: string }) => void,
  ) {
    if (this.customEventHandlers[eventName]) {
      throw new Error(`Duplicate custom event handler registered for ${eventName}`);
    }
    this.customEventHandlers[eventName] = handler;
  }

  public mockStreamerbotMessage<TEvent>(
    event: TEvent extends StreamerbotEventName ? TEvent : StreamerbotEventName,
    // This uses a DeepPartial so we don't have to mock entire payloads,
    // but it's dangerous because it's not clear which properties we actually rely on
    // for any given event. Some of the payloads are quite large and use lots of
    // fields that are almost never relevant to our uses, but it's still not great.
    data: DeepPartial<StreamerbotEventPayload<TEvent extends StreamerbotEventName ? TEvent : StreamerbotEventName>['data']>
  ) {
    const [source, type] = event.split('.');
    // We are breaking the rules and calling a protected method
    // Be ungovernable!
    // @ts-expect-error
    this.client.onMessage({
      data: JSON.stringify({
        timeStamp: new Date().toISOString(),
        event: { source, type },
        data
      })
    });
  }

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

    // call StreamerbotClient request method manually
    // so as to replace the third (timeout) parameter,
    // rather than use client.doAction directly
    // (timeout is not overwriteable in that impl)
    const result = await this.client.request({
      request: 'DoAction',
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

  private handleSongEnded = async (payload: WebSocketMessage<'song_playback_completed'>) => {
    // Add playback to history
    await db.insertInto('songHistory')
      .values([{
        songId: payload.id,
        songRequestId: payload.songRequestId,
        startedAt: this.currentSongSelectedAtTime,
        endedAt: new Date().toISOString(),
      }])
      .execute();

    // Make sure TTS queue is unpaused
    await this.doAction('Queue: Unpause', { queueName: 'TTS' });
  };

  private handleSongChanged = async (payload: WebSocketMessage<'song_changed'>) => {
    this.currentSong = payload.song;
    this.currentSongSelectedAtTime = new Date().toISOString();
  };

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
    if (payload.data.message.userId === StreamerbotWebSocketClient.BOT_TWITCH_USER_ID) return;
    this.wss.broadcast({
      type: 'chat_message',
      user: payload.data.message.displayName,
      message: payload.data.message.message,
    });
  }

  private async updateActiveViewers() {
    const res = await this.client.getActiveViewers();
    const viewers: typeof this.viewers = res.viewers.map(v => ({
      ...v,
      online: true,
      color: this.viewers.find(v2 => v2.id === v.id)?.color,
    }));
    for (let prevViewer of this.viewers) {
      if (!viewers.find(v => v.id === prevViewer.id)) {
        // viewer was in previous list but is no longer showing online
        // retain the viewer information but mark as offline
        prevViewer.online = false;
        viewers.push(prevViewer)
      }
    }
    this.viewers = viewers;
    this.wss.broadcast({ type: 'viewers_update', viewers });
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
    return this.doAction(
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

  private async handleTwitchRewardRedemption(payload: StreamerbotEventPayload<"Twitch.RewardRedemption">) {
    const rewardName = Streamerbot.rewardNameById(payload.data.reward.id);
    if (!rewardName) return;

    this.log(`Channel point redemption by ${payload.data.user_name}: ${rewardName}`);

    this.twitchRedemptionHandlers[rewardName]?.({
      user: payload.data.user_name,
      input: payload.data.user_input,
      rewardId: payload.data.reward.id,
      redemptionId: payload.data.id,
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

  private async handleCommandTriggered(payload: StreamerbotEventPayload<"Command.Triggered">) {
    const commandName = Streamerbot.CommandAliases[payload.data.command];
    if (!commandName) return;

    this.log('Command triggered', payload.data.command, commandName, payload.data.user.display, payload.data.message);

    this.commandHandlers[commandName]?.({
      user: payload.data.user.display,
      message: payload.data.message,
    });
  }

  private async handleCustomEvent(payload: StreamerbotEventPayload<"Custom.Event">) {
    const eventName = payload.data.eventName;
    if (eventName === '!today') {
      const res = await queries.songsPlayedTodayCount();
      await this.sendTwitchMessage(`Danny has played ${res[0].count} songs so far today! 💦 ${'🥁'.repeat(res[0].count)}`);
    }

    this.customEventHandlers[eventName]?.(payload.data.args);
  }

  public async getUser(userName: string) {
    let user = await db.selectFrom('users')
      .selectAll()
      .where(q => q.fn<string>('lower', ['name']), '=', userName.toLowerCase())
      .execute();
    if (!user.length) {
      user = await db.insertInto('users').values({ name: userName }).returningAll().execute();
    }
    return user[0];
  }
}
