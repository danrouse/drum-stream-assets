import 'dotenv/config';
import createHttpServer from './http';
import WebSocketCoordinatorServer from './WebSocketCoordinatorServer';
import StreamerbotWebSocketClient from './StreamerbotWebSocketClient';
import SongRequestModule from './features/SongRequestModule';
import MIDIModule from './features/MIDIModule';
import DiscordModule from './features/DiscordModule';
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

const songRequestModule = new SongRequestModule(webSocketCoordinatorServer.broadcast);
webSocketCoordinatorServer.handlers.push(songRequestModule.messageHandler);

const streamerbotWebSocketClient = new StreamerbotWebSocketClient(
  webSocketCoordinatorServer.broadcast,
  songRequestModule,
  midiModule,
  IS_TEST_MODE
);
webSocketCoordinatorServer.handlers.push(streamerbotWebSocketClient.messageHandler);

const discordModule = new DiscordModule(IS_TEST_MODE);
webSocketCoordinatorServer.handlers.push(discordModule.messageHandler);
