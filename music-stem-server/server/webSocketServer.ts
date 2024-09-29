import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

export default function createWebSocketServer(httpServer: Server) {
  const wsServer = new WebSocketServer({ server: httpServer });

  wsServer.on('connection', (ws) => {
    console.info(`WebSocket connection opened, now ${wsServer.clients.size} connected clients`);
    ws.on('error', console.error);
    // Broadcast all received messages to all clients
    ws.on('message', (message) => broadcast(message.toString()));
    ws.on('close', () => {
      console.info(`WebSocket connection closed, now ${wsServer.clients.size} connected clients`);
    });
  });

  const broadcast = (payload: WebSocketServerMessage | string) => {
    wsServer.clients.forEach(ws =>
      ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload)));
  }

  return broadcast;
}
