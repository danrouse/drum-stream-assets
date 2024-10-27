import { useState, useCallback, useEffect } from 'react';
import { Howl } from 'howler';

interface SyncedAudioPlayerTrackProps {
  source?: Howl;
  name: string;
  muted?: boolean;
  onMuteChange: (trackName: string, muted: boolean) => void;
}

export default function SyncedAudioPlayerTrack({
  source, name, muted, onMuteChange
}: SyncedAudioPlayerTrackProps) {
  const [_, setDummy] = useState<any>();
  const forceUpdate = useCallback(() => setDummy({}), []);

  useEffect(() => {
    source?.mute(Boolean(muted));
    forceUpdate();
  }, [muted, source?.state()]);

  return (
    <li className="SyncedAudioPlayerTrack" onClick={() => onMuteChange(name, !muted)}>
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
      <p>{name}</p>
    </li>
  );
}
