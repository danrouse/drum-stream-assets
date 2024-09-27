import { app, BrowserWindow, BrowserWindowConstructorOptions, ipcMain } from 'electron';
import { WebSocket } from 'ws';
import { join, dirname } from 'path';
import { fileURLToPath, URL } from 'url';
import { readFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PORT = readFileSync(join(__dirname, '..', '..', 'SERVER_PORT'), 'utf-8');
const SERVER_URL = new URL(process.env.VITE_DEV_SERVER_URL!);
SERVER_URL.port = SERVER_PORT;

const defaultWindowConfig: Partial<BrowserWindowConstructorOptions> = {
  transparent: true,
  frame: false,
  webPreferences: {
    preload: join(__dirname, 'preload.mjs'),
    backgroundThrottling: false,
  },
};

function createMIDINotesWindow() {
  const win = new BrowserWindow({
    ...defaultWindowConfig,
    title: 'MIDI Notes',
    width: 1920,
    height: 1080,
  });
  let isMouseEventsIgnored = true;
  win.setIgnoreMouseEvents(isMouseEventsIgnored);
  win.loadURL(process.env.VITE_DEV_SERVER_URL! + '#MIDINotesWindow');
  ipcMain.on('toggle_mouse', () => {
    isMouseEventsIgnored = !isMouseEventsIgnored;
    win.setIgnoreMouseEvents(isMouseEventsIgnored);
  });

  return win;
}

function createNowPlayingWindow() {
  const win = new BrowserWindow({
    ...defaultWindowConfig,
    title: 'Now Playing',
    width: 1920,
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

let prevSongChangedPayload: any;

function findLyrics(artist: string, title: string, duration: number) {
  const lyricsPath = join(__dirname, '../../music-stem-server/server/downloads',
    `${artist} - ${title}.lrc`);
  if (existsSync(lyricsPath)) {
    return parseLyrics(lyricsPath, duration);
  }
}

function findVideo(artist: string, title: string) {
  const possibleExtensions = ['mkv', 'mp4', 'ogg', 'webm', 'flv'];
  for (let ext of possibleExtensions) {
    const videoBaseName = `${artist} - ${title}.${ext}`;
    const videoPath = join(__dirname, '../../music-stem-server/server/downloads', videoBaseName);
    if (existsSync(videoPath)) {
      return `${SERVER_URL}/downloads/${videoBaseName}`;
    }
  }
}

function createWebSocket(windows: BrowserWindow[]) {
  // Connect to server WS to receive rebroadcast messages from remote client
  // Send all messages via IPC to individual windows
  const ws = new WebSocket(`ws://${SERVER_URL.host}`);
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (!message) {
      console.error('Error parsing received WebSocket message:', data.toString());
      return;
    }
    if (message.type === 'song_changed') {
      message.lyrics = findLyrics(message.artist, message.title, message.duration);
      message.videoPath = findVideo(message.artist, message.title);
      const { type: _, ...payload } = message;
      prevSongChangedPayload = payload;
    }
    const { type, ...payload } = message;
    windows.forEach(win => win.webContents.send(type, payload));
  });
  ws.on('close', () => setTimeout(() => createWebSocket(windows), 1000));
  return ws;
}

function createWindows() {
  const windows = [
    createMIDINotesWindow(),
    createNowPlayingWindow(),
    createSyncedLyricsWindow(),
  ];
  createWebSocket(windows);
}

const parseLRCTimeToFloat = (lrcTime: string) => {
  const timeParts = lrcTime.split(':');
  const mins = parseInt(timeParts[0], 10);
  const secs = parseFloat(timeParts[1]);
  return (mins * 60) + secs;
};

const parseLyrics = (lyricsPath: string, mediaDuration: number = 0) => {
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

app.on('window-all-closed', () => app.quit());
app.on('activate', () => BrowserWindow.getAllWindows().length || createWindows());
app.whenReady().then(createWindows);
