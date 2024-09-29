import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { handleSongRequest } from './songRequests';

export default function createWebSocketServer(httpServer: Server) {
  const wsServer = new WebSocketServer({ server: httpServer });

  wsServer.on('connection', (ws) => {
    console.info(`WebSocket connection opened, now ${wsServer.clients.size} connected clients`);
    ws.on('error', console.error);
    // Broadcast all received messages to all clients
    ws.on('message', (message) => {
      broadcast(message.toString());

      try {
        const parsedPayload = JSON.parse(message.toString()) as WebSocketServerMessage | WebSocketPlayerMessage;
        if (parsedPayload.type === 'song_request') {
          handleSongRequest(parsedPayload.query);
        }
      } catch (e) {}
    });
    ws.on('close', () => {
      console.info(`WebSocket connection closed, now ${wsServer.clients.size} connected clients`);
    });
  });

  const broadcast: WebSocketBroadcaster = (payload) => {
    wsServer.clients.forEach(ws =>
      ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload)));
  }

  return broadcast;
}
