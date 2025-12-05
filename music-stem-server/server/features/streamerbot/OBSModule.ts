/**
 * OBS submodule
 *
 * - handles Fullscreen Video redemption
 * - creates stream markers to split/tag VODs
 * - saves stream start/end times in database
 */
import { StreamerbotEventPayload } from '@streamerbot/client';
import { sql } from 'kysely';
import StreamerbotWebSocketClient from '../../StreamerbotWebSocketClient';
import { db } from '../../database';
import * as queries from '../../queries';
import * as Streamerbot from '../../../../shared/streamerbot';
import { WebSocketMessage } from '../../../../shared/messages';
import WebSocketCoordinatorServer from '../../WebSocketCoordinatorServer';

export default class OBSModule {
  private client: StreamerbotWebSocketClient;
  private wss: WebSocketCoordinatorServer;

  private currentScene?: string;

  constructor(
    client: StreamerbotWebSocketClient,
    wss: WebSocketCoordinatorServer
  ) {
    this.client = client;
    this.wss = wss;

    this.client.on('Obs.SceneChanged', this.handleOBSSceneChanged);
    this.client.on('Obs.StreamingStarted', this.handleOBSStreamingStarted);
    this.client.on('Obs.StreamingStopped', this.handleOBSStreamingStopped);
    // this.client.registerTwitchRedemptionHandler('Fullscreen Video', (payload) => {
    //   if (this.client.currentSong?.isVideo) {
    //     this.client.doAction('Set OBS Scene', {
    //       sceneName: 'Fullscreen Video'
    //     });
    //   }
    // });

    this.wss.registerHandler('song_changed', this.handleSongChanged);
    this.wss.registerHandler('song_playback_started', this.handleSongStarted);
    this.wss.registerHandler('song_playback_completed', this.handleSongEnded);
    this.wss.registerHandler('song_stopped', this.handleSongStopped);
  }

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

  private handleSongStarted = async (payload: WebSocketMessage<'song_playback_started'>) => {
    // Create stream marker for song request start
    let markerName = `Song Start: Song #${payload.id}`;
    if (payload.songRequestId) {
      markerName += ` SR #${payload.songRequestId}`;
    }
    await this.client.doAction('Create Stream Marker', { description: markerName });
  };

  private handleSongEnded = async (payload: WebSocketMessage<'song_playback_completed'>) => {
    // Create stream marker for song request end
    let markerName = `Song End: Song #${payload.id}`;
    if (payload.songRequestId) {
      markerName += ` SR #${payload.songRequestId}`;
    }
    await this.client.doAction('Create Stream Marker', { description: markerName });

    await this.client.doAction('OBS Mic Reverb Off');
  };

  private handleSongStopped = async (payload: WebSocketMessage<'song_stopped'>) => {
    await this.client.doAction('OBS Mic Reverb Off');
  };

  private handleSongChanged = async (payload: WebSocketMessage<'song_changed'>) => {
    // this.updateFullscreenVideoEnabled();

    // Leave fullscreen video if we switch to a song that isn't a video
    if (this.currentScene === 'Fullscreen Video' && !payload.song.isVideo) {
      await this.client.doAction('Set OBS Scene', {
        sceneName: 'Drums main'
      });
    }
  };

  private handleOBSSceneChanged = async (payload: StreamerbotEventPayload<"Obs.SceneChanged">) => {
    this.currentScene = payload.data.scene.sceneName;
    // this.updateFullscreenVideoEnabled();
    this.wss.broadcast({
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
      .set('endedAt', sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
      .where('id', '=', record[0].id)
      .execute();
  };
}
