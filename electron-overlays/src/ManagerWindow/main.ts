interface WindowState {
  [key: string]: boolean;
}

// Window state tracking
const windowStates: WindowState = {
  'midi-ride': false,
  'midi-overhead': false,
  'now-playing': false,
  'synced-lyrics': false,
  'audio-display': false,
  'song-history': false,
  'drum-triggers': false,
  'guess-the-song': false,
  'heart-rate': false,
  'gamba': false,
  'wheel': false,
};

// localStorage functions for window preferences
function saveWindowPreference(windowKey: string, includeInOpenAll: boolean) {
  localStorage.setItem(`window-${windowKey}-include-in-open-all`, includeInOpenAll.toString());
}

function getWindowPreference(windowKey: string): boolean {
  const saved = localStorage.getItem(`window-${windowKey}-include-in-open-all`);
  return saved !== null ? saved === 'true' : true; // Default to true if not set
}

function getWindowsToOpenAll(): string[] {
  return Object.keys(windowStates).filter(windowKey => getWindowPreference(windowKey));
}

// Update UI based on window state
function updateWindowStatus(windowKey: string, isOpen: boolean) {
  const statusElement = document.getElementById(`status-${windowKey}`);
  if (statusElement) {
    statusElement.textContent = isOpen ? 'Open' : 'Closed';
    statusElement.className = `status ${isOpen ? 'open' : 'closed'}`;
  }

  // Update button states
  const openBtn = document.querySelector(`[data-window="${windowKey}"].btn-open`) as HTMLButtonElement;
  const closeBtn = document.querySelector(`[data-window="${windowKey}"].btn-close`) as HTMLButtonElement;
  const restartBtn = document.querySelector(`[data-window="${windowKey}"].btn-restart`) as HTMLButtonElement;

  if (openBtn) openBtn.disabled = isOpen;
  if (closeBtn) closeBtn.disabled = !isOpen;
  if (restartBtn) restartBtn.disabled = !isOpen;

  windowStates[windowKey] = isOpen;
}

// Initialize UI
function initializeUI() {
  // Set all windows as closed initially
  Object.keys(windowStates).forEach(windowKey => {
    updateWindowStatus(windowKey, false);

    // Load and set checkbox state from localStorage
    const checkbox = document.querySelector(`[data-window="${windowKey}"].include-in-open-all`) as HTMLInputElement;
    if (checkbox) {
      checkbox.checked = getWindowPreference(windowKey);
    }
  });
}

// IPC Communication setup
function setupIPC() {
  // Listen for window state updates from main process
  ipcRenderer.on('window-state-change', (event: any, windowKey: string, isOpen: boolean) => {
    updateWindowStatus(windowKey, isOpen);
  });

  // Request initial window states
  ipcRenderer.send('request-window-states');
}

// Event handlers
function setupEventHandlers() {
  // Individual window controls
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    if (target.classList.contains('btn-open')) {
      const windowKey = target.getAttribute('data-window');
      if (windowKey) {
        ipcRenderer.send('open-window', windowKey);
      }
    }

    if (target.classList.contains('btn-close')) {
      const windowKey = target.getAttribute('data-window');
      if (windowKey) {
        ipcRenderer.send('close-window', windowKey);
      }
    }

    if (target.classList.contains('btn-restart')) {
      const windowKey = target.getAttribute('data-window');
      if (windowKey) {
        ipcRenderer.send('restart-window', windowKey);
      }
    }
  });

  // Handle checkbox changes for "include in open all" preferences
  document.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;

    if (target.classList.contains('include-in-open-all')) {
      const windowKey = target.getAttribute('data-window');
      if (windowKey) {
        saveWindowPreference(windowKey, target.checked);
      }
    }
  });

  // Global controls
  const openAllBtn = document.getElementById('open-all');
  const closeAllBtn = document.getElementById('close-all');
  const restartAllBtn = document.getElementById('restart-all');

      if (openAllBtn) {
    openAllBtn.addEventListener('click', () => {
      const windowsToOpen = getWindowsToOpenAll();
      windowsToOpen.forEach(windowKey => {
        ipcRenderer.send('open-window', windowKey);
      });
    });
  }

  if (closeAllBtn) {
    closeAllBtn.addEventListener('click', () => {
      ipcRenderer.send('close-all-windows');
    });
  }

  if (restartAllBtn) {
    restartAllBtn.addEventListener('click', () => {
      const windowsToRestart = getWindowsToOpenAll();
      windowsToRestart.forEach(windowKey => {
        ipcRenderer.send('restart-window', windowKey);
      });
    });
  }
}

// Initialize everything when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  initializeUI();
  setupIPC();
  setupEventHandlers();
});

// Use direct type assertion instead of global declaration to avoid module issues
const { ipcRenderer } = (window as any);
