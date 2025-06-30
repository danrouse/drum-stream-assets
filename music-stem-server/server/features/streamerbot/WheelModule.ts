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

    this.client.registerCustomEventHandler('WheelShow', this.showWheel);
    this.client.registerCustomEventHandler('WheelHide', this.hideWheel);
    this.client.registerCustomEventHandler('WheelSpin', this.spinWheel);
  }

  private showWheel = async () => {
    this.wss.broadcast({
      type: 'wheel_show',
    });
  };

  private hideWheel = async () => {
    this.wss.broadcast({
      type: 'wheel_hide',
    });
  };

  private spinWheel = async () => {
    this.wss.broadcast({
      type: 'wheel_spin',
    });
  };
}
