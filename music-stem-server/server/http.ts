/**
 * HTTP (express) server
 * The frontend client is served here, either using Vite in dev,
 * or by building and serving the static built assets in prod.
 * There are also a few JSON data endpoints used by the client.
 */
import { join } from 'path';
import { readdirSync, existsSync, unlinkSync } from 'fs';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import reactVitePlugin from '@vitejs/plugin-react';

import * as Queries from './queries';
import * as Paths from '../../shared/paths';
import { SongData } from '../../shared/messages';
import { createLogger } from '../../shared/util';

const log = createLogger('HTTP');

const app = express();
app.use(bodyParser.json());
app.use(express.static(Paths.STATIC_ASSETS_PATH));
app.use('/downloads', cors(), express.static(Paths.DOWNLOADS_PATH));
app.use('/stems', cors(), express.static(Paths.STEMS_PATH));

// since everything is stored on local machine, convert these
// into routes served by the http server.
// probably temporary, until this data is stored In The Cloud
const convertLocalPathsToURLs = (songs: SongData[]) => songs.map((song) => ({
  ...song,
  stemsPath: `/stems/${encodeURIComponent(song.stemsPath)}`,
  downloadPath: song.downloadPath ? `http://localhost:3000/downloads/${encodeURIComponent(song.downloadPath)}` : undefined,
  lyricsPath: song.lyricsPath,
}));

app.get('/songs', cors(), async (req, res) => {
  const songs = await Queries.allSongs();
  res.send(convertLocalPathsToURLs(songs));
});

app.get('/requests', async (req, res) => {
  const songs = await Queries.allSongRequests();
  res.send(convertLocalPathsToURLs(songs));
});

app.get('/clean', async () => {
  for (let file of readdirSync(Paths.DOWNLOADS_PATH)) {
    if (!existsSync(join(Paths.STEMS_PATH, file.replace(/\....$/, '')))) {
      log(`Found unprocessed download, deleting`, file);
      unlinkSync(join(Paths.DOWNLOADS_PATH, file));
    }
  }
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

export default function createHttpServer(port: number) {
  return app.listen(port, () => log('HTTP server listening on port', port));
}
