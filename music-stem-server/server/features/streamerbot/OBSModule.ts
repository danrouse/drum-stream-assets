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

  constructor(
    client: StreamerbotWebSocketClient,
    wss: WebSocketCoordinatorServer
  ) {
    this.client = client;
    this.wss = wss;

    this.client.on('Obs.SceneChanged', this.handleOBSSceneChanged);
    this.client.on('Obs.StreamingStarted', this.handleOBSStreamingStarted);
    this.client.on('Obs.StreamingStopped', this.handleOBSStreamingStopped);
  }

  private handleOBSSceneChanged = async (payload: StreamerbotEventPayload<"Obs.SceneChanged">) => {
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
