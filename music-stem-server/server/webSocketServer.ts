import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

export default function createWebSocketServer(httpServer: Server) {
  const wsServer = new WebSocketServer({ server: httpServer });

  wsServer.on('connection', (ws) => {
    console.info(`WebSocket connection opened, now ${wsServer.clients.size} connected clients`);
    ws.on('error', console.error);
    ws.on('message', (message) => {
      const messageString = message.toString();
      try {
        const parsedMessage = JSON.parse(messageString) as WebSocketPlayerMessage | WebSocketServerMessage;
        if (parsedMessage?.type !== 'send_twitch_message') {
          // Rebroadcast *most* (but not all) messages
          // console.log('Broadcast message', messageString);
          // TODO: 'song_changed' event we can kinda twitch message the new title/artist
          // however we should wait until also receiving a 'song_played' event so that it's actually on
          broadcast(messageString);
        }
      } catch (e) {}
    });
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
