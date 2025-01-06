import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import reactVitePlugin from '@vitejs/plugin-react';
import { exchangeCode } from '@twurple/auth';
import { join } from 'path';
import { readdirSync, existsSync, unlinkSync } from 'fs';
import WebSocketCoordinatorServer from './WebSocketCoordinatorServer';
import StreamerbotWebSocketClient from './StreamerbotWebSocketClient';
// import LiveSplitWebSocketClient from './LiveSplitWebSocketClient';
import SongRequestHandler from './SongRequestHandler';
import MIDIIOController from './MIDIIOController';
import DiscordIntegration from './DiscordIntegration';
import TwitchIntegration from './TwitchIntegration';
import { db, initializeDatabase, populateDatabaseFromJSON } from './database';
import * as Paths from './paths';
import { SongData, SongRequestData } from '../../shared/messages';

process.on('unhandledRejection', (reason: any) => {
  console.error(reason?.message || reason);
});

const PORT = 3000;
const IS_TEST_MODE = process.env.TEST_MODE === '1';

const app = express();
app.use(bodyParser.json());
app.use(express.static(Paths.STATIC_ASSETS_PATH));
app.use('/downloads', cors(), express.static(Paths.DOWNLOADS_PATH));
app.use('/stems', cors(), express.static(Paths.STEMS_PATH));

const httpServer = app.listen(PORT, () => console.info('HTTP server listening on port', PORT));
const webSocketCoordinatorServer = new WebSocketCoordinatorServer(httpServer);

const midiController = new MIDIIOController(webSocketCoordinatorServer.broadcast);

const songRequestHandler = new SongRequestHandler(webSocketCoordinatorServer.broadcast);
webSocketCoordinatorServer.handlers.push(songRequestHandler.messageHandler);

const streamerbotWebSocketClient = new StreamerbotWebSocketClient(
  webSocketCoordinatorServer.broadcast,
  songRequestHandler,
  midiController,
  IS_TEST_MODE
);
webSocketCoordinatorServer.handlers.push(streamerbotWebSocketClient.messageHandler);

const discordIntegration = new DiscordIntegration(IS_TEST_MODE);
webSocketCoordinatorServer.handlers.push(discordIntegration.messageHandler);

const twitchIntegration = new TwitchIntegration();
twitchIntegration.beginUserAuth('http://localhost:3000/oauth');
webSocketCoordinatorServer.handlers.push(twitchIntegration.messageHandler);

// const liveSplitWebSocketClient = new LiveSplitWebSocketClient();
// webSocketCoordinatorServer.handlers.push(liveSplitWebSocketClient.messageHandler);

app.get('/clean', async () => {
  for (let file of readdirSync(Paths.DOWNLOADS_PATH)) {
    if (!existsSync(join(Paths.STEMS_PATH, file.replace(/\....$/, '')))) {
      console.info(`Found unprocessed download, deleting`, file);
      unlinkSync(join(Paths.DOWNLOADS_PATH, file));
    }
  }
});

// since everything is stored on local machine, convert these
// into routes served by the http server.
// probably temporary, until this data is stored In The Cloud
const convertLocalPathsToURLs = (songs: SongData[]) => songs.map((song) => ({
  ...song,
  stemsPath: `/stems/${encodeURIComponent(song.stemsPath.replace(Paths.STEMS_PATH, ''))}`,
  downloadPath: song.downloadPath ? `http://localhost:3000/downloads/${encodeURIComponent(song.downloadPath.replace(Paths.DOWNLOADS_PATH, ''))}` : undefined,
  lyricsPath: song.lyricsPath, // ? `/downloads/${song.lyricsPath.replace(Paths.DOWNLOADS_PATH, '')}` : undefined,
}));

app.get('/songs', cors(), async (req, res) => {
  const songs = await db.selectFrom('songs')
    .leftJoin('downloads', 'downloads.id', 'downloadId')
    .leftJoin('songRequests', 'songRequests.id', 'downloads.songRequestId')
    .select([
      'songs.id', 'songs.artist', 'songs.title', 'songs.album', 'songs.duration', 'songs.stemsPath', 'songs.createdAt',
      'downloads.path as downloadPath', 'downloads.isVideo', 'downloads.lyricsPath',
      'songRequests.requester', // 'songRequests.priority', 'songRequests.status', 'songRequests.id as songRequestId',
    ])
    .execute() satisfies SongData[];
  res.send(convertLocalPathsToURLs(songs));
});

app.get('/requests', async (req, res) => {
  const songs = await db.selectFrom('songRequests')
    .innerJoin('songs', 'songs.id', 'songRequests.songId')
    .innerJoin('downloads', 'downloads.id', 'songs.downloadId')
    .where('songRequests.status', '=', 'ready')
    .select([
      'songs.id', 'songs.artist', 'songs.title', 'songs.album', 'songs.duration', 'songs.stemsPath',
      'downloads.path as downloadPath', 'downloads.isVideo', 'downloads.lyricsPath',
      'songRequests.requester', 'songRequests.priority', 'songRequests.noShenanigans', 'songRequests.status', 'songRequests.id as songRequestId', 'songRequests.createdAt',
    ])
    .orderBy(['songRequests.priority desc', 'songRequests.order asc', 'songRequests.id asc'])
    .execute() satisfies SongRequestData[];
  res.send(convertLocalPathsToURLs(songs));
});

app.get('/test-twitch-chat-message', async (req, res) => {
  await streamerbotWebSocketClient.handleTwitchChatMessage({
    event: { source: 'Twitch', type: 'ChatMessage', },
    timeStamp: '000',
    data: {
      message: {
        userId: 'test',
        username: String(req.query.username) || 'test',
        displayName: String(req.query.username) || 'test',
        message: String(req.query.message) || 'test',
        internal: true,
        isTest: true,
        msgId: 'test',
        role: 4,
        color: '#000000',
        subscriber: true,
        channel: 'test',
        isMe: false,
        isHighlighted: false,
        isCustomReward: false,
        isReply: false,
        isAnonymous: false,
        bits: 0,
        firstMessage: false,
        hasBits: false,
        emotes: [],
        cheerEmotes: [],
        badges: [],
        monthsSubscribed: 0,
      },
    }
  })
  res.send('ok');
});

app.get('/test-twitch-chat-command', async (req, res) => {
  await streamerbotWebSocketClient.handleCommandTriggered({
    event: { source: 'Command', type: 'Triggered', },
    timeStamp: '000',
    data: {
      command: String(req.query.command),
      user: {
        display: String(req.query.username) || 'test',
        name: String(req.query.username) || 'test',
      },
      message: String(req.query.message) || 'test',
    }
  })
  res.send('ok');
});

app.get('/seed', async (req, res) => {
  await initializeDatabase();
  await populateDatabaseFromJSON();
  res.send('widePeepoHappy');
});

app.get('/reprocess', async (req, res) => {
  if (!req.query.id) {
    return res.status(400).send('need id query param');
  }
  console.info(`Reprocessing song with ID ${req.query.id}`);
  await songRequestHandler.reprocessSong(Number(req.query.id));
  console.info(`Done reprocessing song with ID ${req.query.id}`);
  res.status(200).send('OK');
});

app.get('/oauth', async (req, res) => {
  const tokenData = await exchangeCode(process.env.TWITCH_CLIENT_ID!, process.env.TWITCH_CLIENT_SECRET!, String(req.query.code), 'http://localhost:3000/oauth');
  await twitchIntegration.authorizeUser(tokenData);
  return res.send(`<script>window.close()</script>`);
})

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
