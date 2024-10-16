import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { handleSongRequest } from './songRequests';

export default function createWebSocketServer(httpServer: Server) {
  const wsServer = new WebSocketServer({ server: httpServer });
  const handlers: WebSocketMessageHandler[] = [];

  wsServer.on('connection', (ws) => {
    console.info(`WebSocket connection opened, now ${wsServer.clients.size} connected clients`);
    ws.on('error', console.error);
    ws.on('message', async (message) => {
      // Broadcast all received messages to all clients
      broadcast(message.toString());

      try {
        const parsedPayload = JSON.parse(message.toString()) as WebSocketServerMessage | WebSocketPlayerMessage;
        if (parsedPayload.type === 'song_request') {
          try {
            await handleSongRequest(parsedPayload.query);
          } catch (e) {
            broadcast({ type: 'download_error', query: parsedPayload.query });
          }
        }
        for (let handler of handlers) {
          await handler(parsedPayload);
        }
      } catch (e) {}
    });
    ws.on('close', () => {
      // manually cleanup event listeners when closing a connection
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      console.info(`WebSocket connection closed, now ${wsServer.clients.size} connected clients`);
    });
  });

  const broadcast: WebSocketBroadcaster = (payload) => {
    wsServer.clients.forEach(ws =>
      ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload)));
  }

  return { broadcast, handlers };
}
