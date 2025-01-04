import { midiNoteDefinitions, MIDINoteDefinition, MIDI_TRIGGER_VELOCITY_MAX } from '../../../shared/midiNoteDefinitions';
import { ChannelPointReward } from '../../../shared/messages';
import { Howl } from 'howler';

const HOWL_POOL_SIZE = 4;
type HowlPool = { howls: Howl[], index: number };
const howlPools: { [src: string]: HowlPool } = {};
window.ipcRenderer.send('get_samples');
window.ipcRenderer.on('get_samples', (_, samples) => {
  samples.forEach((src: string) => {
    howlPools[src] = { index: 0, howls: [] };
    for (let i = 0; i < HOWL_POOL_SIZE; i++) {
      howlPools[src].howls.push(new Howl({
        src: `/samples/${src}`,
        preload: true,
      }));
    }
  })
});

const drumReplacementSounds: {
  [drumName in MIDINoteDefinition['name']]?: string
} = {};

function triggerSound(audioPath: string, volume: number = 1.0) {
  const pool = howlPools[audioPath];
  const howl = pool.howls[pool.index];
  howl.seek(0);
  howl.volume(volume * 0.8);
  howl.play();

  pool.index += 1;
  if (pool.index >= pool.howls.length) pool.index = 0;
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
    drumReplacementSounds.Tom1 = 'Fart 1.wav';
    drumReplacementSounds.Tom2 = 'Fart 2.wav';
    drumReplacementSounds.Tom3 = 'Fart 3.wav';
    drumReplacementSounds.Tom4 = 'Fart 4.wav';
    setTimeout(() => {
      delete drumReplacementSounds.Tom1;
      delete drumReplacementSounds.Tom2;
      delete drumReplacementSounds.Tom3;
      delete drumReplacementSounds.Tom4;
    }, payload.duration);
  } else if (action === 'NoShenanigans' || action === 'ResetShenanigans') {
    for (let key in drumReplacementSounds) {
      delete drumReplacementSounds[key];
    }
  }
});
window.ipcRenderer.on('midi_note_on', (_, payload) =>
  handleMIDINote(payload.note, payload.velocity));
