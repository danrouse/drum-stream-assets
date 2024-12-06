import { SongData } from '../../../shared/messages';
import { Howl } from 'howler';
import { formatTime } from '../../../shared/util';

/*
      - activate when going into pause
        - need: OBS scene change notification
      - when activating, request a full list of stemmed songs
        - need: request song list from host? (or HTTP request same way player gets it?)
- pick four randomly
- pick one of the four as the selected song
- play one of the stemmed tracks
- show a pick 4 list of the songs
- listen to chat messages for numbers
  - need: twitch chat message notification
  - track only the most recent number message from a user
  - the first one who gave the right answer as their final answer wins
- count down a timer
- when done: give success somehow
  - maybe: bump winner's next SR up one position in queue?
  - maybe: WS send message back to coordinator of guessthesong winner
*/
const ACTIVE_SCENE_NAME = 'BRB';
const NUM_SONG_OPTIONS = 4;
const ROUND_LENGTH_MS = 25000;
const POST_ROUND_LENGTH_MS = 10000;
const FADE_OUT_TIME_MS = 2000;

interface UserChatResponse {
  user: string;
  response: number;
  time: Date;
}

if (location.hash === '#GuessTheSongWindow') {
  import('./style.css');

  let songsIndex: SongData[];
  let responses: UserChatResponse[];
  let isActive = true;
  let nextSceneChange: NodeJS.Timeout | undefined;
  let howls: Howl[] = [];
  let roundStartTime: Date;

  const globalContainerElem = document.getElementById('app')!;

  const timerElem = document.createElement('div');
  timerElem.classList.add('GuessTheSong-timer');
  globalContainerElem.appendChild(timerElem);
  let timerDisplayValueMs = 0;

  const descriptionElem = document.createElement('p');
  descriptionElem.classList.add('GuessTheSong-description');
  globalContainerElem.appendChild(descriptionElem);
  descriptionElem.innerHTML = `
    Try to guess the song using only the dRUM and bASS parts!<br />
    <small><em>These songs are all from past song requests. Some of them might be horrible!</em></small>
  `;

  const songListElem = document.createElement('ol');
  songListElem.classList.add('GuessTheSong-songs');
  globalContainerElem.appendChild(songListElem);

  setInterval(() => {
    if (timerDisplayValueMs >= 0) {
      // timerElem.innerText = formatTime(timerDisplayValueMs / 1000);
      timerElem.innerText = String(Math.ceil(timerDisplayValueMs / 1000));
      timerDisplayValueMs -= 100;
    } else {
      timerElem.innerText = '';
    }
  }, 100);

  window.ipcRenderer.on('obs_scene_changed', async (_, payload) => {
    if (payload.scene === ACTIVE_SCENE_NAME) {
      songsIndex = (await fetch('http://localhost:3000/songs').then(r => r.json()));
      startRound();
    } else {
      if (nextSceneChange) {
        clearTimeout(nextSceneChange);
        nextSceneChange = undefined;
      }
      timerDisplayValueMs = 0;
      songListElem.innerHTML = '';
      howls.forEach(h => h.unload());
      howls = [];
      isActive = false;
    }
  });

  window.ipcRenderer.on('chat_message', (_, payload) => {
    if (!isActive) return;

    const response = Number(payload.message);
    if (!Number.isNaN(response) && response > 0 && response <= NUM_SONG_OPTIONS) {
      responses.push({
        user: payload.user,
        response,
        time: new Date(),
      });
    }
  });

  function startRound() {
    console.log('startRound');
    if (!songsIndex.length) {
      console.warn('Songs index is empty when starting round!');
      return;
    }

    isActive = true;
    responses = [];
    roundStartTime = new Date();

    const songPool: SongData[] = [];
    for (let i = 0; i < NUM_SONG_OPTIONS; i++) {
      let nextSong;
      do {
        nextSong = songsIndex[Math.floor(Math.random() * songsIndex.length)];
      } while (!nextSong || songPool.includes(nextSong));
      songPool.push(nextSong);
    }
    console.log('pool', songPool)

    const correctResponse = Math.floor(Math.random() * NUM_SONG_OPTIONS) + 1;
    console.log('correct response', correctResponse);
    renderGuessingView(songPool, songPool[correctResponse - 1]);
    nextSceneChange = setTimeout(() => endRound(correctResponse, songPool), ROUND_LENGTH_MS);
    timerDisplayValueMs = ROUND_LENGTH_MS;
  }

  function endRound(correctResponse: number, songPool: SongData[]) {
    // take only last response per user
    const userResponses = responses.reduce((acc, cur) => {
      acc[cur.user] = cur;
      return acc;
    }, {} as { [user: string]: UserChatResponse });
    const orderedResponses = Object.values(userResponses).sort((a, b) => a.time.getTime() - b.time.getTime());
    const correctResponses = orderedResponses.filter(res => res.response === correctResponse);
    window.ipcRenderer.send(
      'guess_the_song_round_complete',
      correctResponses?.[0]?.user,
      (correctResponses?.[0]?.time.getTime() - roundStartTime.getTime()) / 1000
    );
    renderResultsView(songPool, songPool[correctResponse - 1], correctResponses);
    setTimeout(() => {
      howls.forEach(h => h.fade(1, 0, FADE_OUT_TIME_MS));
    }, POST_ROUND_LENGTH_MS - FADE_OUT_TIME_MS);
    nextSceneChange = setTimeout(() => startRound(), POST_ROUND_LENGTH_MS);
    timerDisplayValueMs = POST_ROUND_LENGTH_MS;
  }

  function renderGuessingView(songPool: SongData[], correctSong: SongData) {
    songListElem.innerHTML = '';
    songListElem.classList.remove('results');

    songPool.forEach((song, i) => {
      const elem = document.createElement('li');
      elem.innerText = [song.artist, song.title].filter(s => s).join(' - ');
      if (song === correctSong) {
        elem.classList.add('correct');
      }
      songListElem.appendChild(elem);
    });

    howls.forEach(howl => howl.unload());
    let isLoaded = false;
    howls = ['bass.mp3', 'drums.mp3'].map(basename => {
      return new Howl({
        src: `http://localhost:3000${correctSong.stemsPath}/${basename}`,
        preload: true,
        autoplay: false,
        onload: () => {
          if (howls.every(h => h.state() === 'loaded') && !isLoaded) {
            isLoaded = true;
            const startPosition = Math.random() * (howls[0].duration() - ((ROUND_LENGTH_MS - POST_ROUND_LENGTH_MS) / 1000));
            howls.forEach(h => {
              h.seek(startPosition);
              h.play();
            });
          }
        },
      });
    });
  }

  function renderResultsView(songPool: SongData[], song: SongData, correctResponses: UserChatResponse[]) {
    songListElem.classList.add('results');
    
    // if no winner, say so
    // else show winner's name and how long it took them
    // play the actual song with all stems (or base download instead maybe)
    howls.push(...['vocals.mp3', 'other.mp3'].map(basename => {
      const howl = new Howl({
        src: `http://localhost:3000${song.stemsPath}/${basename}`,
        preload: true,
        autoplay: false,
        volume: 0.7,
        onload: () => {
          howl.seek(howls[0].seek());
          howl.play();
        },
      });
      return howl;
    }));
    // howls.forEach(howl => howl.stop());
    // const howl = new Howl({
    //   src: song.downloadPath!,
    //   preload: true,
    //   autoplay: true,
    //   onload: () => howl.seek(songPosition),
    // });
    // howls = [howl];
  }
}
