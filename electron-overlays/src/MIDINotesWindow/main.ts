
import initializeMIDIInput from './midi';
import { UserNoteDefinition, baseNotes } from './noteConfig';
import { beginCalibration } from './calibration';
import { loadEmotes } from '../../../shared/7tv';

// STUPID UTIL CRAP
const pascalCaseToKebabCase = (s: string) => s.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
    ?.join('-')
    .toLowerCase() || s;
const sleep = (t: number) => new Promise<void>((resolve) => setTimeout(() => resolve(), t));

const Z_INDEX_MAX = 10;

if (location.hash === '#MIDINotesWindow') {
  import('./style.css');

  // EMOTE STUFF
  const emotes = await loadEmotes();
  const emoteURLs = Object.values(emotes);
  let selectedEmote = emoteURLs[Math.floor(Math.random() * emoteURLs.length)];
  let hasUserEmote = false;
  let userEmoteResetTimer: NodeJS.Timeout | undefined;
  setInterval(() => {
    if (!hasUserEmote) {
      selectedEmote = emoteURLs[Math.floor(Math.random() * emoteURLs.length)];
    }
  }, 5000);
  window.ipcRenderer.on('emote_used', (_, payload) => {
    if (emotes[payload.emote]) {
      selectedEmote = emotes[payload.emote];
      hasUserEmote = true;
      if (userEmoteResetTimer) clearTimeout(userEmoteResetTimer);
      userEmoteResetTimer = setTimeout(() => hasUserEmote = false, 15000);
    }
  });

  // ELEMENT INIT
  const globalContainerElem = document.body.querySelector<HTMLDivElement>('#app')!;
  const notesContainerElem = document.createElement('div');
  notesContainerElem.classList.add('notes');
  globalContainerElem.appendChild(notesContainerElem);

  // LOAD/SAVE CONFIG
  const LOCAL_STORAGE_KEY = 'noteconfig2';
  function saveConfig(config: UserNoteDefinition[]) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
  }
  function loadConfig(): UserNoteDefinition[] {
    const config: UserNoteDefinition[] = baseNotes.map(def => ({
      ...def,
      x: 100,
      y: 100,
      w: 100,
      h: 100,
      r: 0,
    }));
    const savedString = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedString) {
      const loadedDefs = JSON.parse(savedString) as UserNoteDefinition[];
      return loadedDefs.map(def => {
        const baseDef = baseNotes.find(n => n.name === def.name);
        return {...def, ...baseDef};
      });
    }
    return config;
  }
  const config = loadConfig();

  const existingNoteByType: { [key: number]: HTMLElement } = {};

  // const NOTE_VELOCITY_MAX = 127;
  const VELOCITY_FULLY_OPAQUE = 100;
  const NOTE_ANIMATION_DURATION_MS = 2000;
  function triggerNote(note: number, velocity: number, animated: boolean = true, noteConfigs = config) {
    const selectedNoteConfigs = noteConfigs.filter(def => def.keys.includes(note));
    if (!selectedNoteConfigs.length) {
      console.warn('Unconfigured MIDI note', note);
      return;
    }

    if (existingNoteByType[note]) {
      existingNoteByType[note].remove();
      delete existingNoteByType[note];
    }

    for (let noteConfig of selectedNoteConfigs) {
      const noteElem = document.createElement('DIV');
      noteElem.classList.add('note');
      noteElem.classList.add(pascalCaseToKebabCase(`note-${name}`));
      noteElem.style.opacity = '1';//String((velocity + 25) / VELOCITY_FULLY_OPAQUE);
      noteElem.style.left = `${noteConfig.x}px`;
      noteElem.style.top = `${noteConfig.y}px`;
      noteElem.style.width = `${noteConfig.w}px`;
      noteElem.style.height = `${noteConfig.h}px`;
      noteElem.style.marginLeft = `-${noteConfig.w / 2}px`;
      noteElem.style.marginTop = `-${noteConfig.h / 2}px`;
      noteElem.style.backgroundColor = noteConfig.color;
      // noteElem.style.backgroundImage = `url(${selectedEmote})`;
      noteElem.style.transform = `rotate(${noteConfig.r}deg)`;
      noteElem.style.zIndex = `${noteConfig.z}`;
      noteElem.innerText = noteConfig.name;
      
      const maskContainer = document.createElement('div');
      maskContainer.classList.add('note-container');
      maskContainer.style.maskImage = `url('/mask-${Math.min(noteConfig.z + 1, Z_INDEX_MAX)}.png')`;
      maskContainer.appendChild(noteElem);
      notesContainerElem.appendChild(maskContainer);

      existingNoteByType[note] = maskContainer;
      if (animated) {
        noteElem.classList.add('animated');
        setTimeout(() => maskContainer.remove(), NOTE_ANIMATION_DURATION_MS);
      }
    }
  }

  function clearNotes() {
    notesContainerElem.innerHTML = '';
  }
  function renderTestNotes(animated: boolean =  true, velocity: number = VELOCITY_FULLY_OPAQUE) {
    clearNotes();
    config.forEach(def => triggerNote(def.keys[0], velocity, animated));
  }

  async function generateMask() {
    globalContainerElem.classList.add('mask');
    window.ipcRenderer.send('generate_mask', -1);
    window.ipcRenderer.on('generate_mask_complete', async (_, i) => {
      clearNotes();
      if (i < Z_INDEX_MAX) {
        config
          .filter(def => def.z > i)
          .forEach(def => triggerNote(def.keys[0], VELOCITY_FULLY_OPAQUE, false));
        await sleep(500);
        window.ipcRenderer.send('generate_mask', i + 1);
      } else {
        globalContainerElem.classList.remove('mask');
        window.ipcRenderer.send('generate_mask_finalize');
        clearNotes();
      }
    });
  }

  
  window.addEventListener('keydown', async (event) => {
    if (event.key === 'w') {
      renderTestNotes(true);
    } else if (event.key === 's') {
      renderTestNotes(false);
    } else if (event.key === ' ') {
      clearNotes();
      await beginCalibration(
        globalContainerElem,
        config,
        triggerNote,
        clearNotes,
        async (cfg) => {
          saveConfig(cfg);
          await generateMask();
        },
      );
    } else {
      console.info('Unhandled key press', event.key);
    }
  });


  initializeMIDIInput(triggerNote);
  // renderTestNotes(false);
  
  // window.onerror = (error, url, line) => window.ipcRenderer.send('error', { error, url, line });
}
