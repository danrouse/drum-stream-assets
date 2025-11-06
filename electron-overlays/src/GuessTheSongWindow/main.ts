import { SongData } from '../../../shared/messages';
import { Howl } from 'howler';
import titleType from '../../../assets/name-that-tune-title-type.png';

const ACTIVE_SCENE_NAME = 'BRB';
const NUM_SONG_OPTIONS = 4;
const ROUND_LENGTH_MS = 25000;
const POST_ROUND_LENGTH_MS = 10000;
const FADE_OUT_TIME_MS = 2000;
const LAG_COMPENSATION_DELAY_MS = 5000;

interface UserChatResponse {
  user: string;
  response: number;
  time: Date;
}

let songsIndex: SongData[];
let responses: UserChatResponse[];
let isActive = true;
let nextSceneChange: NodeJS.Timeout | undefined;
let howls: Howl[] = [];
let roundStartTime: Date;

const globalContainerElem = document.getElementById('app')!;

const descriptionElem = document.createElement('img');
descriptionElem.src = titleType;
globalContainerElem.appendChild(descriptionElem);

const timerElem = document.createElement('div');
timerElem.classList.add('GuessTheSong-timer');
globalContainerElem.appendChild(timerElem);
let timerDisplayValueMs = 0;

const songListElem = document.createElement('ol');
songListElem.classList.add('GuessTheSong-songs');
globalContainerElem.appendChild(songListElem);

setInterval(() => {
  if (timerDisplayValueMs >= 0) {
    // timerElem.innerText = formatTime(timerDisplayValueMs / 1000);
    timerElem.innerText = String(Math.ceil(timerDisplayValueMs / 1000));
    timerDisplayValueMs -= 100;
  } else if (!isActive) {
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
    howls.forEach(h => { h.stop(); h.unload(); });
    howls = [];
    isActive = false;
  }
});

window.ipcRenderer.on('chat_message', (_, payload) => {
  if (!isActive) return;

  const message = payload.message.trim().replace(/dannyt75Fourrin/g, '4');
  const response = Number(message.match(/^(\d+).*/)?.[1]);
  if (!Number.isNaN(response) && response > 0) {
    // don't overwrite previous response if it is the same
    const previousResponse = responses.findLast(r => r.user === payload.user);
    if (!previousResponse || previousResponse.response !== response) {
      responses.push({
        user: payload.user,
        response,
        time: new Date(),
      });
    }
  }
});

window.ipcRenderer.on('guess_the_song_scores', (_, payload) => {
  renderLeaderboards(payload.daily, payload.weekly, payload.lifetime);
});

function startRound() {
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

  // occasionally set one song to be #69
  const responseNumbers = Array.from({ length: NUM_SONG_OPTIONS }, (_, i) => i + 1);
  if (Math.random() < 0.5) {
    responseNumbers[Math.floor(Math.random() * NUM_SONG_OPTIONS)] = 69;
  }

  const correctResponseIndex = Math.floor(Math.random() * NUM_SONG_OPTIONS);
  const correctResponse = responseNumbers[correctResponseIndex];
  console.log('Correct:', correctResponse);
  renderGuessingView(songPool, songPool[correctResponseIndex], responseNumbers);
  nextSceneChange = setTimeout(() => endRound(correctResponse, songPool[correctResponseIndex]), ROUND_LENGTH_MS);
  timerDisplayValueMs = ROUND_LENGTH_MS;
}

function endRound(correctResponse: number, song: SongData) {
  // fade in the correct song immediately, but wait an extra period of time
  // to compensate for stream lag
  renderResultsView(song);
  setTimeout(() => {
    howls.forEach(h => h.fade(1, 0, FADE_OUT_TIME_MS));
  }, LAG_COMPENSATION_DELAY_MS + POST_ROUND_LENGTH_MS - FADE_OUT_TIME_MS);

  nextSceneChange = setTimeout(() => {
    // take only last response per user
    const userResponses = responses.reduce((acc, cur) => {
      acc[cur.user] = cur;
      return acc;
    }, {} as { [user: string]: UserChatResponse });
    const orderedResponses = Object.values(userResponses).sort((a, b) => a.time.getTime() - b.time.getTime());
    const correctResponses = orderedResponses.filter(res => res.response === correctResponse);
    window.ipcRenderer.send(
      'guess_the_song_round_complete',
      correctResponses[0]?.user,
      (correctResponses[0]?.time.getTime() - roundStartTime.getTime() - LAG_COMPENSATION_DELAY_MS) / 1000,
      correctResponses.slice(1).map(r => r.user),
    );
    nextSceneChange = setTimeout(() => startRound(), POST_ROUND_LENGTH_MS);
    timerDisplayValueMs = POST_ROUND_LENGTH_MS;
    timerElem.classList.add('results');
  }, LAG_COMPENSATION_DELAY_MS);
}

const truncate = (s: string, len: number = 32) => s.length < len ? s : s.substring(0, len).trim() + '…';

function renderGuessingView(songPool: SongData[], correctSong: SongData, responseNumbers: number[]) {
  songListElem.innerHTML = '';
  songListElem.classList.remove('results');
  timerElem.classList.remove('results');

  const fadeOuts = [0,1,2,3].toSorted(() => Math.random() - 0.5).reduce((a, i) => {
    if (songPool[i] !== correctSong && a.length < 2) {
      a.push(i);
    }
    return a;
  }, [] as number[]);
  songPool.forEach((song, i) => {
    const elem = document.createElement('li');
    elem.innerHTML = `<span class="marker-number">${responseNumbers[i]}</span> ${[truncate(song.artist), truncate(song.title, 48)].filter(s => s).join(' - ')}`;
    if (song === correctSong) {
      elem.classList.add('correct');
    } else if (fadeOuts.includes(i)) {
      elem.classList.add('fade');
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
          const minRequiredDuration = (ROUND_LENGTH_MS + POST_ROUND_LENGTH_MS + LAG_COMPENSATION_DELAY_MS) / 1000;
          const startPosition = Math.random() * (howls[0].duration() - minRequiredDuration);
          howls.forEach(h => {
            h.seek(startPosition);
            h.play();
          });
        }
      },
    });
  });
}

function renderResultsView(song: SongData) {
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
        howl.fade(0, 1, 1000);
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

type LeaderboardScores = Array<{ name: string, count: number }>;
function renderLeaderboards(dailyScores: LeaderboardScores, weeklyScores: LeaderboardScores, lifetimeScores: LeaderboardScores) {
  document.querySelector('.GuessTheSong-leaderboard')?.remove();

  const leaderboardContainerElem = document.createElement('div');
  leaderboardContainerElem.classList.add('GuessTheSong-leaderboard');
  globalContainerElem.appendChild(leaderboardContainerElem);

  const createSection = (title: string) => {
    const headerElem = document.createElement('h2');
    headerElem.innerText = title;
    leaderboardContainerElem.appendChild(headerElem);
    const listElem = document.createElement('ol');
    leaderboardContainerElem.appendChild(listElem);
    return listElem;
  };

  const renderScores = (scores: LeaderboardScores, count: number, parent: HTMLOListElement) => {
    scores.slice(0, count).forEach(({ name, count }) => {
      const row = document.createElement('li');
      const index = scores.findIndex(s => s.count === count) + 1;
      if (index === 1) row.classList.add('leader');
      row.innerHTML = `<span class="marker">${index}</span><span class="score">${count}</span>${name}`;
      parent.appendChild(row);
    });
    if (!scores.length) {
      const dummy = document.createElement('li');
      dummy.innerHTML = '<center>-</center>';
      parent.appendChild(dummy);
    }
  };

  renderScores(dailyScores, 6, createSection('Today\'s Leaderboard'));
  renderScores(weeklyScores, 3, createSection('Weekly Top 3'));
  // renderScores(lifetimeScores, 3, createSection('All Time'));
}
