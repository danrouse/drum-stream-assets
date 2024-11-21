
import initializeMIDIInput from './midi';
import { MIDINoteDisplayDefinition, midiNoteDefinitions, midiRimNotes, MIDI_TRIGGER_VELOCITY_MAX } from '../../../shared/midiNoteDefinitions';
import { beginCalibration } from './calibration';
import { load7tvEmotes } from '../../../shared/twitchEmotes';

// STUPID UTIL CRAP
const pascalCaseToKebabCase = (s: string) => s.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
    ?.join('-')
    .toLowerCase() || s;
const sleep = (t: number) => new Promise<void>((resolve) => setTimeout(() => resolve(), t));

const Z_INDEX_MAX = 10;

if (location.hash === '#MIDINotesWindow') {
  import('./style.css');

  // EMOTE STUFF
  const emotes7tv = await load7tvEmotes();
  const emoteURLs7tv = Object.values(emotes7tv);
  const EMOTE_RANDOM_SWAP_TIME = 5000;
  const EMOTE_USER_DURATION = 60000;
  let usedEmotes: string[][] = [];
  let selectedEmoteURL = emoteURLs7tv[Math.floor(Math.random() * emoteURLs7tv.length)];
  let defaultEmoteURL: string | undefined;
  setInterval(() => {
    if (usedEmotes.length) {
      // if there are any emotes used by users, use a random one
      // and ensure it is not the same as the previous (if applicable)
      const emotePool = Array.from(new Set(usedEmotes.flat()));
      let i: number;
      do {
        i = Math.floor(Math.random() * emotePool.length);
      } while (emotePool.length != 1 && selectedEmoteURL === emotePool[i]);
      selectedEmoteURL = emotePool[i];
    } else if (defaultEmoteURL) {
      selectedEmoteURL = defaultEmoteURL;
    } else {
      selectedEmoteURL = emoteURLs7tv[Math.floor(Math.random() * emoteURLs7tv.length)];
    }
  }, EMOTE_RANDOM_SWAP_TIME);
  window.ipcRenderer.on('emote_used', (_, payload) => {
    usedEmotes.push(payload.emoteURLs);
    setTimeout(() => {
      usedEmotes = usedEmotes.filter(emotes => emotes !== payload.emoteURLs);
    }, EMOTE_USER_DURATION);
  });
  window.ipcRenderer.on('emote_default_set', (_, payload) => {
    defaultEmoteURL = payload.emoteURL;
  });

  // ELEMENT INIT
  const globalContainerElem = document.body.querySelector<HTMLDivElement>('#app')!;
  const notesContainerElem = document.createElement('div');
  notesContainerElem.classList.add('notes');
  globalContainerElem.appendChild(notesContainerElem);

  // LOAD/SAVE CONFIG
  const LOCAL_STORAGE_KEY = 'noteconfig3';
  function saveConfig(config: MIDINoteDisplayDefinition[]) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
  }
  function loadConfig(): MIDINoteDisplayDefinition[] {
    const config: MIDINoteDisplayDefinition[] = midiNoteDefinitions.map(def => ({
      ...def,
      x: 100,
      y: 100,
      w: 100,
      h: 100,
      r: 0,
    }));
    const savedString = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedString) {
      const loadedDefs = JSON.parse(savedString) as MIDINoteDisplayDefinition[];
      return loadedDefs.map(def => {
        const baseDef = midiNoteDefinitions.find(n => n.name === def.name);
        return {...def, ...baseDef};
      });
    }
    return config;
  }
  const config = loadConfig();

  const existingNoteByType: { [key: number]: HTMLElement } = {};

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
      noteElem.classList.add(pascalCaseToKebabCase(`note-${noteConfig.name}`));
      noteElem.style.opacity = String((velocity + 25) / MIDI_TRIGGER_VELOCITY_MAX);
      noteElem.style.left = `${noteConfig.x}px`;
      noteElem.style.top = `${noteConfig.y}px`;
      noteElem.style.width = `${noteConfig.w}px`;
      noteElem.style.height = `${noteConfig.h}px`;
      noteElem.style.marginLeft = `-${noteConfig.w / 2}px`;
      noteElem.style.marginTop = `-${noteConfig.h / 2}px`;
      noteElem.style.backgroundColor = noteConfig.color;
      noteElem.style.backgroundImage = `url(${selectedEmoteURL})`;
      noteElem.style.transform = `rotate(${noteConfig.r}deg)`;
      noteElem.style.color = noteConfig.color;
      noteElem.style.zIndex = `${noteConfig.z}`;
      noteElem.innerText = noteConfig.name;
      if (midiRimNotes.includes(note)) {
        noteElem.classList.add('rim');
      }
      
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
  function renderTestNotes(animated: boolean =  true, velocity: number = MIDI_TRIGGER_VELOCITY_MAX) {
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
          .forEach(def => triggerNote(def.keys[0], MIDI_TRIGGER_VELOCITY_MAX, false));
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
