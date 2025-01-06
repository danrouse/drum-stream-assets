import { useEffect, useState } from 'react';
import { unstable_batchedUpdates } from 'react-dom';

import MultiTrackAudioPlayer from './MultiTrackAudioPlayer';
import SongBrowserPlaylists from './SongBrowserPlaylists';
import { ChannelPointReward, SongData, SongRequestData, WebSocketPlayerMessage, WebSocketServerMessage, StreamerbotViewer } from '../../shared/messages';

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
  const [mutedTrackNames, setMutedTrackNames] = useState<Set<string>>(new Set());
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
  const [activeViewers, setActiveViewers] = useState<StreamerbotViewer[]>([]);
  // Previous state values for resetting from client remote control commands
  const [prevMutedTrackNames, setPrevMutedTrackNames] = useState<Set<string>>(new Set());
  const [prevPlaybackRate, setPrevPlaybackRate] = useState(1);

  // For song filtering, check word by word (order doesn't matter)
  const songSearchRegexps = songSearchQuery.split(' ').map(word => new RegExp(word, 'i'));
  const filteredSongs = allSongs.filter(s => songSearchRegexps.every(wordRegexp => 
    s.title.match(wordRegexp) ||
    s.artist.match(wordRegexp) ||
    (s.album?.match(wordRegexp) && !s.album?.startsWith('YouTube')) ||
    s.requester?.match(wordRegexp)
  ));

  const fetchNewSongListData = () => fetch('/songs')
    .then(res => res.json())
    .then((songs: SongData[]) => {
      // TODO: Sorting option (download date vs artist)
      songs.sort((a, b) => b.id - a.id);
      // songs.sort((a, b) =>
      //   a.artist !== b.artist ? a.artist.localeCompare(b.artist) :
      //     a.album !== b.album ? a.album.localeCompare(b.album) :
      //       a.track[0] - b.track[0]);
      setAllSongs(songs);
    });
  const fetchNewRequestData = () => fetch('/requests')
    .then(res => res.json())
    .then((songs: SongRequestData[]) => {
      setPlaylists(nextPlaylists => nextPlaylists.map(playlist => {
        if (playlist.title === SONG_REQUEST_PLAYLIST_NAME) {
          return { title: playlist.title, songs };
        }
        return playlist;
      }));
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
    setMutedTrackNames(prevMutedTrackNames);
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

  const addToPlaylist = (playlist: Playlist, song: SongData) => {
    setPlaylists(playlists.map(p => {
      if (p === playlist) return { ...p, songs: p.songs.concat([song]) };
      return p;
    }));
  };

  const removeFromPlaylist = (playlist: Playlist, song: SongData) => {
    if (song.songRequestId) {
      broadcast({ type: 'song_request_removed', songRequestId: song.songRequestId });
    }
    setPlaylists(playlists.map(p => {
      if (p === playlist) return { ...p, songs: p.songs.filter(s => s !== song) };
      return p;
    }));
  };
  
  const broadcast = (payload: WebSocketPlayerMessage) => {
    if (!socket || socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(payload));
  };

  const handleWebSocketMessage = (e: MessageEvent) => {
    const message: WebSocketServerMessage = JSON.parse(e.data.toString());
    if (message?.type === 'song_request_added' || message?.type === 'song_request_removed') {
      fetchNewRequestData();
    } else if (message?.type === 'client_remote_control') {
      handleClientRemoteControl(message.action, message.duration, message.amount);
    } else if (message?.type === 'viewers_update') {
      setActiveViewers(message.viewers);
    }
  };

  const handleClientRemoteControl = (action: ChannelPointReward['name'], duration?: number, amount?: number) => {
    if (action === 'NoShenanigans' || action === 'ResetShenanigans') {
      while (clientRemoteControlResetTimers.length > 0) {
        clearTimeout(clientRemoteControlResetTimers[0]);
        clientRemoteControlResetTimers.shift();
      }
      setPlaybackRate(1);
      setMutedTrackNames(new Set());
    } else if (action === 'MuteCurrentSongDrums') {
      const nextMutedTrackNames = new Set(mutedTrackNames);
      nextMutedTrackNames.add('drums');
      setMutedTrackNames(nextMutedTrackNames);
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

  // User state persistence in localStorage
  useEffect(() => {
    if (isInitialLoad) {
      const loadedState = loadState();
      unstable_batchedUpdates(() => {
        setIsAutoplayEnabled(loadedState.isAutoplayEnabled);
        setIsShuffleEnabled(loadedState.isShuffleEnabled);
        setSongSearchQuery(loadedState.songSearchQuery);
        setMutedTrackNames(new Set(loadedState.mutedTrackNames));
        setPlaybackRate(loadedState.playbackRate);
        setVolume(loadedState.volume);
        // don't load song requests from memory, those are server-authoritative
        setPlaylists(
          loadedState.playlists
            .filter(p => p.title !== SONG_REQUEST_PLAYLIST_NAME)
            .concat(
              playlists.filter(p => p.title === SONG_REQUEST_PLAYLIST_NAME)
            )
        );
        setSelectedPlaylistIndex(loadedState.selectedPlaylistIndex);
        setIsInitialLoad(false);

        setPrevMutedTrackNames(new Set(loadedState.mutedTrackNames));
        setPrevPlaybackRate(loadedState.playbackRate);
      });
    } else {
      saveState({
        isAutoplayEnabled,
        isShuffleEnabled,
        songSearchQuery,
        mutedTrackNames: Array.from(mutedTrackNames),
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
    fetchNewRequestData();

    const setupWebSocket = () => {
      const ws = new WebSocket(`ws://${location.host}`);
      setSocket(ws);
      ws.addEventListener('message', handleWebSocketMessage);
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
            song={selectedSong}
            isPlaying={isPlaying}

            onSongLoaded={() => {
              let previousSongs: SongData[] = [];
              let nextSongs: SongData[] = [];
              if (isPlayingFromPlaylist) {
                const songList = playlists[selectedPlaylistIndex].songs;
                const currentSelectedSongIndex = songList.indexOf(selectedSong!);
                previousSongs = songList.slice(0, currentSelectedSongIndex);
                nextSongs = songList.slice(currentSelectedSongIndex + 1);
              }
              broadcast({ type: 'song_changed', song: selectedSong!, previousSongs, nextSongs });
              if (!isAutoplayEnabled) {
                setIsPlaying(false);
              }
            }}
            onSongPlayed={(timestamp) => {
              broadcast({ type: 'song_played', timestamp });
              setIsPlaying(true);
            }}
            onSongPaused={() => {
              broadcast({ type: 'song_playpack_paused' });
              setIsPlaying(false);
            }}
            onSongStarted={() => {
              if (selectedSong) {
                broadcast({
                  type: 'song_playback_started',
                  id: selectedSong?.id,
                  songRequestId: selectedSong?.songRequestId,
                });
              }
            }}
            onSongStopped={stopPlayback}
            onSongEnded={() => {
              broadcast({ type: 'song_playpack_paused' });
              if (selectedSong) {
                broadcast({
                  type: 'song_playback_completed',
                  id: selectedSong?.id,
                  songRequestId: selectedSong?.songRequestId,
                });
              }
              if (isAutoplayEnabled) {
                nextSong();
              } else {
                setIsPlaying(false);
              }
            }}
            onSongSkipped={() => {
              broadcast({ type: 'song_playpack_paused' });
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
        addToPlaylist={addToPlaylist}
        removeFromPlaylist={removeFromPlaylist}
        activeViewers={activeViewers}
        refreshRequests={fetchNewRequestData}
      />
    </div>
  );
}
