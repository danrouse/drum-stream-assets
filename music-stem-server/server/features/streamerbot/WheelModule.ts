import StreamerbotWebSocketClient from '../../StreamerbotWebSocketClient';
import WebSocketCoordinatorServer from '../../WebSocketCoordinatorServer';

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
    this.client.registerCustomEventHandler('WheelSpin', this.spinWheel);
  }

  private toggleWheelVisibility = async () => {
    this.wss.broadcast({
      type: 'wheel_toggle_visibility',
    });
  };

  private spinWheel = async () => {
    this.wss.broadcast({
      type: 'wheel_spin',
    });
  };
}
