import initializeCamera from './camera';
import initializeMIDIInput from './midi';
import { loadEmotes } from './7tv';

if (location.hash === '#MIDINotesWindow') {
  import('./style.css');

  const emotes = await loadEmotes();
  const emoteURLs = Object.values(emotes);
  let selectedEmote = emoteURLs[Math.floor(Math.random() * emoteURLs.length)];
  setInterval(() => {
    selectedEmote = emoteURLs[Math.floor(Math.random() * emoteURLs.length)];
    console.log('selected emote is now', selectedEmote);
  }, 5000);

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
    r: number;
    color: string;
    rim?: boolean;
    base?: string;
    kick?: true;
    z?: number,
  }

  let noteConfig: { [key: number]: NoteConfig } = {
    38: { name: 'Snare', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(223, 25, 25)', z: 7,},
    37: { name: 'SnareCrossStick', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(223, 25, 25)', rim: true, base: 'Snare', },
    40: { name: 'SnareRim', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(223, 25, 25)', rim: true, base: 'Snare', },

    48: { name: 'Tom1', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(94 120 231)', z: 6 },
    50: { name: 'Tom1Rim', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(94 120 231)', rim: true, base: 'Tom1', },
    45: { name: 'Tom2', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(94 201 231)', z: 5 },
    47: { name: 'Tom2Rim', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(94 201 231)', rim: true, base: 'Tom2', },
    43: { name: 'Tom3', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(77 218 134)', z: 4 },
    58: { name: 'Tom3Rim', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(77 218 134)', rim: true, base: 'Tom3', },
    41: { name: 'Tom4', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(60 145 40)', z: 3 },
    39: { name: 'Tom4Rim', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(60 145 40)', rim: true, base: 'Tom4', },

    26: { name: 'HiHatEdge', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(206 179 57)', z: 8, }, //rgb(249 231 94)
    46: { name: 'HiHatBow', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(206 179 57)', z: 8, base: 'HiHatEdge' },
    44: { name: 'HiHatPedal', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(206 179 57)', base: 'HiHatEdge', rim: true, },

    49: { name: 'Crash1', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(248 16 138)', z: 9, },
    52: { name: 'Crash2Edge', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(209 102 255)', z: 1 },
    57: { name: 'Crash2Bow', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'rgb(209 102 255)', base: 'Crash2Edge' },
    51: { name: 'Ride', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'orangered', z: 1 },
    53: { name: 'RideBell', x: 0, y: 0, w: 120, h: 32, r: 0, color: 'orangered', rim: true, base: 'Ride', },
    
    36: { name: 'Kick', x: 0, y: 0, w: 120, h: 32, r: 0, color: '#444', kick: true, z: 2, }, // #111
    360: { name: 'Kick Secondary', x: 0, y: 0, w: 120, h: 32, r: 0, color: '#444', kick: true, z: 2, },

    28: { name: 'Splash', x: 0, y: 0, w: 120, h: 32, r: 0, color: '#aaa', z: 5 },
  };
  // Dirty way of allowing for multiple notes per key
  const noteKeyAliases: { [key: number]: number } = {
    36: 360,
  };

  const existingNoteByType: { [key: number]: HTMLElement } = {};

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

    if (existingNoteByType[note]) {
      existingNoteByType[note].remove();
      delete existingNoteByType[note];
    }

    // exception for broken crash2 :(
    // if ((name === 'Crash2Edge' || name === 'Crash2Bow') && velocity < 40) return;
    
    // console.info('Trigger note', note, name, pascalCaseToKebabCase(`note-${name}`), velocity);
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
    noteElem.style.backgroundImage = `url(${selectedEmote})`;
    noteElem.style.transform = `rotate(${selectedNote.r}deg)`;
    if (selectedNote.z) noteElem.style.zIndex = `${selectedNote.z}`;
    noteElem.innerText = name;
    if (animated) {
      noteElem.classList.add('animated');
      setTimeout(() => noteElem.remove(), NOTE_ANIMATION_DURATION_MS);
    }
    // notesContainerElem.appendChild(noteElem);
    const container = document.createElement('div');
    container.classList.add('note-container');
    container.style.maskImage = `url('/mask-${Math.min((selectedNote.z || 0) + 1, 10)}.png')`;
    container.appendChild(noteElem);
    notesContainerElem.appendChild(container);
    existingNoteByType[note] = container;

    if (noteKeyAliases[note]) triggerNote(noteKeyAliases[note], velocity, animated);
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

  window.ipcRenderer.on('generate_mask_complete', (_, i) => {
    if (i === 10) {
      document.body.classList.remove('mask');
    }
    clearNotes();
  });
  async function beginCalibration() {
    let video: HTMLVideoElement;
    try {
      video = await initializeCamera(globalContainerElem!);
    } catch (e) {
      alert('Failed to initialize camera for calibration!')
      return false;
    }
    window.ipcRenderer.send('enable_mouse');
    let isCalibrating = true;

    uiContainerElem.innerHTML = '<h2>Set Drum Position</h2>';
    const statusTextElem = document.createElement('P');
    uiContainerElem.appendChild(statusTextElem);
    document.body.classList.add('calibrating');

    async function cleanup() {
      for (let track of (video.srcObject as MediaStream)!.getTracks()) {
        track.stop();
      }
      video.remove();
      uiContainerElem.innerHTML = '';
      saveConfig();
      clearNotes();
      window.removeEventListener('keydown', keyHandler);
      window.ipcRenderer.send('disable_mouse');
      document.body.classList.remove('calibrating');
      isCalibrating = false;

      const sleep = (t: number) => new Promise<void>((resolve) => setTimeout(() => resolve(), t));
      for (let i = 0; i <= 10; i++) {
        document.body.classList.add('mask');
        clearNotes();
        Object.keys(noteConfig).forEach(k => {
          console.log(i, k, noteConfig[Number(k)].z)
          if (noteConfig[Number(k)].z !== undefined && noteConfig[Number(k)].z! >= i) {
            triggerNote(Number(k), VELOCITY_FULLY_OPAQUE, false);
          }
        });
        setTimeout(() => {
          window.ipcRenderer.send('generate_mask', i);
        }, 50);
        await sleep(250);
      }
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
        clearNotes();
        triggerNote(Number(noteKeys[currentNoteIndex]), VELOCITY_FULLY_OPAQUE / 2, false);
      }
    }

    const setConfigForAllNotesFromBase = (index: number, config: Partial<NoteConfig>) => {
      [
        noteConfig[Number(noteKeys[index])],
        ...Object.values(noteConfig).filter(selectedNoteConfig =>
          selectedNoteConfig.base === noteConfig[Number(noteKeys[index])].name
        )
      ].forEach((selectedNoteConfig) => {
        let k: keyof NoteConfig;
        for (k in config) {
          selectedNoteConfig[k] = config[k];
        }
      });
      clearNotes();
      triggerNote(Number(noteKeys[currentNoteIndex]), VELOCITY_FULLY_OPAQUE / 2, false);
    };

    video.addEventListener('click', (event: MouseEvent) => {
      const videoSize = video.getBoundingClientRect();
      setConfigForAllNotesFromBase(currentNoteIndex, {
        x: event.x / videoSize.width,
        y: event.y / videoSize.height,
      });
      clearNotes();
      triggerNote(Number(noteKeys[currentNoteIndex]), VELOCITY_FULLY_OPAQUE / 2, false);
    });
    video.addEventListener('contextmenu', () => cleanup());

    const buttonsContainerElem = document.createElement('div');

    const createAdjustmentButton = (symbol: string, attr: keyof NoteConfig, getVal: (k: number) => number) => {
      const button = document.createElement('button');
      button.innerText = symbol;
      button.addEventListener('click', () => {
        setConfigForAllNotesFromBase(currentNoteIndex, {
          [attr]: getVal(Number(noteConfig[Number(noteKeys[currentNoteIndex])][attr])),
        });
      });
      button.addEventListener('mousedown', () => {
        button.dataset.isActive = '1';
      });
      button.addEventListener('mouseup', () => {
        button.dataset.isActive = undefined;
      });
      buttonsContainerElem.appendChild(button);
      return button;
    }

    createAdjustmentButton('↺', 'r', r => r - 1);
    createAdjustmentButton('↻', 'r', r => r + 1);
    
    createAdjustmentButton('w+', 'w', w => w + 2);
    createAdjustmentButton('w-', 'w', w => w - 2);
    createAdjustmentButton('h+', 'h', h => h + 2);
    createAdjustmentButton('h-', 'h', h => h - 2);

    createAdjustmentButton('←', 'x', x => x - .001);
    createAdjustmentButton('→', 'x', x => x + .001);
    createAdjustmentButton('↓', 'y', y => y + .001);
    createAdjustmentButton('↑', 'y', y => y - .001);
   
    uiContainerElem.appendChild(buttonsContainerElem);

    function keyHandler(event: KeyboardEvent) {
      if (event.key === 'd') next();
    }
    window.addEventListener('keydown', keyHandler);
    
    const frameHandler = () => {
      for (let button of document.getElementsByTagName('button')) {
        const framesHeldDown = Number(button.dataset.isActive);
        if (!isNaN(framesHeldDown)) {
          if (framesHeldDown > 30) {
            button.dispatchEvent(new Event('click'));
          }
          button.dataset.isActive = String(framesHeldDown + 1);
        }
      }

      if (isCalibrating) requestAnimationFrame(frameHandler);
    };
    requestAnimationFrame(frameHandler);

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
        noteConfig[key] = { ...noteConfig[key], ...(config[key] || {}), color: noteConfig[key].color, z: noteConfig[key].z };
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
  // renderTestNotes(false);

  window.onerror = (error, url, line) => window.ipcRenderer.send('error', { error, url, line });
}
