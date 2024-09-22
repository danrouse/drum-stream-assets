import initializeCamera from './camera';
import initializeMIDIInput from './midi';

if (location.hash === '#MIDINotesWindow') {
  import('./style.css');

  const globalContainerElem = document.body.querySelector<HTMLDivElement>('#app')!;

  const notesContainerElem = document.createElement('DIV');
  notesContainerElem.classList.add('notes');
  globalContainerElem.appendChild(notesContainerElem);

  const uiContainerElem = document.createElement('DIV');
  uiContainerElem.classList.add('ui');
  globalContainerElem.appendChild(uiContainerElem);


  const pascalCaseToKebabCase = (s: string) => s.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
    ?.join('-')
    .toLowerCase() || s;

  interface NoteConfig {
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
    color: string;
    rim?: boolean;
    base?: string;
    kick?: true;
  }

  let noteConfig: { [key: number]: NoteConfig } = {
    38: { name: 'Snare', x: 0, y: 0, w: 120, h: 32, color: 'rgb(223, 25, 25)', },
    37: { name: 'SnareCrossStick', x: 0, y: 0, w: 120, h: 32, color: 'rgb(223, 25, 25)', rim: true, base: 'Snare', },
    40: { name: 'SnareRim', x: 0, y: 0, w: 120, h: 32, color: 'rgb(223, 25, 25)', rim: true, base: 'Snare', },

    48: { name: 'Tom1', x: 0, y: 0, w: 120, h: 32, color: 'rgb(94 120 231)', },
    50: { name: 'Tom1Rim', x: 0, y: 0, w: 120, h: 32, color: 'rgb(94 120 231)', rim: true, base: 'Tom1', },
    45: { name: 'Tom2', x: 0, y: 0, w: 120, h: 32, color: 'rgb(94 201 231)', },
    47: { name: 'Tom2Rim', x: 0, y: 0, w: 120, h: 32, color: 'rgb(94 201 231)', rim: true, base: 'Tom2', },
    43: { name: 'Tom3', x: 0, y: 0, w: 120, h: 32, color: 'rgb(77 218 134)', },
    58: { name: 'Tom3Rim', x: 0, y: 0, w: 120, h: 32, color: 'rgb(77 218 134)', rim: true, base: 'Tom3', },
    41: { name: 'Tom4', x: 0, y: 0, w: 120, h: 32, color: 'rgb(60 145 40)', },
    39: { name: 'Tom4Rim', x: 0, y: 0, w: 120, h: 32, color: 'rgb(60 145 40)', rim: true, base: 'Tom4', },

    26: { name: 'HiHatEdge', x: 0, y: 0, w: 120, h: 32, color: 'rgb(249 231 94)', },
    46: { name: 'HiHatBow', x: 0, y: 0, w: 120, h: 32, color: 'rgb(249 231 94)', base: 'HiHatEdge' },
    44: { name: 'HiHatPedal', x: 0, y: 0, w: 120, h: 32, color: 'rgb(249 231 94)', rim: true, },

    49: { name: 'Crash1', x: 0, y: 0, w: 120, h: 32, color: 'rgb(248 16 138)', },
    52: { name: 'Crash2Edge', x: 0, y: 0, w: 120, h: 32, color: 'rgb(209 102 255)', },
    57: { name: 'Crash2Bow', x: 0, y: 0, w: 120, h: 32, color: 'rgb(209 102 255)', base: 'Crash2Edge' },
    51: { name: 'Ride', x: 0, y: 0, w: 120, h: 32, color: 'orangered', },
    53: { name: 'RideBell', x: 0, y: 0, w: 120, h: 32, color: 'orangered', rim: true, base: 'Ride', },
    
    36: { name: 'Kick', x: 0, y: 0, w: 120, h: 32, color: '#111', kick: true },
  };

  // const NOTE_VELOCITY_MAX = 127;
  const VELOCITY_FULLY_OPAQUE = 100;
  const NOTE_ANIMATION_DURATION_MS = 2000;
  function triggerNote(note: number, velocity: number, animated: boolean = true) {
    const selectedNote = noteConfig[note];
    if (!selectedNote) {
      console.warn('Unconfigured MIDI note', note);
      return;
    }

    const { name } = selectedNote;

    // exception for broken crash2 :(
    // if ((name === 'Crash2Edge' || name === 'Crash2Bow') && velocity < 40) return;
    
    console.info('Trigger note', note, name, pascalCaseToKebabCase(`note-${name}`), velocity);
    const noteElem = document.createElement('DIV');
    noteElem.classList.add('note');
    noteElem.classList.add(pascalCaseToKebabCase(`note-${name}`));
    if (selectedNote.rim) noteElem.classList.add('rim');
    noteElem.style.opacity = String((velocity + 25) / VELOCITY_FULLY_OPAQUE);
    noteElem.style.left = `${selectedNote.x * 100}%`;
    noteElem.style.top = `${selectedNote.y * 100}%`;
    noteElem.style.width = `${selectedNote.w}px`;
    noteElem.style.height = `${selectedNote.h}px`;
    noteElem.style.marginLeft = `-${selectedNote.w / 2}px`;
    noteElem.style.marginTop = `-${selectedNote.h / 2}px`;
    noteElem.style.backgroundColor = selectedNote.color;
    noteElem.innerText = name;
    if (animated) {
      noteElem.classList.add('animated');
      setTimeout(() => noteElem.remove(), NOTE_ANIMATION_DURATION_MS);
    }
    
    notesContainerElem.appendChild(noteElem);
  }

  function clearNotes() {
    for (let elem of document.querySelectorAll('.note')) {
      elem.remove();
    }
  }
  function renderTestNotes(animated: boolean =  true, velocity: number = VELOCITY_FULLY_OPAQUE) {
    clearNotes();
    Object.keys(noteConfig).forEach(k => triggerNote(Number(k), velocity, animated));
  }

  async function beginCalibration() {
    let video: HTMLVideoElement;
    try {
      video = await initializeCamera(globalContainerElem!);
    } catch (e) {
      alert('Failed to initialize camera for calibration!')
      return false;
    }

    uiContainerElem.innerHTML = '<h2>Set Drum Position</h2>';
    const statusTextElem = document.createElement('P');
    uiContainerElem.appendChild(statusTextElem);

    function cleanup() {
      for (let track of (video.srcObject as MediaStream)!.getTracks()) {
        track.stop();
      }
      video.remove();
      uiContainerElem.innerHTML = '';
      saveConfig();
      clearNotes();
      window.removeEventListener('keydown', keyHandler);
    }

    const noteKeys = Object.keys(noteConfig).sort((a, b) => noteConfig[Number(a)].name.localeCompare(noteConfig[Number(b)].name));
    let currentNoteIndex = -1; // start at 0 since it will get incremented by initial call to next()
    function next() {
      currentNoteIndex += 1;
      if (currentNoteIndex >= noteKeys.length) {
        cleanup();
      } else if (noteConfig[Number(noteKeys[currentNoteIndex])].base) {
        next();
      } else {
        const selectedNoteConfig = noteConfig[Number(noteKeys[currentNoteIndex])];
        statusTextElem.innerText = `${selectedNoteConfig.name}`;
        renderTestNotes(false);
      }
    }

    video.addEventListener('click', (event: MouseEvent) => {
      const videoSize = video.getBoundingClientRect();
      [
        noteConfig[Number(noteKeys[currentNoteIndex])],
        ...Object.values(noteConfig).filter(selectedNoteConfig =>
          selectedNoteConfig.base === noteConfig[Number(noteKeys[currentNoteIndex])].name
        )
      ].forEach((selectedNoteConfig) => {
        selectedNoteConfig.x = event.x / videoSize.width;
        selectedNoteConfig.y = event.y / videoSize.height;
      });

      next();
    });
    video.addEventListener('contextmenu', () => cleanup());

    function keyHandler(event: KeyboardEvent) {
      if (event.key === 'd') next();
    }
    window.addEventListener('keydown', keyHandler);
      

    next();
  }

  function saveConfig() {
    localStorage.setItem('noteConfig', JSON.stringify(noteConfig));
  }
  function loadConfig() {
    const savedString = localStorage.getItem('noteConfig');
    if (savedString) {
      const config = JSON.parse(savedString);
      noteConfig = { ...noteConfig };
      for (let key in noteConfig) {
        noteConfig[key] = { ...noteConfig[key], ...(config[key] || {}), color: noteConfig[key].color };
      }
    }
  }


  window.addEventListener('keydown', async (event) => {
    if (event.key === 'w') {
      renderTestNotes(true);
    } else if (event.key === 's') {
      renderTestNotes(false);
    } else if (event.key === ' ') {
      await beginCalibration();
    } else {
      console.info('Unhandled key press', event.key);
    }
  });


  //
  // actual initialization
  //

  initializeMIDIInput(triggerNote);
  loadConfig();
  // renderTestNotes();

  // TODO: periodically poll for access to midi device, attempt to reinitialize if lost
  // setInterval(() => initializeMIDIInput(triggerNote), 500);
  window.onerror = (error, url, line) => window.ipcRenderer.send('error', { error, url, line });
}
