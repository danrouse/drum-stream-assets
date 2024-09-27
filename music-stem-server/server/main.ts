import express from 'express';
import bodyParser from 'body-parser';
import { createServer as createViteServer } from 'vite';
import reactVitePlugin from '@vitejs/plugin-react';
import { join, dirname, basename } from 'path';
import { readdirSync, existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import ffprobe from 'ffprobe';
import ffprobeStatic from 'ffprobe-static';
import spotdl from './wrappers/spotdl';
import Demucs, { DEFAULT_DEMUCS_MODEL } from './wrappers/demucs';
import createWebSocketServer from './webSocketServer';
import createStreamerbotClient from './streamerbotClient';
// @ts-expect-error
import { parseFile } from 'music-metadata';

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
const sendTwitchMessage = (message: string) => broadcast({ type: 'send_twitch_message', message });
const streamerbotClient = createStreamerbotClient(sendTwitchMessage, handleSongRequest);

interface DemucsSubscriber {
  name: string;
  callback: (success: boolean) => void;
}
let demucsSubscribers: DemucsSubscriber[] = [];
const demucs = new Demucs(DEMUCS_OUTPUT_PATH, DEFAULT_DEMUCS_MODEL);
demucs.onProcessingStart = (name) => broadcast({ type: 'demucs_start', name });
demucs.onProcessingProgress = (name, progress) => broadcast({ type: 'demucs_progress', progress, name });
demucs.onProcessingComplete = (name) => {
  const strippedName = name.replace(/\.(m4a|mkv|mp4|ogg|webm|flv)$/i, '');
  broadcast({ type: 'demucs_complete', stems: `/stems/${strippedName}` });
  demucsSubscribers.filter(s => s.name === strippedName).forEach(s => s.callback(true));
  demucsSubscribers = demucsSubscribers.filter(s => s.name !== strippedName);
};
demucs.onProcessingError = (name, errorMessage) => {
  broadcast({ type: 'demucs_error', message: errorMessage });
  demucsSubscribers.filter(s => s.name === name).forEach(s => s.callback(false));
  demucsSubscribers = demucsSubscribers.filter(s => s.name !== name);
};

async function downloadSong(query: string) {
  console.info('Attempting to download:', query);
  broadcast({ type: 'download_start', query });
  const downloadedBasename = await spotdl(query, DOWNLOADS_PATH, YOUTUBE_MUSIC_COOKIE_FILE);

  if (downloadedBasename) {
    broadcast({ type: 'download_complete', name: downloadedBasename });
    console.info('Downloaded:', downloadedBasename);
  } else {
    broadcast({ type: 'download_error', query });
    console.info('Received no basename from spotdl');
  }
  return downloadedBasename;
}

function handleSongRequest(query: string) {
  return new Promise<string>(async (resolve, reject) => {
    try {
      const downloadedSongPath = await downloadSong(query);
      // TODO: Enforce song length restrictions
      if (downloadedSongPath) {
        processDownloadedSong(downloadedSongPath, (success) => {
          if (success) {
            console.info(`Song request added from request "${downloadedSongPath}", broadcasting message...`);
            broadcast({ type: 'song_request_added', name: downloadedSongPath.replace(/\.(m4a|mkv|mp4|ogg|webm|flv)$/i, '') });
            resolve(downloadedSongPath);
          } else {
            reject();
          }
        });
      } else {
        reject();
      }
    } catch (e) {
      reject();
    }
  });
}

function processDownloadedSong(songFileBasename: string, callback?: (success: boolean) => void) {
  let downloadedSongPath = join(DOWNLOADS_PATH, songFileBasename);
  if (!existsSync(downloadedSongPath)) {
    downloadedSongPath = join(DOWNLOADS_PATH, `${songFileBasename}.m4a`);
    if (!existsSync(downloadedSongPath)) {
      throw new Error(`Could not find path for ${songFileBasename}`);
    }
  }
  demucs.queue(downloadedSongPath);
  if (callback) {
    demucsSubscribers.push({
      name: basename(downloadedSongPath).replace(/\.(m4a|mkv|mp4|ogg|webm|flv)$/i, ''),
      callback
    });
  }
}

app.get('/songs', async (req, res) => {
  const output: SongData[] = [];
  const stemmedSongs = readdirSync(STEMS_PATH).filter(s => statSync(join(STEMS_PATH, s)).isDirectory());
  for (let song of stemmedSongs) {
    const stems = readdirSync(join(STEMS_PATH, song));
    if (!stems.length) continue;
    const stat = statSync(join(STEMS_PATH, song, stems[0]));
    let tags: any = {};
    try {
      tags = await parseFile(join(DOWNLOADS_PATH, `${song}.m4a`));
    } catch (e) {
      const possibleExtensions = ['mkv', 'mp4', 'ogg', 'webm', 'flv'];
      for (let ext of possibleExtensions) {
        if (!existsSync(join(DOWNLOADS_PATH, `${song}.${ext}`))) {
          continue;
        }
        const res = await ffprobe(join(DOWNLOADS_PATH, `${song}.${ext}`), { path: ffprobeStatic.path });
        const duration = res.streams[0].tags.DURATION?.split(':').reduce((a,t)=> (60 * a) + +t, 0);
        const partsMatch = song.match(/([^-]+) - (.+)$/);
        tags = {
          common: {
            artist: partsMatch?.[1],
            title: partsMatch?.[2],
            album: 'YouTube',
            // album: `YouTube - ${partsMatch?.[3]}`,
            track: { no: 1, of: 1 },
          },
          format: { duration },
        };
        break;
      }
    }
    output.push({
      name: song,
      artist: String(tags.common?.artist) || '',
      title: String(tags.common?.title) || '',
      stems: stems,
      downloadDate: stat.mtime,
      album: String(tags.common?.album) || '',
      track: [tags.common?.track.no || 1, tags.common?.track.of || 1],
      duration: tags.format.duration,
    });
  }
  res.send(output);
});

app.post('/songrequest', async (req, res) => {
  const q = req.body.q;
  if (!q) return res.status(400).send();
  try {
    await handleSongRequest(q);
    res.status(200).send();
  } catch (err) {
    console.error('Error thrown while downloading song request', err);
  }
  // TODO: Message back to the requester that there was an error?
  console.log(`Message back to requester that there was an error downloading "${q}"!`);
  return res.status(500).send();
});

app.post('/stem', async (req, res) => {
  const q = req.body.q;
  if (!q) return res.status(400).send();
  
  try {
    const downloadedSongPath = await downloadSong(q);
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
