import express from 'express';
import bodyParser from 'body-parser';
import { createServer as createViteServer } from 'vite';
import reactVitePlugin from '@vitejs/plugin-react';
import { join } from 'path';
import { readdirSync, existsSync, statSync, unlinkSync } from 'fs';
import createWebSocketServer from './webSocketServer';
import createStreamerbotClient from './streamerbotClient';
import getSongTags from './getSongTags';
import * as Paths from './paths';
import { setSongRequestWebSocketBroadcaster } from './songRequests';

const PORT = 3000;

const app = express();
app.use(bodyParser.json());
app.use(express.static(Paths.STATIC_ASSETS_PATH));
app.use('/downloads', express.static(Paths.DOWNLOADS_PATH));
app.use('/stems', express.static(Paths.STEMS_PATH));

const httpServer = app.listen(PORT, () => console.log('HTTP server listening on port', PORT));
const broadcast = createWebSocketServer(httpServer);
setSongRequestWebSocketBroadcaster(broadcast);
createStreamerbotClient();

app.get('/clean', async () => {
  for (let file of readdirSync(Paths.DOWNLOADS_PATH)) {
    if (!existsSync(join(Paths.STEMS_PATH, file.replace(/\....$/, '')))) {
      console.info(`Found unprocessed download, deleting`, file);
      unlinkSync(join(Paths.DOWNLOADS_PATH, file));
    }
  }
});

app.get('/songs', async (req, res) => {
  const output: SongData[] = [];
  const stemmedSongs = readdirSync(Paths.STEMS_PATH)
    .filter(s => statSync(join(Paths.STEMS_PATH, s)).isDirectory());
  for (let songBasename of stemmedSongs) {
    const stems = readdirSync(join(Paths.STEMS_PATH, songBasename));
    if (!stems.length) continue;
    const stat = statSync(join(Paths.STEMS_PATH, songBasename, stems[0]));
    const tags = await getSongTags(songBasename, false, Paths.DOWNLOADS_PATH);
    output.push({
      name: songBasename,
      artist: String(tags.common?.artist) || '',
      title: String(tags.common?.title) || '',
      stems: stems,
      downloadDate: stat.mtime,
      album: String(tags.common?.album) || '',
      track: [tags.common?.track.no || 1, tags.common?.track.of || 1],
      duration: tags.format?.duration,
    });
  }
  res.send(output);
});

// connect Vite once all of our own routes are defined
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
