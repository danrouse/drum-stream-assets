import { WebSocketServer } from 'ws';
import { Server } from 'http';
import { WebSocketMessage, WebSocketPlayerMessage, WebSocketMessageHandler } from '../../shared/messages';
import { createLogger } from '../../shared/util';

export default class WebSocketCoordinatorServer {
  public handlers: WebSocketMessageHandler[] = [];
  private wss: WebSocketServer;

  constructor(httpServer: Server) {
    this.wss = new WebSocketServer({ server: httpServer });

    this.wss.on('connection', (ws) => {
      this.log(`WebSocket connection opened, now ${this.wss.clients.size} connected clients`);
      ws.on('error', createLogger('WSS', 'error'));
      ws.on('message', async (message) => {
        try {
          // Broadcast all received messages to all clients
          const payload = JSON.parse(message.toString()) as WebSocketMessage;
          this.broadcast(payload);
        } catch (e) {
          this.log('Failed to parse/rebroadcast message', message.toString());
        }
      });
      ws.on('close', () => {
        // manually cleanup event listeners when closing a connection
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        this.log(`WebSocket connection closed, now ${this.wss.clients.size} connected clients`);
      });
    });
  }

  private log = createLogger('WSS');

  private static unloggedMessageTypes: WebSocketMessage["type"][] = ['viewers_update', 'song_progress'];

  public broadcast = (payload: WebSocketMessage) => {
    if (!WebSocketCoordinatorServer.unloggedMessageTypes.includes(payload.type)) {
      this.log('broadcast', payload);
    }
    this.wss.clients.forEach(ws =>
      ws.send(JSON.stringify(payload)));
    this.handlers.forEach(handler => handler(payload));
  }
}
