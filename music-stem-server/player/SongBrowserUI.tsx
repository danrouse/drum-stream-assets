import { useEffect, useState } from 'react';
import { unstable_batchedUpdates } from 'react-dom';

import MultiTrackAudioPlayer from './MultiTrackAudioPlayer';
import SongBrowserPlaylists from './SongBrowserPlaylists';

// localStorage persistence of user state
const DEFAULT_PLAYLISTS: Playlist[] = [
  { title: 'Base Playlist', songs: [] },
  { title: 'Requests', songs: [] },
];
interface SavedState {
  isAutoplayEnabled: boolean;
  isShuffleEnabled: boolean;
  songSearchQuery: string;
  mutedTrackNames: string[];
  playbackRate: number;
  volume: number;
  playlists: Playlist[];
  selectedPlaylistIndex: number;
}
const defaultSavedState: SavedState = {
  isAutoplayEnabled: false,
  isShuffleEnabled: false,
  songSearchQuery: '',
  mutedTrackNames: [],
  playbackRate: 1,
  volume: 1,
  playlists: DEFAULT_PLAYLISTS,
  selectedPlaylistIndex: 0,
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
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [playlists, setPlaylists] = useState<Playlist[]>(DEFAULT_PLAYLISTS);
  const [selectedPlaylistIndex, setSelectedPlaylistIndex] = useState(0);
  // Internal state
  const [allSongs, setAllSongs] = useState<SongData[]>([]);
  const [selectedSong, setSelectedSong] = useState<SongData>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlayingFromPlaylist, setIsPlayingFromPlaylist] = useState(false);
  const [socket, setSocket] = useState<WebSocket>();

  const fetchNewSongListData = () => fetch('/songs')
    .then(res => res.json())
    .then((songs: SongData[]) => {
      // TODO: Sorting option (download date vs artist)
      // songs.sort((a, b) => new Date(b.downloadDate).getTime() - new Date(a.downloadDate).getTime())
      songs.sort((a, b) =>
        a.artist !== b.artist ? a.artist.localeCompare(b.artist) :
          a.album !== b.album ? a.album.localeCompare(b.album) :
            a.track[0] - b.track[0]);
      setAllSongs(songs);
    });
  
  const nextSong = () => {
    const songList = isPlayingFromPlaylist ? playlists[selectedPlaylistIndex].songs : allSongs;
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
    if (!socket || socket.readyState !== socket.OPEN) return;
    // console.log('broadcast', payload);
    socket.send(JSON.stringify(payload));
  };

  const filteredSongs = allSongs.filter(s => s.name.match(new RegExp(songSearchQuery, 'i')));
  
  // User state persistence in localStorage
  useEffect(() => {
    if (isInitialLoad) {
      const loadedState = loadState();
      unstable_batchedUpdates(() => {
        setIsAutoplayEnabled(loadedState.isAutoplayEnabled);
        setIsShuffleEnabled(loadedState.isShuffleEnabled);
        setSongSearchQuery(loadedState.songSearchQuery);
        setMutedTrackNames(loadedState.mutedTrackNames);
        setPlaybackRate(loadedState.playbackRate);
        setVolume(loadedState.volume);
        setPlaylists(loadedState.playlists);
        setSelectedPlaylistIndex(loadedState.selectedPlaylistIndex);
        setIsInitialLoad(false);
      });
    } else {
      saveState({
        isAutoplayEnabled,
        isShuffleEnabled,
        songSearchQuery,
        mutedTrackNames,
        playbackRate,
        volume,
        playlists,
        selectedPlaylistIndex,
      });
    }
  }, [
    isAutoplayEnabled,
    isShuffleEnabled,
    songSearchQuery,
    mutedTrackNames,
    playbackRate,
    volume,
    playlists,
    selectedPlaylistIndex,
  ]);

  // One-time componentDidMount effects
  useEffect(() => {
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
            isPlaying={isPlaying}

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
            
            mutedTrackNames={mutedTrackNames}
            onTrackMuteChanged={setMutedTrackNames}
            shuffle={isShuffleEnabled}
            onShuffleChanged={setIsShuffleEnabled}
            autoplay={isAutoplayEnabled}
            onAutoplayChanged={setIsAutoplayEnabled}
            playbackRate={playbackRate}
            onPlaybackRateChanged={setPlaybackRate}
            volume={volume}
            onVolumeChanged={setVolume} 
          />
        }
      </div>
      <SongBrowserPlaylists
        className="bottom"
        songs={filteredSongs}
        socket={socket}
        onDownloadComplete={fetchNewSongListData}
        selectedSong={selectedSong}
        setSelectedSong={setSelectedSong}
        selectedPlaylistIndex={selectedPlaylistIndex}
        setSelectedPlaylistIndex={setSelectedPlaylistIndex}
        isPlayingFromPlaylist={isPlayingFromPlaylist}
        setIsPlayingFromPlaylist={setIsPlayingFromPlaylist}
        songSearchQuery={songSearchQuery}
        setSongSearchQuery={setSongSearchQuery}
        playlists={playlists}
        setPlaylists={setPlaylists}
      />
    </div>
  );
}
