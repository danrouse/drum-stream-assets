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

interface DemucsSubscriber {
  name: string;
  callback: (success: boolean) => void;
}
let demucsSubscribers: DemucsSubscriber[] = [];
const demucs = new Demucs(DEMUCS_OUTPUT_PATH, DEFAULT_DEMUCS_MODEL);
demucs.onProcessingStart = (name) => broadcast({ type: 'demucs_start', name });
demucs.onProcessingProgress = (name, progress) => broadcast({ type: 'demucs_progress', progress, name });
demucs.onProcessingComplete = (name) => {
  broadcast({ type: 'demucs_complete', stems: `/stems/${name}` });
  demucsSubscribers.filter(s => s.name === name).forEach(s => s.callback(true));
  demucsSubscribers = demucsSubscribers.filter(s => s.name !== name);
};
demucs.onProcessingError = (name, errorMessage) => {
  broadcast({ type: 'demucs_error', message: errorMessage });
  demucsSubscribers.filter(s => s.name === name).forEach(s => s.callback(false));
  demucsSubscribers = demucsSubscribers.filter(s => s.name !== name);
};

function downloadSong(query: string) {
  console.info('Attempting to download:', query);
  broadcast({ type: 'download_start', query });
  const downloadedBasename = spotdl(query, DOWNLOADS_PATH, YOUTUBE_MUSIC_COOKIE_FILE);

  if (downloadedBasename) {
    broadcast({ type: 'download_complete', name: downloadedBasename });
    console.info('Downloaded:', downloadedBasename);
  } else {
    broadcast({ type: 'download_error', query });
    console.info('Received no basename from spotdl');
  }
  return downloadedBasename;
}

function processDownloadedSong(songFileBasename: string, callback?: (success: boolean) => void) {
  const downloadedSongPath = join(DOWNLOADS_PATH, `${songFileBasename}.m4a`);
  demucs.queue(downloadedSongPath);
  if (callback) {
    demucsSubscribers.push({ name: downloadedSongPath, callback });
  }
}

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
  // TODO: some way to toggle song requests on/off
  const q = req.body.q;
  if (!q) return res.status(400).send();
  const downloadedSongPath = downloadSong(q);
  // TODO: Enforce song length restrictions
  if (downloadedSongPath) {
    processDownloadedSong(downloadedSongPath, (success) => {
      if (success) {
        broadcast({ type: 'song_request_added', name: downloadedSongPath });
      }
      // TODO: any error handling to deal with here? to report back to requester somehow? :|
    });
    res.status(200).send();
  }
  return res.status(500).send();
});

app.post('/stem', async (req, res) => {
  const q = req.body.q;
  if (!q) return res.status(400).send();
  
  try {
    const downloadedSongPath = downloadSong(q);
    if (!downloadedSongPath) {
      return res.status(500).send({ message: 'Failed to download song.' });
    }
    processDownloadedSong(downloadedSongPath);
    return res.status(200).send({ name: downloadedSongPath });
  } catch (e) {
    return res.status(500).send({ message: 'Failed to download or process song.' });
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
