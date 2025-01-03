import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { WebSocketServerMessage, WebSocketPlayerMessage, WebSocketMessageHandler } from '../../shared/messages';

export default class WebSocketCoordinatorServer {
  public handlers: WebSocketMessageHandler[] = [];
  private wss: WebSocketServer;

  constructor(httpServer: Server) {
    this.wss = new WebSocketServer({ server: httpServer });

    this.wss.on('connection', (ws) => {
      console.info(`WebSocket connection opened, now ${this.wss.clients.size} connected clients`);
      ws.on('error', console.error);
      ws.on('message', async (message) => {
        // Broadcast all received messages to all clients
        this.broadcast(message.toString());

        try {
          const payload = JSON.parse(message.toString()) as WebSocketServerMessage | WebSocketPlayerMessage;
          for (let handler of this.handlers) {
            await handler(payload);
          }
        } catch (e) {}
      });
      ws.on('close', () => {
        // manually cleanup event listeners when closing a connection
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        console.info(`WebSocket connection closed, now ${this.wss.clients.size} connected clients`);
      });
    });
  }

  public broadcast = (payload: WebSocketServerMessage | string) => {
    this.wss.clients.forEach(ws =>
      ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload)));
    Promise.all(this.handlers.map(h => h(payload)));
  }
}
