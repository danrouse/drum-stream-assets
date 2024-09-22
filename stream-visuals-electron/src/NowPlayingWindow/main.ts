if (location.hash === '#NowPlayingWindow') {
  import('./style.css');

  const globalContainerElem = document.body.querySelector<HTMLDivElement>('#app')!;
  globalContainerElem.innerHTML = `
    <div class="NowPlaying" id="NowPlayingContainer">
      <div class="top">
        <div class="left">
          <p class="artist" id="NowPlayingArtist"></p>
          <p class="title" id="NowPlayingTitle"></p>
        </div>
        <div class="right">
          <p class="time" id="NowPlayingTime"></p>
        </div>
      </div>
      <div class="bar">
        <div class="inner" id="NowPlayingProgressBar"></div>
      </div>
    </div>
  `;
  const containerElem = document.getElementById('NowPlayingContainer')!;
  const artistElem = document.getElementById('NowPlayingArtist')!;
  const titleElem = document.getElementById('NowPlayingTitle')!;
  const timeElem = document.getElementById('NowPlayingTime')!;
  const progressBarElem = document.getElementById('NowPlayingProgressBar')!;

  let artist = '';
  let title = '';
  let duration = 0;
  let isPlaying = false;
  let currentTimestamp = 0;

  function render() {
    if (!duration) {
      containerElem.style.display = 'none';
    } else {
      containerElem.style.display = 'block';
    }
    artistElem.innerHTML = artist + '&nbsp;';
    titleElem.innerHTML = title + '&nbsp;';
    // timeElem.innerHTML = `-${formatTime(duration - currentTimestamp)}`;
    timeElem.innerHTML = formatTime(currentTimestamp);
    
    const barWidth = duration ? 100 - (100 * currentTimestamp / duration) : 100;
    progressBarElem.style.width = `${barWidth}%`;
  }

  const formatTime = (secs?: number) => {
    if (!secs || secs < 0) secs = 0;
    const roundedSecs = Math.floor(secs % 60);
    return `${Math.floor(secs / 60)}:${roundedSecs < 10 ? `0${roundedSecs}` : roundedSecs}`;
  };

  let lastFrameTime = 0;
  const handleFrame = (ts: number) => {
    const dt = ts - lastFrameTime;
    lastFrameTime = ts;

    if (isPlaying) {
      currentTimestamp += dt / 1000;
    }

    render();
    requestAnimationFrame(handleFrame);
  };
  requestAnimationFrame(handleFrame);
  
  window.ipcRenderer.send('initialize');
  window.ipcRenderer.on('song_changed', (_, payload) => {
    artist = payload.artist;
    title = payload.title;
    duration = payload.duration;
    currentTimestamp = 0;
    isPlaying = false;
    render();
  });
  window.ipcRenderer.on('song_progress', (_, payload) => {
    currentTimestamp = payload.timestamp;
  });
  window.ipcRenderer.on('song_stopped', () => {
    isPlaying = false;
    artist = '';
    title = '';
    duration = 0;
    render();
  });
  window.ipcRenderer.on('song_played', (_, payload) => {
    currentTimestamp = payload.timestamp;
    isPlaying = true;
  });
  window.ipcRenderer.on('song_paused', () => {
    isPlaying = false;
  });
  window.onerror = (error, url, line) => window.ipcRenderer.send('error', { error, url, line });
}
