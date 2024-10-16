import express from 'express';
import bodyParser from 'body-parser';
import { createServer as createViteServer } from 'vite';
import reactVitePlugin from '@vitejs/plugin-react';
import { join } from 'path';
import { readdirSync, existsSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import createWebSocketServer from './webSocketServer';
import createStreamerbotClient from './streamerbotClient';
import * as Paths from './paths';
import { setSongRequestWebSocketBroadcaster } from './songRequests';
import generateSongList from './songList';
import { handleLiveSplitMessage } from './liveSplit';

const PORT = 3000;

const app = express();
app.use(bodyParser.json());
app.use(express.static(Paths.STATIC_ASSETS_PATH));
app.use('/downloads', express.static(Paths.DOWNLOADS_PATH));
app.use('/stems', express.static(Paths.STEMS_PATH));

const httpServer = app.listen(PORT, () => console.log('HTTP server listening on port', PORT));
const { broadcast, handlers: wsHandlers } = createWebSocketServer(httpServer);
setSongRequestWebSocketBroadcaster(broadcast);
const streamerbotWsHandler = createStreamerbotClient(broadcast);
wsHandlers.push(streamerbotWsHandler);
wsHandlers.push(handleLiveSplitMessage);

app.get('/clean', async () => {
  for (let file of readdirSync(Paths.DOWNLOADS_PATH)) {
    if (!existsSync(join(Paths.STEMS_PATH, file.replace(/\....$/, '')))) {
      console.info(`Found unprocessed download, deleting`, file);
      unlinkSync(join(Paths.DOWNLOADS_PATH, file));
    }
  }
});

app.get('/songs', async (req, res) => {
  if (!existsSync(Paths.SONG_LIST_PATH)) {
    const data = await generateSongList();
    writeFileSync(Paths.SONG_LIST_PATH, JSON.stringify(data, null, 2));
    return res.send(data);
  }
  return res.send(readFileSync(Paths.SONG_LIST_PATH));
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
