import midi, { MidiMessage } from 'midi';
import { WebSocketBroadcaster } from '../../shared/messages';

import { midiNoteDefinitions } from '../../shared/midiNoteDefinitions';

const allNoteNumbers = Object.values(midiNoteDefinitions).map(s => s.keys).flat();

const getRandomNote = () => allNoteNumbers[Math.floor(Math.random() * allNoteNumbers.length)];
const getRandomNoteMapping = () => {
  const randomizedNoteNumbers = allNoteNumbers.toSorted(() => 0.5 - Math.random());
  return allNoteNumbers.reduce((acc, noteNumber, index) => ({
    ...acc,
    [noteNumber]: randomizedNoteNumbers[index]
  }), {} as Record<number, number>);
};

export default class MIDIIOController {
  private input?: midi.Input;
  private output?: midi.Output;
  private broadcast?: WebSocketBroadcaster;

  private static KIT_NUMBER_DEFAULT = 95;
  private static KIT_NUMBER_NO_TOMS = 90;
  private static KIT_NUMBER_NO_CYMBALS = 91;
  private static KIT_NUMBER_ALL_MUTED = 96;

  public selectedKitNumber = MIDIIOController.KIT_NUMBER_DEFAULT;
  public previousKitNumber = MIDIIOController.KIT_NUMBER_DEFAULT;

  private static MIDI_CHANNEL_DRUM_KIT_CONTROL = 0x9; // Ch. 10 (Ch 1 is 0x0)

  // kit info is io on channel 10 (so 0x9, since channel 1 = 0x0)
  // these messages are all 0xMN, with M as cmd and N as channel
  private static MIDI_NOTE_ON = 0x90;
  private static MIDI_BANK_SELECT = 0xB0;
  private static MIDI_PROGRAM_SELECT = 0xC0;

  private noteMapping?: Record<number, number>;
  private isRandomized: boolean = false;

  constructor(broadcast?: WebSocketBroadcaster, deviceName: string = 'TD-30') {
    // TODO: handle not finding ports at instantiation time
    // TODO: reconnect if device disconnects
    
    this.broadcast = broadcast;

    try {
      this.initializePorts(deviceName);
    } catch (e) {
      const retry = setInterval(() => {
        if (!this.input) {
          try {
            this.initializePorts(deviceName);
            clearInterval(retry);
          } catch (e) {
            this.input = undefined;
            this.output = undefined;
          }
        }
      }, 100000);
    }
  }

  private initializePorts(deviceName: string) {
    const input = new midi.Input();
    let inputPort = 0;
    for (let i = 0; i < input.getPortCount(); i++) {
      if (input.getPortName(i).match(deviceName)) {
        inputPort = i;
        break;
      }
    }
    input.openPort(inputPort);
    input.on('message', this.handleMessage);

    const output = new midi.Output();
    let outputPort = 0;
    for (let i = 0; i < output.getPortCount(); i++) {
      if (output.getPortName(i).match(deviceName)) {
        outputPort = i;
        break;
      }
    }
    output.openPort(outputPort);

    this.input = input;
    this.output = output;

    process.on('beforeExit', () => {
      this.output?.closePort();
    });
  }

  playNote(note: number, velocity: number = 0x7f) {
    this.output?.sendMessage([0x92, note, velocity]);
  }

  changeKit(kitNumber: number, changeResetKit: boolean = true) {
    this.output?.sendMessage([
      MIDIIOController.MIDI_PROGRAM_SELECT + MIDIIOController.MIDI_CHANNEL_DRUM_KIT_CONTROL,
      kitNumber - 1,
      0
    ]);
    if (changeResetKit) {
      this.previousKitNumber = this.selectedKitNumber;
    }
    this.selectedKitNumber = kitNumber;
  }

  setVolume(volume: number) {
    this.output?.sendMessage([
      MIDIIOController.MIDI_BANK_SELECT  + MIDIIOController.MIDI_CHANNEL_DRUM_KIT_CONTROL,
      0x07,
      Math.floor(volume * 0x7f)
    ]);
  }

  resetKit() {
    this.changeKit(this.previousKitNumber, false);
    this.noteMapping = undefined;
    this.isRandomized = false;
  }

  muteToms(changeResetKit: boolean = true) {
    this.changeKit(MIDIIOController.KIT_NUMBER_NO_TOMS, changeResetKit);
  }

  muteCymbals(changeResetKit: boolean = true) {
    this.changeKit(MIDIIOController.KIT_NUMBER_NO_CYMBALS, changeResetKit);
  }

  muteAll(changeResetKit: boolean = true) {
    this.changeKit(MIDIIOController.KIT_NUMBER_ALL_MUTED, changeResetKit);
  }

  randomize(useMapping?: boolean) {
    this.muteAll();
    this.isRandomized = true;
    this.noteMapping = useMapping ? getRandomNoteMapping() : undefined;
  }

  handleMessage = (dt: number, message: MidiMessage) => {
    if (message[0] === MIDIIOController.MIDI_NOTE_ON + MIDIIOController.MIDI_CHANNEL_DRUM_KIT_CONTROL) {
      if (this.isRandomized) {
        this.changeKit(MIDIIOController.KIT_NUMBER_DEFAULT, false);
        const note = this.noteMapping ? this.noteMapping[message[1]] : getRandomNote();
        this.output?.send([message[0], note, message[2]]);
        this.changeKit(MIDIIOController.KIT_NUMBER_ALL_MUTED, false);
      }
      this.broadcast?.({ type: 'midi_note_on', note: message[1], velocity: message[2] });
    } else if (message[0] === MIDIIOController.MIDI_PROGRAM_SELECT + MIDIIOController.MIDI_CHANNEL_DRUM_KIT_CONTROL) {
      this.previousKitNumber = this.selectedKitNumber;
      this.selectedKitNumber = message[1] + 1;
    }
  };
}
