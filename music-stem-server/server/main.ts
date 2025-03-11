import 'dotenv/config';
import createHttpServer from './http';
import WebSocketCoordinatorServer from './WebSocketCoordinatorServer';
import StreamerbotWebSocketClient from './StreamerbotWebSocketClient';
import MIDIModule from './features/MIDIModule';
import DiscordModule from './features/DiscordModule';
import SongRequestModule from './features/streamerbot/SongRequestModule';
import ShenanigansModule from './features/streamerbot/ShenanigansModule';
import OBSModule from './features/streamerbot/OBSModule';
import SongVotingModule from './features/streamerbot/SongVotingModule';
import EmotesModule from './features/streamerbot/EmotesModule';
import NameThatTuneModule from './features/streamerbot/NameThatTuneModule';
import { createLogger } from '../../shared/util';

const log = createLogger('Main');

process.on('unhandledRejection', (reason: any) => {
  log('unhandledRejection', reason?.message, reason);
});

const IS_TEST_MODE = process.env.TEST_MODE === '1';
log('Starting with test mode =', IS_TEST_MODE);

const httpServer = createHttpServer(Number(process.env.PORT) || 3000);
const webSocketCoordinatorServer = new WebSocketCoordinatorServer(httpServer);

const midiModule = new MIDIModule(webSocketCoordinatorServer);

const streamerbotWebSocketClient = new StreamerbotWebSocketClient(
  webSocketCoordinatorServer,
  IS_TEST_MODE
);

const songRequestModule = new SongRequestModule(
  streamerbotWebSocketClient,
  webSocketCoordinatorServer
);

const shenanigansModule = new ShenanigansModule(
  streamerbotWebSocketClient,
  webSocketCoordinatorServer,
  midiModule
);

const obsModule = new OBSModule(
  streamerbotWebSocketClient,
  webSocketCoordinatorServer
);

const songVotingModule = new SongVotingModule(
  streamerbotWebSocketClient,
  webSocketCoordinatorServer
);

const emotesModule = new EmotesModule(
  streamerbotWebSocketClient,
  webSocketCoordinatorServer
);

const nameThatTuneModule = new NameThatTuneModule(
  streamerbotWebSocketClient,
  webSocketCoordinatorServer
);
