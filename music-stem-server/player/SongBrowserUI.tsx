import { useEffect, useState } from 'react';

import MultiTrackAudioPlayer from './MultiTrackAudioPlayer';
import SongList from './SongList';
import Downloader from './Downloader';
// import Playlist from './Playlist';


// localStorage persistence of user state
interface SavedState {
  isAutoplayEnabled: boolean;
  isShuffleEnabled: boolean;
  songSearchQuery: string;
  mutedTrackNames: string[];
  queuedSongs: SongData[];
}
const defaultSavedState: SavedState = {
  isAutoplayEnabled: false,
  isShuffleEnabled: false,
  songSearchQuery: '',
  mutedTrackNames: [],
  queuedSongs: [],
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
  // Internal state
  const [songListData, setSongListData] = useState<SongData[]>([]);
  const [selectedSong, setSelectedSong] = useState<SongData>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [socket, setSocket] = useState<WebSocket>();

  const fetchNewSongListData = () => fetch('/songs')
    .then(res => res.json())
    .then((songs: SongData[]) => {
      songs.sort((a, b) =>
        a.artist !== b.artist ? a.artist.localeCompare(b.artist) :
          a.album !== b.album ? a.album.localeCompare(b.album) :
            a.track[0] - b.track[0]);
      setSongListData(songs);
    });
  
  const nextSong = () => {
    const selectedSongIndex = songListData.indexOf(selectedSong!);
    const nextIndex = isShuffleEnabled ?
      Math.floor(Math.random() * songListData.length) :
      selectedSongIndex === songListData.length - 1 ?
        0 : selectedSongIndex + 1;
    setSelectedSong(songListData[nextIndex]);
  };
  
  const broadcast = (payload: WebSocketIncomingMessage) => {
    if (!socket) return;
    console.log(payload)
    socket.send(JSON.stringify(payload));
    // console.log('broadcast', payload);
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
      });
    }
  }, [
    isAutoplayEnabled,
    isShuffleEnabled,
    songSearchQuery,
    mutedTrackNames,
    queuedSongs,
  ]);

  // One-time componentDidMount effects
  useEffect(() => {
    fetchNewSongListData();

    const ws = new WebSocket(`ws://${location.host}`);
    setSocket(ws);

    const loadedState = loadState();
    setIsAutoplayEnabled(loadedState.isAutoplayEnabled);
    setIsShuffleEnabled(loadedState.isShuffleEnabled);
    setSongSearchQuery(loadedState.songSearchQuery);
    setMutedTrackNames(loadedState.mutedTrackNames);
    setQueuedSongs(loadedState.queuedSongs);
    setIsInitialLoad(false);

    return () => {
      if (ws.readyState === ws.OPEN) {
        // console.log('immediate cleanup');
        ws.close();
      } else {
        // can't cancel the pending connection,
        // so wait for it to open then close
        ws.addEventListener('open', () => {
          // somehow it's not always open at this point? what?
          // console.log('deferred cleanup');
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
              broadcast({ type: 'song_stopped' });
            }}
            onSongEnded={() => {
              broadcast({ type: 'song_paused' });
              nextSong();
            }}
            onSongProgress={(timestamp) => broadcast({ type: 'song_progress', timestamp })}
            onTrackMuteChanged={setMutedTrackNames}
            onShuffleChanged={setIsShuffleEnabled}
            onAutoplayChanged={setIsAutoplayEnabled}
            mutedTrackNames={mutedTrackNames}
            isPlaying={isPlaying}
            autoplay={isAutoplayEnabled}
            shuffle={isShuffleEnabled}
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
        {/* <Playlist
          selectedSong={selectedSong}
          onSongSelected={setSelectedSong}
        /> */}
        <SongList
          songs={songListData.filter(s => s.name.match(new RegExp(songSearchQuery, 'i')))}
          onSongSelected={setSelectedSong}
          onSongQueued={(song: SongData) => setQueuedSongs([...queuedSongs, song])}
        />
      </div>
    </div>
  );
}
