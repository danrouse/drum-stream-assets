import initializeCamera from './camera';
import { MIDINoteDisplayDefinition, MIDI_TRIGGER_VELOCITY_MAX } from '../../../shared/midiNoteDefinitions';

let isFrameHandlerActive = false;
let currentNoteIndex = -1;

function createAdjustmentButtons(
  config: MIDINoteDisplayDefinition[],
  renderNote: (key: number, velocity: number, animated: boolean, configs: MIDINoteDisplayDefinition[]) => void,
  clearNotes: () => void,
) {
  const containerElem = document.createElement('div');
  
  const createAdjustmentButton = (symbol: string, attr: keyof MIDINoteDisplayDefinition, getVal: (k: number) => number) => {
    const button = document.createElement('button');
    button.innerText = symbol;
    button.addEventListener('click', () => {
      config[currentNoteIndex][attr] = getVal(config[currentNoteIndex][attr]);
      clearNotes();
      renderNote(config[currentNoteIndex].keys[0], 1000, false, config);
    });

    button.addEventListener('mousedown', () => button.dataset.isActive = '1');
    button.addEventListener('mouseup', () => button.dataset.isActive = undefined);
    containerElem.appendChild(button);
    return button;
  };

  const buttons = [
    createAdjustmentButton('↺', 'r', r => r - 0.5),
    createAdjustmentButton('↻', 'r', r => r + 0.5),
    
    createAdjustmentButton('w+', 'w', w => w + 1),
    createAdjustmentButton('w-', 'w', w => w - 1),
    createAdjustmentButton('h+', 'h', h => h + 1),
    createAdjustmentButton('h-', 'h', h => h - 1),

    createAdjustmentButton('←', 'x', x => x - 1),
    createAdjustmentButton('→', 'x', x => x + 1),
    createAdjustmentButton('↓', 'y', y => y + 1),
    createAdjustmentButton('↑', 'y', y => y - 1),
  ];
  const frameHandler = () => {
    for (let button of buttons) {
      const framesHeldDown = Number(button.dataset.isActive);
      if (!isNaN(framesHeldDown)) {
        if (framesHeldDown > 30) {
          button.dispatchEvent(new Event('click'));
        }
        button.dataset.isActive = String(framesHeldDown + 1);
      }
    }

    if (isFrameHandlerActive) requestAnimationFrame(frameHandler);
  };
  requestAnimationFrame(frameHandler);

  return containerElem;
}

export async function beginCalibration(
  globalContainerElem: HTMLElement,
  config: MIDINoteDisplayDefinition[],
  renderNote: (key: number, velocity: number, animated: boolean, configs: MIDINoteDisplayDefinition[]) => void,
  clearNotes: () => void,
  onComplete: (config: MIDINoteDisplayDefinition[]) => void,
  cameraId: string,
) {
  let video: HTMLVideoElement;
  try {
    video = await initializeCamera(globalContainerElem, cameraId);
  } catch (e) {
    alert('Failed to initialize camera for calibration!')
    return false;
  }

  const uiContainerElem = document.createElement('DIV');
  uiContainerElem.classList.add('ui');
  uiContainerElem.innerHTML = '<h2>Set Drum Position</h2>';
  const statusTextElem = document.createElement('P');
  uiContainerElem.appendChild(statusTextElem);
  globalContainerElem.appendChild(uiContainerElem);

  isFrameHandlerActive = true;
  globalContainerElem.classList.add('calibrating');
  window.ipcRenderer.send('enable_mouse');

  function calibrationKeyHandler(event: KeyboardEvent) {
    if (event.key === 'd') next();
  }
  window.addEventListener('keydown', calibrationKeyHandler);

  function finishCalibration() {
    for (let track of (video.srcObject as MediaStream)!.getTracks()) {
      track.stop();
    }

    video.remove();
    uiContainerElem.remove();

    isFrameHandlerActive = false;
    globalContainerElem.classList.remove('calibrating');
    window.ipcRenderer.send('disable_mouse');
    window.removeEventListener('keydown', calibrationKeyHandler);

    onComplete(config);
    clearNotes();
  }

  function next() {
    currentNoteIndex += 1;
    if (currentNoteIndex >= config.length) {
      finishCalibration();
    } else {
      statusTextElem.innerText = config[currentNoteIndex].name;
      clearNotes();
      renderNote(config[currentNoteIndex].keys[0], MIDI_TRIGGER_VELOCITY_MAX, false, config);
    }
  }

  video.addEventListener('contextmenu', () => finishCalibration());

  const buttons = createAdjustmentButtons(config, renderNote, clearNotes);
  uiContainerElem.appendChild(buttons);

  next();
}

