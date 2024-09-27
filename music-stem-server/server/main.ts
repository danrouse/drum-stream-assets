import express from 'express';
import bodyParser from 'body-parser';
import { createServer as createViteServer } from 'vite';
import reactVitePlugin from '@vitejs/plugin-react';
import { join, dirname, basename } from 'path';
import { readdirSync, existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import ffprobe, { FFProbeResult } from 'ffprobe';
import ffprobeStatic from 'ffprobe-static';
import spotdl, { SongDownloadError, MAX_SONG_REQUEST_DURATION } from './wrappers/spotdl';
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
let i = 0;
const sendTwitchMessage = (message: string, reply?: string) => {
  console.log('STM', ++i, message);
  broadcast({ type: 'send_twitch_message', message, reply });
};
createStreamerbotClient(sendTwitchMessage, handleSongRequest);

interface DemucsSubscriber {
  song: DownloadedSong;
  callback: (song?: ProcessedSong) => void;
}
let demucsSubscribers: DemucsSubscriber[] = [];
const demucs = new Demucs(DEMUCS_OUTPUT_PATH, DEFAULT_DEMUCS_MODEL);
demucs.onProcessingStart = (song) => broadcast({ type: 'demucs_start', name: song.basename });
demucs.onProcessingProgress = (song, progress) => broadcast({ type: 'demucs_progress', progress, name: song.basename });
demucs.onProcessingComplete = (song) => {
  broadcast({ type: 'demucs_complete', stems: `/stems/${song.basename}` });
  demucsSubscribers.filter(s => s.song.basename === song.basename).forEach(s => s.callback(song));
  demucsSubscribers = demucsSubscribers.filter(s => s.song.basename !== song.basename);
};
demucs.onProcessingError = (song, errorMessage) => {
  broadcast({ type: 'demucs_error', message: errorMessage });
  demucsSubscribers.filter(s => s.song.basename === song.basename).forEach(s => s.callback());
  demucsSubscribers = demucsSubscribers.filter(s => s.song.basename !== song.basename);
};

async function downloadSong(query: string) {
  console.info('Attempting to download:', query);
  broadcast({ type: 'download_start', query });
  const downloadedSong = await spotdl(query, DOWNLOADS_PATH, YOUTUBE_MUSIC_COOKIE_FILE);

  if (downloadedSong) {
    broadcast({ type: 'download_complete', name: downloadedSong.basename });
    console.info('Downloaded:', downloadedSong.basename);
  } else {
    broadcast({ type: 'download_error', query });
    console.info('Received no basename from spotdl');
  }
  return downloadedSong;
}

function handleSongRequest(query: string) {
  return new Promise<ProcessedSong>(async (resolve, reject) => {
    try {
      const downloadedSong = await downloadSong(query);
      const tags = await getSongTags(downloadedSong.path, true);
      if (tags.format?.duration > MAX_SONG_REQUEST_DURATION) {
        reject(new SongDownloadError('TOO_LONG'));
      }
      if (downloadedSong) {
        processDownloadedSong(downloadedSong, (processedSong) => {
          if (processedSong) {
            console.info(`Song request added from request "${downloadedSong.basename}", broadcasting message...`);
            broadcast({ type: 'song_request_added', name: downloadedSong.basename });
            resolve(processedSong);
          } else {
            reject();
          }
        });
      } else {
        reject();
      }
    } catch (e) {
      reject(e);
    }
  });
}

function processDownloadedSong(song: DownloadedSong, callback?: (song?: ProcessedSong) => void) {
  demucs.queue(song);
  if (callback) {
    demucsSubscribers.push({ song, callback });
  }
}

async function getSongTags(songBasename: string, isPath: boolean = false) {
  let tags: any = {};
  try {
    const songPath = isPath ? songBasename : join(DOWNLOADS_PATH, `${songBasename}.m4a`);
    tags = await parseFile(songPath);
  } catch (e) {
    const possibleExtensions = ['mkv', 'mp4', 'ogg', 'webm', 'flv'];
    const songPath = isPath ? songBasename :
      possibleExtensions.map((ext) => join(DOWNLOADS_PATH, `${songBasename}.${ext}`))
        .find((path) => existsSync(path));
    if (!songPath) return tags;
    const res = await ffprobe(songPath, { path: ffprobeStatic.path });

    let duration = 0;
    if (res.streams[0].duration) {
      duration = Number(res.streams[0].duration)
    } else if (res.streams[0].tags.DURATION) {
      duration = res.streams[0].tags.DURATION.split(':').reduce((a,t)=> (60 * a) + +t, 0);
    }
    const partsMatch = songBasename.match(/([^-]+) - (.+)$/);
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
  }
  return tags;
}

app.get('/songs', async (req, res) => {
  const output: SongData[] = [];
  const stemmedSongs = readdirSync(STEMS_PATH).filter(s => statSync(join(STEMS_PATH, s)).isDirectory());
  for (let songBasename of stemmedSongs) {
    const stems = readdirSync(join(STEMS_PATH, songBasename));
    if (!stems.length) continue;
    const stat = statSync(join(STEMS_PATH, songBasename, stems[0]));
    const tags = await getSongTags(songBasename);
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

// TODO: do this over WS instead
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
