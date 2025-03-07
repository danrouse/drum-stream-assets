import { SongData } from '../../../shared/messages';

// (async () => {
const globalContainerElem = document.body.querySelector<HTMLDivElement>('#app')!;
globalContainerElem.innerHTML = `
  <div class="SyncedLyrics">
    <ul class="lines" id="SyncedLyricsLines">
    </ul>
    <video id="SyncedLyricsVideo" muted />
  </div>
`;
const linesElem = document.getElementById('SyncedLyricsLines')!;
const videoElem = document.getElementById('SyncedLyricsVideo')! as HTMLVideoElement;

const NUM_LYRIC_LINES = 5;
const lyricLinesElems: HTMLElement[] = [];
for (let i = 0; i < NUM_LYRIC_LINES; i++) {
  const lineElem = document.createElement('li');
  linesElem.append(lineElem);
  lyricLinesElems.push(lineElem);
}

let lyrics: LyricLine[] = [];
function renderLyrics(timestamp: number = 0) {
  if (!lyrics.length) {
    linesElem.style.display = 'none';
  } else {
    linesElem.style.display = 'block';
  }
  lyricLinesElems.forEach(elem => elem.innerHTML = '');

  const firstIndexAfterTimestamp = lyrics.findIndex(line => line.timestamp >= timestamp);
  if (firstIndexAfterTimestamp === -1) return;
  // check if we're still on previous line
  const startIndex = Math.max(firstIndexAfterTimestamp - 1, 0);
  const nextLines = lyrics.slice(startIndex, startIndex + NUM_LYRIC_LINES);
  nextLines.forEach((line, i) => {
    lyricLinesElems[i].innerText = line.text;
  });
}

let isPlaying = false;
let currentTimestamp = 0;
let lastFrameTime = 0;
let hasVideo = false;
let playbackRate = 1.0;
const handleFrame = (ts: number) => {
  const dt = ts - lastFrameTime;
  lastFrameTime = ts;

  if (isPlaying) {
    // increase the song's timestamp on a frame by frame basis,
    // which will get resynced when receiving the next song_progress
    // event from the client
    // this should give smoother intervals instead of only updating
    // from websocket event receipts
    currentTimestamp += (dt / 1000) * playbackRate;
  }

  renderLyrics(currentTimestamp);
  requestAnimationFrame(handleFrame);
};
requestAnimationFrame(handleFrame);

window.ipcRenderer.send('initialize');
window.ipcRenderer.on('song_changed', (_, payload: { song: SongData, lyrics: LyricLine[] }) => {
  lyrics = payload.lyrics || [];
  if (payload.song.isVideo) {
    videoElem.src = payload.song.downloadPath!;
    hasVideo = true;
  } else {
    videoElem.src = '';
    hasVideo = false;
  }
  currentTimestamp = 0;
  isPlaying = false;
  renderLyrics();
});
window.ipcRenderer.on('song_progress', (_, payload) => {
  if (hasVideo && Math.abs(videoElem.currentTime - payload.timestamp) > (1 * playbackRate)) {
    videoElem.currentTime = payload.timestamp;
  }
  currentTimestamp = payload.timestamp;
});
window.ipcRenderer.on('song_stopped', () => {
  lyrics = [];
  isPlaying = false;
  videoElem.src = '';
  hasVideo = false;
  renderLyrics();
});
window.ipcRenderer.on('song_played', (_, payload) => {
  currentTimestamp = payload.timestamp;
  if (hasVideo) videoElem.play();
  isPlaying = true;
});
window.ipcRenderer.on('song_playpack_paused', () => {
  if (hasVideo) videoElem.pause();
  isPlaying = false;
});
window.ipcRenderer.on('song_speed', (_, payload) => {
  playbackRate = payload.speed;
  videoElem.playbackRate = playbackRate;
});
window.onerror = (error, url, line) => window.ipcRenderer.send('error', { error, url, line });
// })();
