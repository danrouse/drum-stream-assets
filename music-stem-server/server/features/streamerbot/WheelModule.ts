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
}
