/**
 * Shenanigans submodule
 *
 * Handles all of the redemptions that screw with the music and drums
 */
import { StreamerbotEventPayload } from '@streamerbot/client';
import MIDIModule from '../MIDIModule';
import StreamerbotWebSocketClient, { TwitchRewardDurations } from '../../StreamerbotWebSocketClient';
import * as Streamerbot from '../../../../shared/streamerbot';
import { WebSocketMessage } from '../../../../shared/messages';
import { getKitDefinition, td30KitsPastebin } from '../../../../shared/td30Kits';
import WebSocketCoordinatorServer from '../../WebSocketCoordinatorServer';

const SPEED_CHANGE_BASE_PRICE = 150;
const SPEED_CHANGE_AMOUNT = 0.15;

const SHENANIGANS_REWARD_NAMES: Streamerbot.TwitchRewardName[] = [
  'Mute Song\'s Drums', 'Mute Song\'s Vocals',
  'Slow Down Music', 'Speed Up Music',
  'Fart Mode',
  'Randomize Drums', 'Randomize EVERY HIT',
  'Disable Shenanigans (Current Song)', 'Reset All Shenanigans',
  // 'Change Drum Kit'
];

export default class ShenanigansModule {
  private client: StreamerbotWebSocketClient;
  private wss: WebSocketCoordinatorServer;
  private midiModule: MIDIModule;

  private isEnabled = true;
  private lastSongWasNoShens = false;
  private kitResetTimer?: NodeJS.Timeout;

  constructor(
    client: StreamerbotWebSocketClient,
    wss: WebSocketCoordinatorServer,
    midiModule: MIDIModule,
  ) {
    this.client = client;
    this.wss = wss;
    this.midiModule = midiModule;

    this.client.on('General.Custom', this.handleCustom);

    this.client.registerTwitchRedemptionHandler('Disable Shenanigans (Current Song)', (payload) => {
      this.disable();
    });
    this.client.registerTwitchRedemptionHandler('Reset All Shenanigans', (payload) => {
      this.reset();
    });
    this.client.registerTwitchRedemptionHandler('Fart Mode', (payload) => {
      this.enableFartMode(TwitchRewardDurations['Fart Mode']!);
    });
    this.client.registerTwitchRedemptionHandler('Randomize Drums', (payload) => {
      this.enableRandomizedDrums(TwitchRewardDurations['Randomize Drums']!, false);
    });
    this.client.registerTwitchRedemptionHandler('Randomize EVERY HIT', (payload) => {
      this.enableRandomizedDrums(TwitchRewardDurations['Randomize EVERY HIT']!, true);
    });
    this.client.registerTwitchRedemptionHandler('Change Drum Kit', async (payload) => {
      const kit = getKitDefinition(payload.input);
      if (!kit) {
        await this.client.sendTwitchMessage(`${payload.user}, please include one of the numbers or names of a kit from here: ${td30KitsPastebin} (refunded!)`);
        await this.client.updateTwitchRedemption(payload.rewardId, payload.redemptionId, 'cancel');
        return;
      }
      this.midiModule.changeKit(kit[0], !this.kitResetTimer);
      if (this.kitResetTimer) {
        clearTimeout(this.kitResetTimer);
        delete this.kitResetTimer;
      }
      await this.client.sendTwitchMessage(`Drum kit has been changed to ${kit[1]} for two minutes!`);
      this.kitResetTimer = setTimeout(() => {
        this.midiModule.resetKit();
        delete this.kitResetTimer;
      }, TwitchRewardDurations['Change Drum Kit']);
    });

    this.wss.registerHandler('song_speed', this.handleSongSpeedChanged);
    this.wss.registerHandler('song_changed', this.handleSongChanged);
  }

  private async enable() {
    this.isEnabled = true;
    for (let rewardName of SHENANIGANS_REWARD_NAMES) {
      await this.client.unpauseTwitchRedemption(rewardName);
    }
    await this.client.doAction('OBS Visibility Off', {
      sourceName: 'No shenanigans'
    });
  }

  private reset() {
    this.midiModule.resetKit();
    this.client.destroyUnpauseTimers();
    this.wss.broadcast({
      type: 'client_remote_control',
      action: 'Reset All Shenanigans',
    });
  }

  private async disable() {
    this.reset();
    this.isEnabled = false;
    this.lastSongWasNoShens = true;
    for (let rewardName of SHENANIGANS_REWARD_NAMES) {
      await this.client.pauseTwitchRedemption(rewardName);
    }
    await this.client.doAction('OBS Visibility On', {
      sourceName: 'No shenanigans'
    });
  }

  private async handleSongChanged(payload: WebSocketMessage<'song_changed'>) {
    // Allow for "no-shenanigans" SRs
    if (payload.song.noShenanigans) {
      await this.disable();
      this.lastSongWasNoShens = true;
    } else if (this.lastSongWasNoShens) {
      await this.enable();
      this.lastSongWasNoShens = false;
    }
  }

  private async handleSongSpeedChanged(payload: WebSocketMessage<'song_speed'>) {
    // Scale the price of speed up/slow down song redemptions based on current speed
    const speedDiffSteps = Math.abs(1 - payload.speed) / SPEED_CHANGE_AMOUNT;
    const isFaster = payload.speed > 1;
    const nextSlowDownPrice = Math.round(isFaster ?
      SPEED_CHANGE_BASE_PRICE - (speedDiffSteps * (SPEED_CHANGE_BASE_PRICE / 2)) :
      SPEED_CHANGE_BASE_PRICE + (speedDiffSteps * (SPEED_CHANGE_BASE_PRICE / 2)));
    const nextSpeedUpPrice = Math.round(!isFaster ?
      SPEED_CHANGE_BASE_PRICE - (speedDiffSteps * (SPEED_CHANGE_BASE_PRICE / 2)) :
      SPEED_CHANGE_BASE_PRICE + (speedDiffSteps * (SPEED_CHANGE_BASE_PRICE / 2)));

    await this.client.doAction('Reward: Change Price', {
      rewardId: Streamerbot.TwitchRewardIds['Slow Down Music'],
      price: nextSlowDownPrice,
    });
    await this.client.doAction('Reward: Change Price', {
      rewardId: Streamerbot.TwitchRewardIds['Speed Up Music'],
      price: nextSpeedUpPrice,
    });

    // Limit min/max speed within the realm of reason
    const MIN_PLAYBACK_SPEED = 0.4;
    const MAX_PLAYBACK_SPEED = 1.9;
    const slowDownRewardAction = payload.speed <= MIN_PLAYBACK_SPEED ? 'Reward: Pause' : 'Reward: Unpause';
    await this.client.doAction(slowDownRewardAction, { rewardId: Streamerbot.TwitchRewardIds['Slow Down Music'] });
    const speedUpRewardAction = payload.speed >= MAX_PLAYBACK_SPEED ? 'Reward: Pause' : 'Reward: Unpause';
    await this.client.doAction(speedUpRewardAction, { rewardId: Streamerbot.TwitchRewardIds['Speed Up Music'] });

    // Re-disable the rewards if shenanigans are off
    if (!this.isEnabled) {
      await this.client.pauseTwitchRedemption('Slow Down Music', 1000 * 60 * 60 * 24);
      await this.client.pauseTwitchRedemption('Speed Up Music', 1000 * 60 * 60 * 24);
    }
  }

  private enableFartMode(duration: number) {
    this.midiModule.muteToms(!this.kitResetTimer);
    if (this.kitResetTimer) {
      clearTimeout(this.kitResetTimer);
      delete this.kitResetTimer;
    }
    this.kitResetTimer = setTimeout(() => {
      this.midiModule.resetKit();
      delete this.kitResetTimer;
    }, duration);
  }

  private enableRandomizedDrums(duration: number, randomizeEveryHit: boolean) {
    this.midiModule.randomize(!randomizeEveryHit);
    if (this.kitResetTimer) {
      clearTimeout(this.kitResetTimer);
      delete this.kitResetTimer;
    }
    this.kitResetTimer = setTimeout(() => {
      this.midiModule.resetKit();
      delete this.kitResetTimer;
    }, duration);
  }

  private handleCustom = (payload: StreamerbotEventPayload<"General.Custom">) => {
    if (payload.data.data === 'NoShenanigans') {
      if (this.isEnabled) {
        this.disable();
      } else {
        this.enable();
      }
    }
  };
}
