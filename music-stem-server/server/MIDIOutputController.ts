import midi from 'midi';

export default class MIDIOutputController {
  private bus: midi.Output;

  private static KIT_ID_DEFAULT = 47;
  private static KIT_ID_NO_TOMS = 90;
  private static KIT_ID_NO_CYMBALS = 91;

  constructor(deviceName: string = 'TD-30') {
    this.bus = new midi.Output();
    let midiOutputPort = 0;
    for (let i = 0; i < this.bus.getPortCount(); i++) {
      if (this.bus.getPortName(i).match(deviceName)) {
        midiOutputPort = i;
        break;
      }
    }
    this.bus.openPort(midiOutputPort);
    process.on('beforeExit', () => this.bus.closePort());
  }

  playNote(note: number, velocity: number = 0x7f) {
    this.bus.sendMessage([0x92, note, velocity]);
  }

  changeKit(kitNumber: number) {
    this.bus.sendMessage([0xc9, kitNumber - 1, 0]);
  }

  resetKit() {
    this.changeKit(MIDIOutputController.KIT_ID_DEFAULT);
  }

  muteToms() {
    this.changeKit(MIDIOutputController.KIT_ID_NO_TOMS);
  }

  muteCymbals() {
    this.changeKit(MIDIOutputController.KIT_ID_NO_CYMBALS);
  }
}
