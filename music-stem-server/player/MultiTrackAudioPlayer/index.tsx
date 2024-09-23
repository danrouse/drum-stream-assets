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
  playbackRate?: number;

  onSongPlayed: (t: number) => void;
  onSongPaused: () => void;
  onSongStopped: () => void;
  onSongEnded: () => void;
  onSongSkipped: () => void;
  onSongProgress: (t: number) => void;
  onSongLoaded: (artist: string, title: string, duration: number) => void;
  onTrackMuteChanged: (mutedTracks: string[]) => void;
  onShuffleChanged: (isShuffleEnabled: boolean) => void;
  onAutoplayChanged: (isAutoplayEnabled: boolean) => void;
  onPlaybackRateChanged: (rate: number) => void;
}

export default function MultiTrackAudioPlayer({
  autoplay, artist, title, tracks, mutedTrackNames,
  isPlaying, shuffle, playbackRate,
  onSongPlayed,
  onSongPaused,
  onSongStopped,
  onSongEnded,
  onSongSkipped,
  onSongProgress,
  onSongLoaded,
  onTrackMuteChanged,
  onShuffleChanged,
  onAutoplayChanged,
  onPlaybackRateChanged,
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

  // Sync audio elements with their settings
  useEffect(() => {
    sources.forEach(howl => {
      howl.rate(playbackRate);
    });
  }, [playbackRate]);

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
        rate: playbackRate,

        /*
          There's a lot of tradeoffs between using HTML5 Audio vs (default) WebAudio.
          WebAudio uses much more memory, and - in Safari, it leaks lots of memory.
          This is especially problematic on iOS which is very resource restricted.

          However, syncing the separate tracks' audio sources is much more reliable with WebAudio.
          Additionally, iOS does not allow for changing the volume of HTML5 audio sources.
          This means HTML5 audio volume control, for iOS support, must be binary muted/unmuted.

          Even more additionally, when changing playback rate, HTML5 audio preserves pitch,
          where WebAudio will end up with audio pitched up or down depending on playback rate,
          so slowing something down makes it deep and speeding it up makes it chipmunks.

          Given that we aren't planning on actually running this within iOS itself, we'll go with
          HTML5 audio for now, enabling changing playback rate effectively.
          We might need to pay more attention to keeping the tracks synced, but some amount
          of sync preservation needs to happen no matter what.
        */
        html5: true,
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
              <i className="fa-solid fa-circle-play" />
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
              onClick={() => onSongSkipped()}
            >
              <i className="fa-solid fa-forward-fast" />
            </button>
            <label>
              <span onClick={() => onPlaybackRateChanged(1)}>Speed</span>
              <input
                type="range"
                value={playbackRate}
                step={0.05}
                min={0.05}
                max={2.0}
                onChange={(evt) => onPlaybackRateChanged(evt.currentTarget.valueAsNumber)}
              />
            </label>
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
