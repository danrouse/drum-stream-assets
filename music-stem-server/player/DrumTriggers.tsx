import { forwardRef, useImperativeHandle, useRef, ForwardRefRenderFunction } from 'react';
import { midiNoteDefinitions } from '../../shared/midiNoteDefinitions';

interface DrumTriggerProps {
  triggers: [string, string][];
}
interface DrumTriggerRef {
  trigger: (midiNote: number, velocity: number) => void;
}

// there cannot be a dynamic number of refs, so assign a pool at first render
const TRIGGER_POOL_SIZE = 10;

const DrumTriggers: ForwardRefRenderFunction<DrumTriggerRef, DrumTriggerProps> = ({ triggers }, ref) => {
  useImperativeHandle(ref, () => ({
    trigger: (midiNote: number, velocity: number) => {
      // TODO: set volume based on velocity
      const drumName = midiNoteDefinitions.find(def => def.keys.includes(midiNote))?.name;
      const matchingTriggerIndex = triggers.findIndex(t => t[0] === drumName);
      if (refs[matchingTriggerIndex]?.current) {
        refs[matchingTriggerIndex].current.currentTime = 0;
        refs[matchingTriggerIndex].current.play();
      }
    },
  }));

  const refs = [...Array(TRIGGER_POOL_SIZE).keys()].map(_ => useRef<HTMLAudioElement>(null));

  return (
    <>
      {triggers.map(([drumName, src], i) => 
        <audio ref={refs[i]} src={src} key={drumName} />
      )}
    </>
  );
}

export default forwardRef<DrumTriggerRef, DrumTriggerProps>(DrumTriggers);
