import express from 'express';
import bodyParser from 'body-parser';
import { createServer as createViteServer } from 'vite';
import reactVitePlugin from '@vitejs/plugin-react';
import { join } from 'path';
import { readdirSync, existsSync, unlinkSync } from 'fs';
import WebSocketCoordinatorServer from './WebSocketCoordinatorServer';
import StreamerbotWebSocketClient from './StreamerbotWebSocketClient';
import LiveSplitWebSocketClient from './LiveSplitWebSocketClient';
import SongRequestHandler from './SongRequestHandler';
import MIDIIOController from './MIDIIOController';
import { db, initializeDatabase, populateDatabaseFromJSON } from './database';
import * as Paths from './paths';
import { SongData, SongRequestData } from '../../shared/messages';

process.on('unhandledRejection', (reason: any) => {
  console.error(reason?.message || reason);
});

const PORT = 3000;

const app = express();
app.use(bodyParser.json());
app.use(express.static(Paths.STATIC_ASSETS_PATH));
app.use('/downloads', express.static(Paths.DOWNLOADS_PATH));
app.use('/stems', express.static(Paths.STEMS_PATH));

const httpServer = app.listen(PORT, () => console.log('HTTP server listening on port', PORT));
const webSocketCoordinatorServer = new WebSocketCoordinatorServer(httpServer);

const midiController = new MIDIIOController(webSocketCoordinatorServer.broadcast);

const songRequestHandler = new SongRequestHandler(webSocketCoordinatorServer.broadcast);
webSocketCoordinatorServer.handlers.push(async (payload) => {
  if (payload.type === 'song_request') {
    try {
      await songRequestHandler.execute(payload.query);
    } catch (e) {
      webSocketCoordinatorServer.broadcast({ type: 'download_error', query: payload.query });
    }
  }
});

const streamerbotWebSocketClient = new StreamerbotWebSocketClient(webSocketCoordinatorServer.broadcast, songRequestHandler, midiController);
webSocketCoordinatorServer.handlers.push(streamerbotWebSocketClient.messageHandler);

const liveSplitWebSocketClient = new LiveSplitWebSocketClient();
webSocketCoordinatorServer.handlers.push(liveSplitWebSocketClient.messageHandler);

app.get('/clean', async () => {
  for (let file of readdirSync(Paths.DOWNLOADS_PATH)) {
    if (!existsSync(join(Paths.STEMS_PATH, file.replace(/\....$/, '')))) {
      console.info(`Found unprocessed download, deleting`, file);
      unlinkSync(join(Paths.DOWNLOADS_PATH, file));
    }
  }
});

app.get('/songs', async (req, res) => {
  const songs = await db.selectFrom('songs')
    .leftJoin('downloads', 'downloads.id', 'downloadId')
    .leftJoin('songRequests', 'songRequests.id', 'downloads.songRequestId')
    .select([
      'songs.id', 'songs.artist', 'songs.title', 'songs.album', 'songs.duration', 'songs.stemsPath',
      'downloads.path as downloadPath', 'downloads.isVideo', 'downloads.lyricsPath',
      'songRequests.requester', 'songRequests.priority', 'songRequests.status', 'songRequests.id as songRequestId'
    ])
    .execute() satisfies SongData[];
  res.send(songs);
});

app.get('/requests', async (req, res) => {
  const requests = await db.selectFrom('songs')
    .innerJoin('downloads', 'downloads.id', 'downloadId')
    .innerJoin('songRequests', 'songRequests.id', 'downloads.songRequestId')
    .where('songRequests.status', '=', 'ready')
    .select([
      'songs.id', 'songs.artist', 'songs.title', 'songs.album', 'songs.duration', 'songs.stemsPath',
      'downloads.path as downloadPath', 'downloads.isVideo', 'downloads.lyricsPath',
      'songRequests.requester', 'songRequests.priority', 'songRequests.status', 'songRequests.id as songRequestId'
    ])
    .execute() satisfies SongRequestData[];
  res.send(requests);
});

app.get('/seed', async (req, res) => {
  await initializeDatabase();
  await populateDatabaseFromJSON();
  res.send('widePeepoHappy');
});

if (process.env.NODE_ENV === 'production') {
  app.use('/', express.static(Paths.PLAYER_DIST));
} else {
  const viteServer = await createViteServer({
    root: 'player',
    server: {
      middlewareMode: true,
      host: true,
    },
    clearScreen: false,
    plugins: [ reactVitePlugin() ],
  });
  app.use(viteServer.middlewares);
}
