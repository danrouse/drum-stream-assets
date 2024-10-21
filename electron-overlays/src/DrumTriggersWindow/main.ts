import { midiNoteDefinitions, MIDINoteDefinition, MIDI_TRIGGER_VELOCITY_MAX } from '../../../shared/midiNoteDefinitions';
import { ChannelPointReward } from '../../../shared/messages';

if (location.hash === '#DrumTriggersWindow') {
  const drumReplacementSounds: {
    [drumName in MIDINoteDefinition['name']]?: string
  } = {};

  function triggerSound(audioPath: string, volume: number = 1.0) {
    const audio = new Audio(audioPath);
    audio.volume = volume;
    audio.addEventListener('canplaythrough', () => audio.play());
    audio.addEventListener('ended', () => audio.remove());
  }

  function handleMIDINote(midiNote: number, velocity: number) {
    const drumName = midiNoteDefinitions.find(def => def.keys.includes(midiNote))?.name;
    if (drumName && drumReplacementSounds[drumName]) {
      triggerSound(drumReplacementSounds[drumName], velocity / MIDI_TRIGGER_VELOCITY_MAX);
    }
  }

  window.ipcRenderer.on('client_remote_control', (_, payload) => {
    const action: ChannelPointReward['name'] = payload.action;
    if (action === 'OopsAllFarts') {
      drumReplacementSounds.Tom1 = '/samples/Fart 1.wav';
      drumReplacementSounds.Tom2 = '/samples/Fart 2.wav';
      drumReplacementSounds.Tom3 = '/samples/Fart 3.wav';
      drumReplacementSounds.Tom4 = '/samples/Fart 4.wav';
      setTimeout(() => {
        delete drumReplacementSounds.Tom1;
        delete drumReplacementSounds.Tom2;
        delete drumReplacementSounds.Tom3;
        delete drumReplacementSounds.Tom4;
      }, payload.duration);
    }
  });
  window.ipcRenderer.on('midi_note_on', (_, payload) =>
    handleMIDINote(payload.note, payload.velocity));
}
