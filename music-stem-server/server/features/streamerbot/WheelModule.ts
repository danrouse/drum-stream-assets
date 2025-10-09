import StreamerbotWebSocketClient from '../../StreamerbotWebSocketClient';
import WebSocketCoordinatorServer from '../../WebSocketCoordinatorServer';
import { db } from '../../database';
import { WebSocketMessage } from '../../../../shared/messages';

export default class WheelModule {
  private client: StreamerbotWebSocketClient;
  private wss: WebSocketCoordinatorServer;

  constructor(
    client: StreamerbotWebSocketClient,
    wss: WebSocketCoordinatorServer
  ) {
    this.client = client;
    this.wss = wss;

    this.client.registerCustomEventHandler('WheelToggleVisibility', this.toggleWheelVisibility);
    this.client.registerCustomEventHandler('WheelToggleMode', this.toggleWheelMode);
    this.client.registerCustomEventHandler('WheelSpin', this.spinWheel);

    this.wss.registerHandler('wheel_select_song_request', this.handleSongRequestSelection);
    this.wss.registerHandler('wheel_select_hat', this.handleHatSelection);
  }

  private toggleWheelVisibility = async () => {
    this.wss.broadcast({
      type: 'wheel_toggle_visibility',
    });
  };

  private toggleWheelMode = async () => {
    this.wss.broadcast({
      type: 'wheel_toggle_mode',
    });
  };

  private spinWheel = async () => {
    this.wss.broadcast({
      type: 'wheel_spin',
    });
  };

  private handleSongRequestSelection = async (payload: WebSocketMessage<'wheel_select_song_request'>) => {
    // Do a roll call check if the requester is showing as offline
    const request = await db.selectFrom('songRequests')
      .where('id', '=', payload.songRequestId)
      .select('requester')
      .executeTakeFirst();
    const viewer = request?.requester && await this.client.getViewer(request.requester);
    if (viewer && !viewer.online) {
      await this.client.sendTwitchMessage(`@${request.requester} are you there? Your song was selected but you don't appear online! AAAA`);
    }
  };

  private handleHatSelection = async (payload: WebSocketMessage<'wheel_select_hat'>) => {
    await this.client.sendTwitchMessage(`THE HAT WHEEL SAYS: ${payload.hat}! dannyt75Spin dannyt75Spin dannyt75Spin`);
  };
}
