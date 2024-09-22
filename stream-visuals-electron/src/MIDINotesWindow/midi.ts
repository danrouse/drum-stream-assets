const MIDI_EVENT_SYSTEM   = 0b1111;
const MIDI_EVENT_NOTE_OFF = 0b1000;
const MIDI_EVENT_NOTE_ON  = 0b1001;

function handleMIDIMessage(handler: (note: number, velocity: number) => void, event: MIDIMessageEvent) {
  const [eventType, note, velocity] = event.data || [];
  if (!eventType) return;
  switch (eventType >> 4) {
    // case MIDI_EVENT_SYSTEM: // system event
    // case MIDI_EVENT_NOTE_OFF: // note off
    case MIDI_EVENT_NOTE_ON: // note on
    handler(note, velocity);
  }
}

export default async function initializeMIDIInput(handler: (note: number, velocity: number) => void) {
  const registerMIDIDevice = (input: MIDIInput) => {
    input.addEventListener('midimessage', handleMIDIMessage.bind(input, handler));
  };

  var midiAccess = await navigator.requestMIDIAccess();
  midiAccess.inputs.forEach(input => registerMIDIDevice(input));
  midiAccess.addEventListener('statechange', (event: Event) => {
    const port = (event as MIDIConnectionEvent).port;
    if (port?.state === 'connected') {
      console.log('MIDI device connected', port);
      registerMIDIDevice(port as MIDIInput);
    } else {
      console.log('MIDI device disconnected', port);
    }
  });
}
