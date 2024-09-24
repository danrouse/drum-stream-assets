import express from 'express';
import bodyParser from 'body-parser';
import { createServer as createViteServer } from 'vite';
import reactVitePlugin from '@vitejs/plugin-react';
import { join, dirname, } from 'path';
import { readdirSync, existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import spotdl from './wrappers/spotdl';
import Demucs, { DEFAULT_DEMUCS_MODEL } from './wrappers/demucs';
// import copyID3Tags from './copyID3Tags';
import { parseFile } from 'music-metadata';
import { createWebSocketServer } from './webSocketServer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const DOWNLOADS_PATH = join(__dirname, 'downloads');
const DEMUCS_OUTPUT_PATH = join(__dirname, 'separated');
const STEMS_PATH = join(DEMUCS_OUTPUT_PATH, DEFAULT_DEMUCS_MODEL);
const YOUTUBE_MUSIC_COOKIE_FILE = join(__dirname, '..', 'music.youtube.com_cookies.txt');
const STATIC_ASSETS_PATH = join(__dirname, '..', 'static');

const app = express();
app.use(bodyParser.json());
app.use(express.static(STATIC_ASSETS_PATH));
app.use('/downloads', express.static(DOWNLOADS_PATH));
app.use('/stems', express.static(STEMS_PATH));

const httpServer = app.listen(PORT, () => console.log('HTTP server listening on port', PORT));
const broadcast = createWebSocketServer(httpServer);

const demucs = new Demucs(DEMUCS_OUTPUT_PATH, DEFAULT_DEMUCS_MODEL);
demucs.onProcessingStart = (name) => broadcast({ type: 'demucs_start', name });
demucs.onProcessingProgress = (name, progress) => broadcast({ type: 'demucs_progress', progress, name });
demucs.onProcessingComplete = (name) => broadcast({ type: 'demucs_complete', stems: `/stems/${name}` });
demucs.onProcessingError = (name, errorMessage) => broadcast({ type: 'demucs_error', message: errorMessage });

app.get('/songs', async (req, res) => {
  const output: SongData[] = [];
  const stemmedSongs = readdirSync(STEMS_PATH).filter(s => statSync(join(STEMS_PATH, s)).isDirectory());
  for (let song of stemmedSongs) {
    const stems = readdirSync(join(STEMS_PATH, song));
    if (!stems.length) continue;
    const stat = statSync(join(STEMS_PATH, song, stems[0]));
    const tags = await parseFile(join(DOWNLOADS_PATH, `${song}.m4a`));
    output.push({
      name: song,
      artist: String(tags.common.artist),
      title: String(tags.common.title),
      stems: stems,
      downloadDate: stat.mtime,
      album: String(tags.common.album),
      track: [tags.common.track.no, tags.common.track.of],
      duration: tags.format.duration,
    });
  }
  res.send(output);
});

app.post('/songrequest', async (req, res) => {
  /**
   * TODO: songrequest endpoint
   * This is for the bot to request to, and adds in some extra checks
   * aside from anything directly in the /stem endpoint.
   * - Download and process any song that doesn't already exist
   *  - This might not be through spotify, so we need to be able to handle YouTube links
   * - Enforce song length restrictions
   * - Add the song to the queue somehow
   */
});

app.post('/stem', async (req, res) => {
  const q = req.body.q;
  if (!q)
    return res.status(500).send();

  console.info('Attempting to download:', q);
  broadcast({ type: 'download_start', query: q });
  try {
    const downloadedBasename = spotdl(q, DOWNLOADS_PATH, YOUTUBE_MUSIC_COOKIE_FILE);
    if (downloadedBasename) {
      broadcast({ type: 'download_complete', name: downloadedBasename });
      console.info('Downloaded:', downloadedBasename);

      // check to see that demucs hasn't already processed this song first
      if (existsSync(join(STEMS_PATH, downloadedBasename))) {
        broadcast({ type: 'demucs_complete', stems: `/stems/${downloadedBasename}` });
        return;
      }

      const downloadedSongPath = join(DOWNLOADS_PATH, `${downloadedBasename}.m4a`);
      demucs.queue(downloadedSongPath);
      res.status(200).send({ name: downloadedBasename });
    } else {
      res.status(500).send({ message: 'Failed to download song.' });
    }
  } catch (e) {
    console.log('got error');
    res.status(500).send({ message: 'Failed to download song.' });
    console.error(e);
  }
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
