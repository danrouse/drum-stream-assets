import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { handleSongRequest } from './songRequests';

export default function createWebSocketServer(httpServer: Server) {
  const wsServer = new WebSocketServer({ server: httpServer });

  const livesplitClient = new WebSocket(`ws://localhost:16834/livesplit`);
  livesplitClient.on('open', () => {
    // Clear all old split names
    for (let i = 0; i < 200; i++) {
      livesplitClient.send(`setsplitname ${i} `);
    }
    // Start timer right away so we can just pause/resume it
    livesplitClient.send('starttimer');
    livesplitClient.send('pause');
  });

  wsServer.on('connection', (ws) => {
    console.info(`WebSocket connection opened, now ${wsServer.clients.size} connected clients`);
    ws.on('error', console.error);
    // Broadcast all received messages to all clients
    ws.on('message', async (message) => {
      broadcast(message.toString());

      try {
        const parsedPayload = JSON.parse(message.toString()) as WebSocketServerMessage | WebSocketPlayerMessage;
        if (parsedPayload.type === 'song_request') {
          try {
            await handleSongRequest(parsedPayload.query);
          } catch (e) {
            broadcast({ type: 'download_error', query: parsedPayload.query });
          }
        } else if (parsedPayload.type === 'song_changed') {
          livesplitClient.send('resume');
          livesplitClient.send('startorsplit');
          livesplitClient.send('pause');
          livesplitClient.send(`setcurrentsplitname ${parsedPayload.title} (${parsedPayload.artist})`);
        } else if (parsedPayload.type === 'song_played') {
          livesplitClient.send('resume');
        } else if (parsedPayload.type === 'song_paused') {
          livesplitClient.send('pause');
        } else if (parsedPayload.type === 'song_stopped') {
          livesplitClient.send('split');
          livesplitClient.send('pause');
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

  return broadcast;
}
