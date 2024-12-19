import { app, BrowserWindow, BrowserWindowConstructorOptions, ipcMain } from 'electron';
import { WebSocket } from 'ws';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { WebSocketPlayerMessage } from '../../shared/messages';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OBS_OVERLAY_MASK_PATH = join(__dirname, '..', 'masks');

const defaultWindowConfig: Partial<BrowserWindowConstructorOptions> = {
  transparent: true,
  frame: false,
  webPreferences: {
    preload: join(__dirname, 'preload.mjs'),
    backgroundThrottling: false,
  },
};

function createMIDINotesWindow(key: string) {
  const win = new BrowserWindow({
    ...defaultWindowConfig,
    title: ['MIDI Notes', key].join(' '),
    width: 1920,
    height: 1080,
  });
  win.setIgnoreMouseEvents(true);
  win.loadURL(`${process.env.VITE_DEV_SERVER_URL!}#MIDINotesWindow,key=${key}`);
  ipcMain.on('enable_mouse', () => win.setIgnoreMouseEvents(false));
  ipcMain.on('disable_mouse', () => win.setIgnoreMouseEvents(true));
  ipcMain.on(`generate_mask_${key}`, async (_, i) => {
    if (i !== -1) {
      const image = await win.capturePage();
      writeFileSync(join(OBS_OVERLAY_MASK_PATH, `mask-${key}-${i}.png`), image.toPNG());
    }
    win.webContents.send(`generate_mask_complete_${key}`, i);
  });
  ipcMain.on(`generate_mask_finalize_${key}`, () => {
    execSync(`magick mogrify -transparent white masks/mask-${key}-*.png`);
  });

  return win;
}

function createNowPlayingWindow() {
  const win = new BrowserWindow({
    ...defaultWindowConfig,
    title: 'Now Playing',
    width: 1640,
    height: 128,
  });
  win.setIgnoreMouseEvents(true);
  win.loadURL(process.env.VITE_DEV_SERVER_URL! + '#NowPlayingWindow');

  return win;
}

function createSyncedLyricsWindow() {
  const win = new BrowserWindow({
    ...defaultWindowConfig,
    title: 'Synced Lyrics',
    width: 640,
    height: 400,
  });
  win.setIgnoreMouseEvents(true);
  win.loadURL(process.env.VITE_DEV_SERVER_URL! + '#SyncedLyricsWindow');

  return win;
}

function createDrumTriggersWindow() {
  const win = new BrowserWindow({
    ...defaultWindowConfig,
    title: 'Drum Triggers',
    width: 128,
    height: 128,
  });
  win.setIgnoreMouseEvents(true);
  win.loadURL(process.env.VITE_DEV_SERVER_URL! + '#DrumTriggersWindow');
  ipcMain.on('get_samples', ({ reply }) => {
    const samples = readdirSync(join(__dirname, '..', 'samples'));
    reply('get_samples', samples);
  });

  return win;
}


function createSongHistoryWindow() {
  const win = new BrowserWindow({
    ...defaultWindowConfig,
    title: 'Song History',
    width: 400,
    height: 270,
  });
  win.setIgnoreMouseEvents(true);
  win.loadURL(process.env.VITE_DEV_SERVER_URL! + '#SongHistoryWindow');

  return win;
}

function createGuessTheSongWindow() {
  const win = new BrowserWindow({
    ...defaultWindowConfig,
    title: 'Guess The Song',
    width: 1920,
    height: 1080,
  });
  win.setIgnoreMouseEvents(true);
  win.loadURL(process.env.VITE_DEV_SERVER_URL! + '#GuessTheSongWindow');
  ipcMain.on('guess_the_song_round_complete', (event, winner, time, otherWinners) => {
    ws.send(JSON.stringify({ type: 'guess_the_song_round_complete', winner, time, otherWinners }));
  });

  return win;
}

let prevSongChangedPayload: any;

let windows: BrowserWindow[] = [];
// Connect to server WS to receive rebroadcast messages from remote client
// Send all messages via IPC to individual windows
const createWebSocket = () => {
  const ws = new WebSocket('http://127.0.0.1:3000');
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString()) as WebSocketPlayerMessage;
    if (!message) {
      console.error('Error parsing received WebSocket message:', data.toString());
      return;
    }
    
    let { type, ...payload } = message;

    // Load lyrics from filesystem and add to song_changed payloads
    // (renderer processes cannot access filesystem like this)
    if (message.type === 'song_changed') {
      payload = {
        ...payload,
        lyrics: message.song.lyricsPath ? parseLyrics(message.song.lyricsPath, message.song.duration) : null,
      };
      prevSongChangedPayload = payload;
    }
    
    windows.forEach(win => win.webContents.send(type, payload));
  });
  ws.on('error', () => {});
  return ws;
};
let ws: WebSocket = createWebSocket();
// Continuously check WS connection and attempt a reconnection if it is closed
setInterval(() => {
  if (!ws || (ws.readyState !== ws.CONNECTING && ws.readyState !== ws.OPEN)) {
    try {
      ws = createWebSocket();
    } catch (e) {}
  }
}, 1000);

function createWindows() {
  windows = [
    createMIDINotesWindow('noteconfig3'),
    createMIDINotesWindow('Ride'),
    createNowPlayingWindow(),
    createSyncedLyricsWindow(),
    createDrumTriggersWindow(),
    createSongHistoryWindow(),
    createGuessTheSongWindow(),
  ];
}

const parseLRCTimeToFloat = (lrcTime: string) => {
  const timeParts = lrcTime.split(':');
  const mins = parseInt(timeParts[0], 10);
  const secs = parseFloat(timeParts[1]);
  return (mins * 60) + secs;
};

const parseLyrics = (lyricsPath: string, mediaDuration: number = 0) => {
  if (!existsSync(lyricsPath)) return null;
  const rawLyrics = readFileSync(lyricsPath).toString('utf8').split('\n');
  const lyrics: LyricLine[] = [
    // pad start with an empty line before the first real line happens
    // so that we don't start directly on the first line during intros
    { timestamp: 0, text: '' }
  ];
  let offset = 0;
  for (let line of rawLyrics) {
    const lengthMatch = line.match(/^\[length: (\d*\:\d*\.?\d*)\]/);
    if (lengthMatch) {
      const lrcDuration = parseLRCTimeToFloat(lengthMatch[1]);
      offset = lrcDuration - mediaDuration;
      continue;
    }

    const lineParts = line.match(/^\[(\d*\:\d*\.?\d*)\](.+)/);
    if (lineParts) {
      lyrics.push({
        timestamp: parseLRCTimeToFloat(lineParts[1]) - offset,
        text: lineParts[2].trim()
      });
    }
  }
  return lyrics;
};

ipcMain.on('initialize', (event) => prevSongChangedPayload && event.reply('song_changed', prevSongChangedPayload));
ipcMain.on('error', (event) => console.error(event));
process.on('uncaughtException', (err) => console.error(err));
process.on('unhandledRejection', (reason, promise) => console.error(reason, promise));

app.on('window-all-closed', () => app.quit());
app.on('activate', () => BrowserWindow.getAllWindows().length || createWindows());
app.whenReady().then(createWindows);
