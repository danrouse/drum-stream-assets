import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

const WS_REGISTER_RECEIVER_MESSAGE = 'receiver';
const broadcastReceivers: Array<WebSocket> = [];

export function createWebSocketServer(httpServer: Server) {
  const wsServer = new WebSocketServer({ server: httpServer });

  wsServer.on('connection', (ws) => {
    // console.log(`WebSocket connection opened, now ${wsServer.clients.size} connected clients`);
    ws.on('error', console.error);
    ws.on('message', message => {
      const parsedMessage = message.toString();
      if (parsedMessage === WS_REGISTER_RECEIVER_MESSAGE) {
        // console.log('add broadcaster');
        broadcastReceivers.push(ws);
      } else {
        // console.log('message broadcaster', parsedMessage);
        broadcast(parsedMessage, true);
      }
    });
    ws.on('close', () => {
      // console.log(`WebSocket connection closed, now ${wsServer.clients.size} connected clients`);
      if (broadcastReceivers.includes(ws)) {
        broadcastReceivers.splice(broadcastReceivers.indexOf(ws), 1);
        // console.log(`broadcast receiver disconnected, now ${broadcastReceivers.length} broadcasters`);
      }
    });
  });

  const broadcast = (payload: WebSocketOutgoingMessage | string, broadcast: boolean = false) =>
    [...wsServer.clients]
      .filter(client => !broadcast || broadcastReceivers.includes(client))
      .forEach(ws => ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload)));

  return broadcast;
}
