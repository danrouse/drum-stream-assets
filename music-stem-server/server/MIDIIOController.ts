import midi, { MidiMessage } from 'midi';
import { WebSocketBroadcaster } from '../../shared/messages';

export default class MIDIIOController {
  private input: midi.Input;
  private output: midi.Output;
  private broadcast: WebSocketBroadcaster;

  private static KIT_ID_DEFAULT = 47;
  private static KIT_ID_NO_TOMS = 90;
  private static KIT_ID_NO_CYMBALS = 91;

  private static MIDI_NOTE_ON = 0x99;

  constructor(broadcast: WebSocketBroadcaster, deviceName: string = 'TD-30') {
    this.input = new midi.Input();
    let inputPort = 0;
    for (let i = 0; i < this.input.getPortCount(); i++) {
      if (this.input.getPortName(i).match(deviceName)) {
        inputPort = i;
        break;
      }
    }
    this.input.openPort(inputPort);
    this.input.on('message', this.handleMessage);

    this.output = new midi.Output();
    let outputPort = 0;
    for (let i = 0; i < this.output.getPortCount(); i++) {
      if (this.output.getPortName(i).match(deviceName)) {
        outputPort = i;
        break;
      }
    }
    this.output.openPort(outputPort);

    process.on('beforeExit', () => {
      this.output.closePort();
    });

    this.broadcast = broadcast;
  }

  playNote(note: number, velocity: number = 0x7f) {
    this.output.sendMessage([0x92, note, velocity]);
  }

  changeKit(kitNumber: number) {
    this.output.sendMessage([0xc9, kitNumber - 1, 0]);
  }

  resetKit() {
    this.changeKit(MIDIIOController.KIT_ID_DEFAULT);
  }

  muteToms() {
    this.changeKit(MIDIIOController.KIT_ID_NO_TOMS);
  }

  muteCymbals() {
    this.changeKit(MIDIIOController.KIT_ID_NO_CYMBALS);
  }

  handleMessage = (dt: number, message: MidiMessage) => {
    if (message[0] === MIDIIOController.MIDI_NOTE_ON) {
      this.broadcast({ type: 'midi_note_on', note: message[1], velocity: message[2] });
    }
  };
}
