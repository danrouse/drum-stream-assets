import 'dotenv/config';
import createHttpServer from './http';
import WebSocketCoordinatorServer from './WebSocketCoordinatorServer';
import StreamerbotWebSocketClient from './StreamerbotWebSocketClient';
import SongRequestModule from './features/streamerbot/SongRequestModule';
import MIDIModule from './features/MIDIModule';
import DiscordModule from './features/DiscordModule';
import ShenanigansModule from './features/streamerbot/ShenanigansModule';
import { createLogger } from '../../shared/util';

const log = createLogger('Main');

process.on('unhandledRejection', (reason: any) => {
  log('unhandledRejection', reason?.message, reason);
});

const IS_TEST_MODE = process.env.TEST_MODE === '1';
log('Starting with test mode =', IS_TEST_MODE);

const httpServer = createHttpServer(Number(process.env.PORT) || 3000);
const webSocketCoordinatorServer = new WebSocketCoordinatorServer(httpServer);

const midiModule = new MIDIModule(webSocketCoordinatorServer.broadcast);

const streamerbotWebSocketClient = new StreamerbotWebSocketClient(
  webSocketCoordinatorServer.broadcast,
  IS_TEST_MODE
);
webSocketCoordinatorServer.handlers.push(streamerbotWebSocketClient.messageHandler);

const songRequestModule = new SongRequestModule(
  streamerbotWebSocketClient,
  webSocketCoordinatorServer.broadcast
);
webSocketCoordinatorServer.handlers.push(songRequestModule.messageHandler);

const shenanigansModule = new ShenanigansModule(
  streamerbotWebSocketClient,
  webSocketCoordinatorServer.broadcast,
  midiModule,
);
webSocketCoordinatorServer.handlers.push(shenanigansModule.messageHandler);

const discordModule = new DiscordModule(IS_TEST_MODE);
webSocketCoordinatorServer.handlers.push(discordModule.messageHandler);
