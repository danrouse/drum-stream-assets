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

    this.wss.registerHandler('wheel_select_song_requester', this.handleSongRequestSelection);
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

  private handleSongRequestSelection = async (payload: WebSocketMessage<'wheel_select_song_requester'>) => {
    const viewer = await this.client.getViewer(payload.name);
    if (!viewer?.online) {
      await this.client.sendTwitchMessage(`@${payload.name} are you there? Your song was selected but you don't appear to be online! AAAA`);
    }
  };

  private handleHatSelection = async (payload: WebSocketMessage<'wheel_select_hat'>) => {
    await this.client.sendTwitchMessage(`THE HAT WHEEL SAYS: ${payload.hat}! dannyt75Spin dannyt75Spin dannyt75Spin`);
  };
}
