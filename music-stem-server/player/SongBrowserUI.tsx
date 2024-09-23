import { useEffect, useState } from 'react';
import { unstable_batchedUpdates } from 'react-dom';

import MultiTrackAudioPlayer from './MultiTrackAudioPlayer';
import SongList from './SongList';
import Downloader from './Downloader';


// localStorage persistence of user state
interface SavedState {
  isAutoplayEnabled: boolean;
  isShuffleEnabled: boolean;
  songSearchQuery: string;
  mutedTrackNames: string[];
  queuedSongs: SongData[];
  playbackRate: number;
}
const defaultSavedState: SavedState = {
  isAutoplayEnabled: false,
  isShuffleEnabled: false,
  songSearchQuery: '',
  mutedTrackNames: [],
  queuedSongs: [],
  playbackRate: 1,
};
const LOCAL_STORAGE_KEY = 'SongBrowser-state';
const loadState = () => {
  const state: Partial<SavedState> = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
  return {
    ...defaultSavedState,
    ...state,
  };
}
const saveState = (state: Partial<SavedState>) => {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
    ...defaultSavedState,
    ...state,
  }));
}

export default function SongBrowserUI() {
  // Track initial loading so locally-persisted state doesn't get overwritten
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  // User state - these all get persisted in localStorage
  const [isAutoplayEnabled, setIsAutoplayEnabled] = useState(false);
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);
  const [songSearchQuery, setSongSearchQuery] = useState('');
  const [mutedTrackNames, setMutedTrackNames] = useState<string[]>([]);
  const [queuedSongs, setQueuedSongs] = useState<SongData[]>([]);
  const [playbackRate, setPlaybackRate] = useState(1);
  // Internal state
  const [allSongs, setAllSongs] = useState<SongData[]>([]);
  const [selectedSong, setSelectedSong] = useState<SongData>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlayingFromQueue, setIsPlayingFromQueue] = useState(false);
  const [socket, setSocket] = useState<WebSocket>();

  const fetchNewSongListData = () => fetch('/songs')
    .then(res => res.json())
    .then((songs: SongData[]) => {
      songs.sort((a, b) =>
        a.artist !== b.artist ? a.artist.localeCompare(b.artist) :
          a.album !== b.album ? a.album.localeCompare(b.album) :
            a.track[0] - b.track[0]);
      setAllSongs(songs);
    });
  
  const nextSong = () => {
    const songList = isPlayingFromQueue ? queuedSongs : allSongs;
    console.log('next song', isPlayingFromQueue);
    const selectedSongIndex = songList.indexOf(selectedSong!);
    let nextIndex = selectedSongIndex === songList.length - 1 ? 0 : selectedSongIndex + 1;
    if (isShuffleEnabled) {
      do {
        nextIndex = Math.floor(Math.random() * songList.length);
      } while (nextIndex === selectedSongIndex);
    }
    setSelectedSong(songList[nextIndex]);
  };
  
  const broadcast = (payload: WebSocketIncomingMessage) => {
    if (!socket) return;
    console.log(payload)
    socket.send(JSON.stringify(payload));
  };

  // User state persistence in localStorage
  useEffect(() => {
    if (!isInitialLoad) {
      saveState({
        isAutoplayEnabled,
        isShuffleEnabled,
        songSearchQuery,
        mutedTrackNames,
        queuedSongs,
        playbackRate,
      });
    }
  }, [
    isAutoplayEnabled,
    isShuffleEnabled,
    songSearchQuery,
    mutedTrackNames,
    queuedSongs,
    playbackRate,
  ]);

  // One-time componentDidMount effects
  useEffect(() => {
    const loadedState = loadState();
    unstable_batchedUpdates(() => {
      setIsAutoplayEnabled(loadedState.isAutoplayEnabled);
      setIsShuffleEnabled(loadedState.isShuffleEnabled);
      setSongSearchQuery(loadedState.songSearchQuery);
      setMutedTrackNames(loadedState.mutedTrackNames);
      setQueuedSongs(loadedState.queuedSongs);
      setPlaybackRate(loadedState.playbackRate);
      setIsInitialLoad(false);
    });

    fetchNewSongListData();

    const ws = new WebSocket(`ws://${location.host}`);
    setSocket(ws);

    return () => {
      if (ws.readyState === ws.OPEN) {
        ws.close();
      } else {
        // can't cancel the pending connection,
        // so wait for it to open then close
        ws.addEventListener('open', () => {
          // somehow it's not always open at this point? what?
          ws.readyState === ws.OPEN && ws.close();
        });
      }
    };
  }, []);
  
  return (
    <div className="SongBrowserUI">
      <div className="top">
        {socket &&
          <MultiTrackAudioPlayer
            artist={selectedSong?.artist}
            title={selectedSong?.title}
            tracks={selectedSong?.stems.map(s => ({
              title: s.replace(/\.mp3$/, ''),
              src: `/stems/${selectedSong.name}/${s}`
            }))}

            onSongLoaded={(artist, title, duration) => {
              broadcast({ type: 'song_changed', artist, title, duration });
              if (!isAutoplayEnabled) {
                setIsPlaying(false);
              }
            }}
            onSongPlayed={(timestamp) => {
              broadcast({ type: 'song_played', timestamp });
              setIsPlaying(true);
            }}
            onSongPaused={() => {
              broadcast({ type: 'song_paused' });
              setIsPlaying(false);
            }}
            onSongStopped={() => {
              setSelectedSong(undefined);
              setIsPlaying(false);
              broadcast({ type: 'song_stopped' });
            }}
            onSongEnded={() => {
              broadcast({ type: 'song_paused' });
              if (isAutoplayEnabled) {
                nextSong();
              } else {
                setIsPlaying(false);
              }
            }}
            onSongSkipped={() => {
              broadcast({ type: 'song_paused' });
              nextSong();
            }}
            onSongProgress={(timestamp) => broadcast({ type: 'song_progress', timestamp })}
            onTrackMuteChanged={setMutedTrackNames}
            onShuffleChanged={setIsShuffleEnabled}
            onAutoplayChanged={setIsAutoplayEnabled}
            onPlaybackRateChanged={setPlaybackRate}
            mutedTrackNames={mutedTrackNames}
            autoplay={isAutoplayEnabled}
            shuffle={isShuffleEnabled}
            playbackRate={playbackRate}
            isPlaying={isPlaying}
          />
        }
        {socket &&
          <Downloader
            onDownloadComplete={fetchNewSongListData}
            onInputChanged={q => setSongSearchQuery(q)}
            value={songSearchQuery}
            socket={socket}
          />
        }
      </div>
      <div className="bottom">
        <div className={isPlayingFromQueue ? '' : 'active'}>
          <h2>All Songs</h2>
          <SongList
            songs={allSongs.filter(s => s.name.match(new RegExp(songSearchQuery, 'i')))}
            selectedSong={selectedSong}
            renderActions={(song: SongData) => (
              <>
                <button onClick={() => {
                  setSelectedSong(song);
                  setIsPlayingFromQueue(false);
                }}>
                  Select
                </button>
                <button onClick={() => !queuedSongs.includes(song) && setQueuedSongs([...queuedSongs, song])}>
                  Add to Playlist
                </button>
              </>
            )}
          />
        </div>
        <div className={isPlayingFromQueue ? 'active' : ''}>
          <h2>Queue</h2>
          <SongList
            songs={queuedSongs}
            selectedSong={selectedSong}
            renderActions={(song, index) => (
              <>
                <button onClick={() => {
                  setSelectedSong(song);
                  setIsPlayingFromQueue(true);
                }}>
                  Select
                </button>
                <button onClick={() => setQueuedSongs(queuedSongs.toSpliced(index, 1))}>
                  Remove
                </button>
              </>
            )}          
          />
        </div>
      </div>
    </div>
  );
}
