import { useState, useCallback, useEffect } from 'react';
import { Howl } from 'howler';

interface SyncedAudioPlayerTrackProps {
  track: SongTrack;
  source?: Howl;
  muted?: boolean;
  onMuteChange: (track: SongTrack, muted: boolean) => void;
}

export default function SyncedAudioPlayerTrack({
  source, track, muted, onMuteChange
}: SyncedAudioPlayerTrackProps) {
  const [_, setDummy] = useState<any>();
  const forceUpdate = useCallback(() => setDummy({}), []);

  useEffect(() => {
    source?.mute(Boolean(muted));
    forceUpdate();
  }, [muted, source?.state()]);

  return (
    <li className="SyncedAudioPlayerTrack" onClick={() => onMuteChange(track, !muted)}>
      {/* <input
        type="range"
        min={0}
        max={1.0}
        step={0.25}
        value={source?.volume() || 0}
        onChange={e => {
          source?.volume(e.currentTarget.valueAsNumber);
          forceUpdate();
        }}
      /> */}
      <button className={
        muted ? 'muted' : ''
      }>
        {muted ? '🔈' : '🔊'}
      </button>
      <p>{track.title}</p>
    </li>
  );
}
