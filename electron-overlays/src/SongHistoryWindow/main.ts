import { formatTime } from '../../../shared/util';
import { SongData } from '../../../shared/messages';

if (location.hash === '#SongHistoryWindow') {
  import('./style.css');

  const globalContainerElem = document.body.querySelector<HTMLDivElement>('#app')!;
  
  globalContainerElem.innerHTML = `
    <ul id="previous-songs"></ul>
    <div id="current-song"></div>
    <ul id="next-songs"></ul>
  `;
  const previousSongsElem = document.getElementById('previous-songs')!;
  const nextSongsElem = document.getElementById('next-songs')!;
  const currentSongElem = document.getElementById('current-song')!;
  
  window.ipcRenderer.on('song_changed', (_, payload) => {
    previousSongsElem.innerHTML = '';
    nextSongsElem.innerHTML = '';
    currentSongElem.innerHTML = '';

    const renderSong = (song: SongData, elemType: string = 'LI') => {
      const elem = document.createElement(elemType);
      elem.innerHTML = `
        <p class="artist">${song.artist}</p>
        <p class="title">${song.title}</p>
        <p class="duration">${formatTime(song.duration)}</p>`
      return elem;
    }

    const numPrevSongs = payload.nextSongs?.length >= 3 ?
      Math.min(3, payload.previousSongs?.length || 0) :
      Math.min(payload.previousSongs?.length || 0, 6 - payload.nextSongs?.length);
    const numNextSongs = payload.previousSongs?.length >= 3 ?
      Math.min(3, payload.nextSongs?.length || 0) :
      Math.min(payload.nextSongs?.length || 0, 6 - payload.previousSongs?.length);
    currentSongElem.classList[numPrevSongs === 0 ? 'add' : 'remove']('no-prev');
    currentSongElem.classList[numNextSongs === 0 ? 'add' : 'remove']('no-next');

    for (let song of payload.previousSongs.slice(-1 * numPrevSongs)) {
      previousSongsElem.appendChild(renderSong(song));
    }
    for (let song of payload.nextSongs.slice(0, numNextSongs)) {
      nextSongsElem.appendChild(renderSong(song));
    }
    currentSongElem.appendChild(renderSong(payload.song, 'DIV'));
  });
}
