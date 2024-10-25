import { useEffect, useState } from 'react';
import { unstable_batchedUpdates } from 'react-dom';

import MultiTrackAudioPlayer from './MultiTrackAudioPlayer';
import SongBrowserPlaylists from './SongBrowserPlaylists';
import { ChannelPointReward, SongData, WebSocketPlayerMessage, WebSocketServerMessage } from '../../shared/messages';

// localStorage persistence of user state
const SONG_REQUEST_PLAYLIST_NAME = 'Requests';
const DEFAULT_PLAYLISTS: Playlist[] = [
  { title: 'Base Playlist', songs: [] },
  { title: SONG_REQUEST_PLAYLIST_NAME, songs: [] },
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

let clientRemoteControlResetTimers: NodeJS.Timeout[] = [];

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
  const [songRequestsToAdd, setSongRequestsToAdd] = useState<string[]>([]);
  const [socket, setSocket] = useState<WebSocket>();
  // Previous state values for resetting from client remote control commands
  const [prevMutedTrackNames, setPrevMutedTrackNames] = useState<string[]>([]);
  const [prevPlaybackRate, setPrevPlaybackRate] = useState(1);

  const filteredSongs = allSongs.filter(s => s.name.match(new RegExp(songSearchQuery, 'i')));

  const fetchNewSongListData = () => fetch('/songs')
    .then(res => res.json())
    .then((songs: SongData[]) => {
      // TODO: Sorting option (download date vs artist)
      songs.sort((a, b) => new Date(b.downloadDate).getTime() - new Date(a.downloadDate).getTime())
      // songs.sort((a, b) =>
      //   a.artist !== b.artist ? a.artist.localeCompare(b.artist) :
      //     a.album !== b.album ? a.album.localeCompare(b.album) :
      //       a.track[0] - b.track[0]);
      setAllSongs(songs);
    });
  
  const stopPlayback = () => {
    setSelectedSong(undefined);
    setIsPlaying(false);
    broadcast({ type: 'song_stopped' });
  };

  const handlePlaybackRateChanged = (rate: number) => {
    // When manually changing playback rate, remove any timers to reset
    // client remote control playback rates
    clientRemoteControlResetTimers.forEach(timer => clearTimeout(timer));
    clientRemoteControlResetTimers = [];
    setPlaybackRate(rate);
  };

  const nextSong = () => {
    // clear any "until next song" client remote control
    if (prevMutedTrackNames.join('') !== mutedTrackNames.join('')) {
      setMutedTrackNames(prevMutedTrackNames);
    }
    if (prevPlaybackRate !== playbackRate) {
      setPlaybackRate(prevPlaybackRate);
    }

    const songList = isPlayingFromPlaylist ? playlists[selectedPlaylistIndex].songs : filteredSongs;
    const currentSelectedSongIndex = songList.indexOf(selectedSong!);
    // If we're at the end of a playlist, playing sequentially, stop
    if (isPlayingFromPlaylist && !isShuffleEnabled && currentSelectedSongIndex === songList.length - 1) {
      stopPlayback();
      return;
    }
    // If not in a playlist, loop back around to the beginning
    let nextIndex = currentSelectedSongIndex === songList.length - 1 ? 0 : currentSelectedSongIndex + 1;
    if (isShuffleEnabled) {
      // Unless shuffling is on, in which case, get a random index that isn't the one we're on
      do {
        nextIndex = Math.floor(Math.random() * songList.length);
      } while (nextIndex === currentSelectedSongIndex);
    }
    setSelectedSong(songList[nextIndex]);
  };
  
  const broadcast = (payload: WebSocketPlayerMessage) => {
    if (!socket || socket.readyState !== socket.OPEN) return;
    // console.log('broadcast', payload);
    socket.send(JSON.stringify(payload));
  };

  const handleClientRemoteControl = (action: ChannelPointReward['name'], duration?: number, amount?: number) => {
    if (action === 'MuteCurrentSongDrums') {
      setMutedTrackNames([...mutedTrackNames, 'drums']);
    } else if (action === 'SpeedUpCurrentSong') {
      setPlaybackRate(r => r + amount!);
      clientRemoteControlResetTimers.push(
        setTimeout(() => setPlaybackRate(r => r - amount!), duration)
      );
    } else if (action === 'SlowDownCurrentSong') {
      const MIN_PLAYBACK_SPEED = 0.25; // TODO: Share this somehow
      setPlaybackRate(r => Math.max(r - amount!, MIN_PLAYBACK_SPEED));
      clientRemoteControlResetTimers.push(
        setTimeout(() => setPlaybackRate(r => r + amount!), duration)
      );
    }
  };

  // Keep the coordinator informed of song speed at all times
  useEffect(() => {
    broadcast({ type: 'song_speed', speed: playbackRate });
  }, [playbackRate]);

  // Add song requests to the Requests playlist when they become available
  useEffect(() => {
    const songRequestPlaylistIndex = playlists.findIndex(p => p.title === SONG_REQUEST_PLAYLIST_NAME);
    for (let i in songRequestsToAdd) {
      const song = allSongs.find(song => songRequestsToAdd[i] === song.name);
      if (song) {
        setPlaylists(playlists.toSpliced(songRequestPlaylistIndex, 1, {
          ...playlists[songRequestPlaylistIndex],
          songs: [...playlists[songRequestPlaylistIndex].songs, song]
        }));
        delete songRequestsToAdd[i];
      }
    }
  }, [songRequestsToAdd, allSongs]);

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

        setPrevMutedTrackNames(loadedState.mutedTrackNames);
        setPrevPlaybackRate(loadedState.playbackRate);
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
      // TODO: persist mutedTrackNames and playbackRate changes
      // into the prev values, but only if the changes came from UI (not from client remote control)
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

    const setupWebSocket = () => {
      const ws = new WebSocket(`ws://${location.host}`);
      setSocket(ws);

      const handleMessage = (e: MessageEvent) => {
        const message: WebSocketServerMessage = JSON.parse(e.data.toString());
        if (message?.type === 'song_request_added') {
          setSongRequestsToAdd([...songRequestsToAdd, message.name]);
        } else if (message?.type === 'client_remote_control') {
          handleClientRemoteControl(message.action, message.duration, message.amount);
        }
      };
      ws.addEventListener('message', handleMessage);
      // if connection fails, this close event will still get triggered
      // allowing this to retry connecting indefinitely
      ws.addEventListener('close', () => {
        setTimeout(() => {
          setupWebSocket();
        }, 1000)
      });
      return ws;
    };
    const ws = setupWebSocket();

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
              broadcast({ type: 'song_changed', artist, title, duration, album: selectedSong?.album });
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
            onSongStopped={stopPlayback}
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
            onPlaybackRateChanged={handlePlaybackRateChanged}
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
