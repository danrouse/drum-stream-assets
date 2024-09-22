import { useState, useRef, useEffect, useCallback } from 'react';
import { Howl, Howler } from 'howler';
import MultiTrackAudioPlayerTrack from './MultiTrackAudioPlayerTrack';
import formatTime from '../formatTime';
import './style.css';

interface MultiTrackAudioPlayerProps {
  autoplay?: boolean;
  artist?: string;
  title?: string;
  tracks?: SongTrack[];
  mutedTrackNames?: string[];

  isPlaying?: boolean;
  shuffle?: boolean;

  onSongPlayed: (t: number) => void;
  onSongPaused: () => void;
  onSongStopped: () => void;
  onSongEnded: () => void;
  onSongProgress: (t: number) => void;
  onSongLoaded: (artist: string, title: string, duration: number) => void;
  onTrackMuteChanged: (mutedTracks: string[]) => void;
  onShuffleChanged: (isShuffleEnabled: boolean) => void;
  onAutoplayChanged: (isAutoplayEnabled: boolean) => void;
}

export default function MultiTrackAudioPlayer({
  autoplay, artist, title, tracks, mutedTrackNames,
  isPlaying, shuffle,
  onSongPlayed, onSongPaused, onSongStopped, onSongEnded, onSongProgress, onSongLoaded,
  onTrackMuteChanged, onShuffleChanged, onAutoplayChanged,
}: MultiTrackAudioPlayerProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [sources, setSources] = useState<Howl[]>([]);

  const play = () => {
    if (!isLoaded) {
      // Use play button as a shortcut to start playing if nothing is loaded
      onSongEnded();
      return;
    }
    // sync up all audio sources when beginning playback
    sources.forEach(s => {
      s.seek(position);
      s.play();
    });
    onSongPlayed(position);
  };
  const pause = () => {
    sources.forEach(s => s.pause());
    onSongPaused();
  };
  const seek = (t: number) => {
    sources.forEach(s => s.seek(t));
    setPosition(t);
    onSongProgress(t);
  };
  const stopSong = () => {
    sources.forEach(s => s.stop());
    onSongStopped();
  };
  const handleTrackMuteChange = (changedTrack: SongTrack, muted: boolean) => {
    if (!tracks) return;
    const nextMutedTrackNames = tracks.filter((track) =>
      changedTrack === track ? muted : mutedTrackNames?.includes(track.title)
    ).map((track) => track.title);
    onTrackMuteChanged(nextMutedTrackNames);
  };

  const progressBar = useRef<HTMLInputElement>(null);

  // When loading is complete, broadcast and autoplay if applicable
  useEffect(() => {
    if (isLoaded) {
      onSongLoaded(artist!, title!, sources[0].duration());
      if (autoplay) play();
    }
  }, [isLoaded]);

  useEffect(() => {
    sources.forEach((s) => {
      s.stop();
    });
    setIsLoaded(false);
    setPosition(0);
    setDuration(0);

    if (!tracks || !artist || !title) { return; }

    // track this separately from isLoaded for non-UI purposes,
    // since many onload handlers will get called simultaneously,
    // before react handles state updates!
    let isAllHowlsLoaded = false;
    const newSources = tracks.map(track => {
      const howl = new Howl({
        src: track.src,
        preload: true,

        // html5 uses a lot less memory on iOS Safari,
        // but also shits its pants and doesn't sync well :(
        // html5: true,
      });
      const handleHowlLoaded = () => {
        if (newSources.every(h => h.state() === 'loaded') && !isAllHowlsLoaded) {
          isAllHowlsLoaded = true;
          setIsLoaded(true);
        }
        
        setDuration(howl.duration());
      };
      // howl.once('loaderror', () => {});
      if (howl.state() === 'loaded') {
        setTimeout(handleHowlLoaded, 1);
      } else {
        howl.once('load', handleHowlLoaded);
      }
      howl.on('end', () => {
        onSongEnded();
      });
      return howl;
    });
    setSources(newSources);

    let frameHandlerId: number | undefined;
    const handleFrame = () => {
      setPosition(newSources[0].seek());
      frameHandlerId = requestAnimationFrame(handleFrame);
    };
    frameHandlerId = requestAnimationFrame(handleFrame);
    
    const SONG_PROGRESS_UPDATE_TIME = 50;
    let prevTimestamp = 0;
    const broadcastInterval = setInterval(() => {
      const nextTimestamp = newSources[0].seek();
      if (nextTimestamp !== prevTimestamp && nextTimestamp !== 0) {
        onSongProgress(newSources[0].seek());
        prevTimestamp = nextTimestamp;
      }
    }, SONG_PROGRESS_UPDATE_TIME);

    window.addEventListener('beforeunload', () => {
      onSongStopped();
    });

    return () => {
      if (frameHandlerId) cancelAnimationFrame(frameHandlerId);
      clearInterval(broadcastInterval);
      newSources.forEach(howl => howl.unload());
      // Howler.unload();
      // for (let i in newSources) {
      //   newSources[i].unload();
      //   for (let j in newSources[i]) {
      //     delete newSources[i][j];
      //   }
      //   delete newSources[i];
      // }
      // onSongStopped();
    };
  }, [JSON.stringify(tracks)]); // my god this is awful
  
  return (
    <div className="MultiTrackAudioPlayer">
      <div className="MultiTrackAudioPlayer__top">
        <div className="MultiTrackAudioPlayer__head">
          <div className="MultiTrackAudioPlayer__meta">
            <p className="MultiTrackAudioPlayer__meta__artist">{artist}</p>
            <p className="MultiTrackAudioPlayer__meta__title">{title}</p>
          </div>
          <div className="MultiTrackAudioPlayer__controls">
            <button
              className="MultiTrackAudioPlayer__playpause"
              disabled={!isLoaded && Boolean(title)}
              onClick={() => {
                if (isPlaying) {
                  pause();
                } else {
                  play();
                }
              }}
            >
              <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}`} />
            </button>
            {/* TODO: Go back to previous song */}
            <button
              className={`MultiTrackAudioPlayer__shuffle ${shuffle ? '': 'inactive'}`}
              onClick={() => onShuffleChanged(!shuffle)}
            >
              <i className="fa-solid fa-shuffle" />
            </button>
            <button
              className={`MultiTrackAudioPlayer__autoplay ${autoplay ? '': 'inactive'}`}
              onClick={() => onAutoplayChanged(!autoplay)}
            >
              <i className="fa-solid fa-repeat" />
            </button>
            <button
              className="MultiTrackAudioPlayer__rewind"
              disabled={!isLoaded}
              onClick={() => seek(0)}
            >
              <i className="fa-solid fa-backward" />
            </button>
            <button
              className="MultiTrackAudioPlayer__stop"
              onClick={() => stopSong()}
            >
              <i className="fa-solid fa-stop" />
            </button>
            <button
              className="MultiTrackAudioPlayer__next"
              onClick={() => onSongEnded()}
            >
              <i className="fa-solid fa-forward-fast" />
            </button>
          </div>
        </div>
        <ul className="MultiTrackAudioPlayer__tracks">
            {tracks?.map((track, i) => (
              <MultiTrackAudioPlayerTrack 
                track={track}
                source={sources[i]}
                key={track.title}
                muted={mutedTrackNames?.includes(track.title)}
                onMuteChange={handleTrackMuteChange}
              />
            ))}
          </ul>
      </div>
      <div className="MultiTrackAudioPlayer__progress">
        <span className="MultiTrackAudioPlayer__progress__time">
          {formatTime(position)}
        </span>
        <input
          className="MultiTrackAudioPlayer__progress__slider"
          ref={progressBar}
          type="range"
          min={0}
          max={duration}
          value={position}
          onChange={e => {
            seek(e.currentTarget.valueAsNumber);
          }}
        />
        <span className="MultiTrackAudioPlayer__progress__time">
          {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}
