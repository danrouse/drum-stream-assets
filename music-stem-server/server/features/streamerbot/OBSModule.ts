import { StreamerbotEventPayload } from '@streamerbot/client';
import { sql } from 'kysely';
import StreamerbotWebSocketClient from '../../StreamerbotWebSocketClient';
import { db } from '../../database';
import * as queries from '../../queries';
import * as Streamerbot from '../../../../shared/streamerbot';
import { WebSocketMessage, WebSocketBroadcaster, SongData } from '../../../../shared/messages';

export default class OBSModule {
  private client: StreamerbotWebSocketClient;
  private broadcast: WebSocketBroadcaster;

  private currentScene?: string;

  constructor(
    client: StreamerbotWebSocketClient,
    broadcast: WebSocketBroadcaster,
  ) {
    this.client = client;
    this.broadcast = broadcast;

    this.client.on('Obs.SceneChanged', this.handleOBSSceneChanged);
    this.client.on('Obs.StreamingStarted', this.handleOBSStreamingStarted);
    this.client.on('Obs.StreamingStopped', this.handleOBSStreamingStopped);
    this.client.on('Twitch.RewardRedemption', this.handleTwitchRewardRedemption);
  }

  public messageHandler = async (payload: WebSocketMessage) => {
    if (payload.type === 'song_changed') {
      this.handleSongChanged(payload.song);
    } else if (payload.type === 'song_playback_started') {
      this.handleSongStarted(payload.id, payload.songRequestId);
    } else if (payload.type === 'song_playback_completed') {
      this.handleSongEnded(payload.id, payload.songRequestId);
    }
  };

  private updateFullscreenVideoEnabled() {
    if (this.currentScene?.startsWith('Drums') && this.client.currentSong?.isVideo) {
      this.client.doAction(
        'Reward: Unpause',
        { rewardId: Streamerbot.TwitchRewardIds['Fullscreen Video'] }
      );
    } else {
      this.client.pauseTwitchRedemption('Fullscreen Video');
    }
  }

  private async handleSongStarted(songId: number, songRequestId?: number | null) {
    // Create stream marker for song request start
    let markerName = `Song Start: Song #${songId}`;
    if (songRequestId) {
      markerName += ` SR #${songRequestId}`;
    }
    await this.client.doAction('Create Stream Marker', { description: markerName });
  }

  private async handleSongEnded(songId: number, songRequestId?: number | null) {
    // Create stream marker for song request end
    let markerName = `Song End: Song #${songId}`;
    if (songRequestId) {
      markerName += ` SR #${songRequestId}`;
    }
    await this.client.doAction('Create Stream Marker', { description: markerName });
  }

  private async handleSongChanged(song: SongData) {
    this.updateFullscreenVideoEnabled();

    // Leave fullscreen video if we switch to a song that isn't a video
    if (this.currentScene === 'Fullscreen Video' && !song.isVideo) {
      await this.client.doAction('Set OBS Scene', {
        sceneName: 'Drums main'
      });
    }
  }

  private handleOBSSceneChanged = async (payload: StreamerbotEventPayload<"Obs.SceneChanged">) => {
    this.currentScene = payload.data.scene.sceneName;
    this.updateFullscreenVideoEnabled();
    this.broadcast({
      type: 'obs_scene_changed',
      oldScene: payload.data.oldScene.sceneName,
      scene: payload.data.scene.sceneName,
    });
  };

  private handleOBSStreamingStarted = async (payload: StreamerbotEventPayload<"Obs.StreamingStarted">) => {
    await db.insertInto('streamHistory')
      .defaultValues()
      .execute();
  };

  private handleOBSStreamingStopped = async (payload: StreamerbotEventPayload<"Obs.StreamingStopped">) => {
    const record = await queries.currentStreamHistory();
    await db.updateTable('streamHistory')
      .set('endedAt', sql`current_timestamp`)
      .where('id', '=', record[0].id)
      .execute();
  };

  private handleTwitchRewardRedemption = async (payload: StreamerbotEventPayload<"Twitch.RewardRedemption">) => {
    const rewardName = Streamerbot.rewardNameById(payload.data.reward.id);
    if (!rewardName) return;

    if (rewardName === 'Fullscreen Video') {
      if (this.client.currentSong?.isVideo) {
        await this.client.doAction('Set OBS Scene', {
          sceneName: 'Fullscreen Video'
        });
      }
    }
  };
}
