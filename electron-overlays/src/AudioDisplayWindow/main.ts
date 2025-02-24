import WaveSurfer from 'wavesurfer.js';

let wavesurfer: WaveSurfer | null = null;

window.ipcRenderer.on('song_changed', (_, payload) => {
  wavesurfer?.destroy();
  wavesurfer = WaveSurfer.create({
    container: '#app',
    waveColor: '#ef5959',
    progressColor: 'rgba(225, 220, 193, 0.7)',
    hideScrollbar: true,
    minPxPerSec: 300,
    barHeight: 2.5,
    cursorWidth: 2,
    height: 'auto',
    url: `http://localhost:3000${payload.song.stemsPath}/drums.mp3`,
  });
  wavesurfer.setVolume(0);
});
window.ipcRenderer.on('song_progress', (_, payload) => {
  wavesurfer?.setTime(payload.timestamp);
});
window.ipcRenderer.on('song_stopped', () => {
  wavesurfer?.destroy();
  wavesurfer = null;
});
window.ipcRenderer.on('song_played', (_, payload) => {
  wavesurfer?.setTime(payload.timestamp);
  wavesurfer?.play();
});
window.ipcRenderer.on('song_playpack_paused', () => {
  wavesurfer?.pause();
});
window.ipcRenderer.on('song_speed', (_, payload) => {
  wavesurfer?.setPlaybackRate(payload.speed);
});
