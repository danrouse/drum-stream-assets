import { SongRequestData, StreamerbotViewer } from '../../../shared/messages';

interface SongRequester {
  name: string;
  fulfilledToday: number;
  currentBumpCount: number;
  lastFulfilledAt: string | null;
  oldestRequestAge: number;
  requests: SongRequestData[];
}

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

const WHEEL_CONFIG = {
  VIEWBOX_SIZE: 400,
  RADIUS: 180,
  TEXT_RADIUS_MULTIPLIER: 0.55,
} as const;

const BORDER_CONFIG = {
  OUTER_BORDER_WIDTH: 10,
  INNER_BORDER_WIDTH: 3,
  OUTER_BORDER_COLOR: '#2a2a2a',
  INNER_BORDER_COLOR: '#444444',
  LIGHT_COUNT: 50,
  LIGHT_RADIUS: 3,
  LIGHT_DISTANCE_FROM_CENTER: 185,
  LIGHT_COLORS: {
    active: '#ffff00',
    inactive: '#666666'
  },
  ANIMATION_DURATION_S: 3
} as const;

const ANIMATION_CONFIG = {
  MIN_SPIN_DURATION_MS: 10000,
  MAX_SPIN_DURATION_MS: 15000,
  MIN_ROTATIONS: 5,
  MAX_ADDITIONAL_ROTATIONS: 3,
  TIMING_FUNCTION: 'cubic-bezier(0.17, 0.67, 0.12, 0.99)',
  WINNER_DELAY_MS: 2000,
} as const;

const POINTER_CONFIG = {
  TIP_X: 365,
  BASE_X: 380,
  TOP_Y: 190,
  BOTTOM_Y: 210,
  CENTER_Y: 200,
  FILL_COLOR: 'rgb(174, 170, 144)',
  STROKE_COLOR: '#2a2a2a',
  STROKE_WIDTH: '2'
} as const;

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

let currentRequesters: SongRequester[] = [];
let subscribedViewers: Set<string> = new Set();
let isSpinning = false;
let currentRotation = 0;
let animationFrameId: number | null = null;
let currentHighlightedSlice = -1;
let sliceColors: string[] = [];
let spinTimeoutId: NodeJS.Timeout | null = null;
let winnerTimeoutId: NodeJS.Timeout | null = null;

// Wheel mode state
let isHatWheelMode = false;
const ALL_HATS: string[] = [
  'Sloth',
  'Cow (NOT MILKERS STOP IT CHAT)',
  'Bun Bun',
  'Yoshi',
  'Penguin',
  // 'Fedora',
  // 'White Bucket Hat',
  'Ramen Bucket Hat',
  'Cat Bucket Hat',
  'Red Beret',
  'RainbowPoop',
  'Propeller',
  'Danny Crockett',
  'Cat Ears Beanie',
  'Sister Beanie',
  'Kirby',
  'Black Cat Ears',
  'White Cat Ears',
  '½',
  'Cowboy Hat',
  'Pink Sparkly Cowboy Hat',
  'Queen',
  'Taco',
  // 'Tiara',
];
const HAT_TIMEOUT_MS = 1000 * 60 * 60 * 12; // 12 hours
const selectionHistory: { item: string, time: Date }[] = [];

let currentSliceAngles: { startAngle: number; endAngle: number; scaleFactor: number }[] = [];

const userColors: Map<string, string> = new Map();

const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
const audioGainNode = audioContext.createGain();
audioGainNode.gain.value = 1;
audioGainNode.connect(audioContext.destination);
const audioFilterNode = audioContext.createBiquadFilter();
audioFilterNode.type = 'highpass';
audioFilterNode.frequency.value = 2000;
audioFilterNode.Q.value = 2;
audioFilterNode.connect(audioGainNode);

function playClickSound() {
  const duration = 0.05; // 50ms
  const bufferSize = audioContext.sampleRate * duration;
  const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const channelData = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    const envelope = Math.exp(-i / (bufferSize * 0.1));
    channelData[i] = ((Math.random() * 2 - 1) * 0.1) * envelope;
  }

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioFilterNode);
  source.start(audioContext.currentTime);
}

// =============================================================================
// DOM ELEMENTS
// =============================================================================

const globalContainer = document.getElementById('app')!;
globalContainer.classList.add('wheel-visible');

const svg = createSVGElement('svg', {
  class: 'wheel',
  viewBox: `0 0 ${WHEEL_CONFIG.VIEWBOX_SIZE} ${WHEEL_CONFIG.VIEWBOX_SIZE}`
});
globalContainer.appendChild(svg);

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function simpleStringHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

function generatePastelColor(seed?: string | null): string {
  const hash = simpleStringHash(seed?.toLowerCase() || Math.random().toString());

  // Use hash to generate deterministic but varied HSL values
  const hue = hash % 360;
  const saturation = (hash % 30) + 60; // Range: 60-89%
  const lightness = ((hash >> 8) % 20) + 70; // Range: 70-89%

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function getUserColor(name?: string | null): string {
  const userColor = name && userColors.get(name.toLowerCase());
  return userColor || generatePastelColor(name);
}

function createSVGElement(type: string, attributes: Record<string, string>): SVGElement {
  const element = document.createElementNS('http://www.w3.org/2000/svg', type);
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
  return element;
}

function createTemporaryTextElement(className: string, additionalAttributes: Record<string, string> = {}): SVGTextElement {
  const attributes = {
    class: className,
    style: 'visibility: hidden',
    ...additionalAttributes
  };
  return createSVGElement('text', attributes) as SVGTextElement;
}

// =============================================================================
// ANIMATION AND CLEANUP FUNCTIONS
// =============================================================================

function clearAllAnimationsAndTimeouts() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  [spinTimeoutId, winnerTimeoutId].forEach(timeoutId => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
  spinTimeoutId = winnerTimeoutId = null;
  stopWinnerLightShow();
}

function resetSelection() {
  currentHighlightedSlice = -1;
  svg.querySelector('.slice.selected')?.classList.remove('selected');
}

// =============================================================================
// WINNER ANNOUNCEMENT
// =============================================================================

function showWinnerAnnouncement(label: string, sublabel?: string) {
  const container = document.querySelector('#app')!;
  container.querySelector('.winner-announcement')?.remove();

  const announcement = document.createElement('div');
  announcement.className = 'winner-announcement';
  announcement.innerHTML = `
    <div class="winner-song">${label}</div>
    ${sublabel ? `<div class="winner-requester">${sublabel}</div>` : ''}
  `;

  container.appendChild(announcement);
}

// =============================================================================
// ROTATION AND HIGHLIGHTING
// =============================================================================

function getCurrentRotationFromDOM(): number {
  const wheelGroup = svg.querySelector('.wheel-group') as SVGElement;
  if (!wheelGroup) return 0;

  const computedStyle = getComputedStyle(wheelGroup);
  const transform = computedStyle.transform;

  if (transform === 'none') return 0;

  const matrixMatch = transform.match(/matrix\(([^)]+)\)/);
  if (matrixMatch) {
    const matrixValues = matrixMatch[1].split(',').map(v => parseFloat(v.trim()));
    if (matrixValues.length >= 4) {
      const [a, b] = matrixValues;
      const angleRad = Math.atan2(b, a);
      return (angleRad * 180) / Math.PI;
    }
  }

  return 0;
}

function getCurrentSliceUnderIndicator(): number {
  const currentDOMRotation = getCurrentRotationFromDOM();
  const effectiveRotation = currentDOMRotation % 360;
  const originalAngleAtIndicator = (-effectiveRotation + 90 + 360) % 360;

  // Find which slice the indicator angle falls into
  for (let i = 0; i < currentSliceAngles.length; i++) {
    const { startAngle, endAngle } = currentSliceAngles[i];
    if (originalAngleAtIndicator >= startAngle && originalAngleAtIndicator < endAngle) {
      return i;
    }
  }

  return -1;
}

function updateRealtimeHighlighting() {
  if (!isSpinning) return;

  const currentSliceIndex = getCurrentSliceUnderIndicator();

  if (currentSliceIndex !== currentHighlightedSlice) {
    playClickSound();

    svg.querySelector('.slice.selected')?.classList.remove('selected');
    svg.querySelector(`.slice:nth-of-type(${currentSliceIndex + 1})`)?.classList.add('selected');

    currentHighlightedSlice = currentSliceIndex;
  }

  animationFrameId = requestAnimationFrame(updateRealtimeHighlighting);
}

// =============================================================================
// GEOMETRY FUNCTIONS
// =============================================================================

function calculateSliceScale(requester: SongRequester): number {
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 3.0;
  const REDUCTION_PER_FULFILLED_REQUEST = 0.15;
  const REDUCTION_RECENTLY_FULFILLED = 0.5;
  const RECENTLY_FULFILLED_TIME_WINDOW = 1000 * 60 * 15; // 15 minutes
  const INCREASE_PER_BUMP = 0.2;
  const INCREASE_PER_HOUR = 1.0;
  const INCREASE_FIRST_REQUEST_RATE_BONUS = 2.0;
  const INCREASE_SUB_BONUS = 0.5;

  const timeSinceLastRequest = requester.lastFulfilledAt ?
    new Date().getTime() - new Date(requester.lastFulfilledAt).getTime() :
    Infinity;

  // reduce the size based on how many songs a requester has had fulfilled today
  const fulfilledPenalty = (requester.fulfilledToday || 0) * REDUCTION_PER_FULFILLED_REQUEST;

  // reduce the size for requesters that have recently had a song played
  const recentlyFulfilledPenalty = timeSinceLastRequest < RECENTLY_FULFILLED_TIME_WINDOW
    ? (1 - timeSinceLastRequest / RECENTLY_FULFILLED_TIME_WINDOW) * REDUCTION_RECENTLY_FULFILLED
    : 0;

  // increase size based on number of bumps (NTT wins)
  const bumpBonus = requester.currentBumpCount * INCREASE_PER_BUMP;

  // increase the size for requests based on their age
  const ageBonus = requester.oldestRequestAge
    ? requester.oldestRequestAge / (1000 * 60 * 60) * INCREASE_PER_HOUR
    : 0;

  // amplify the age bonus for someone's first request of the day
  const firstRequestBonus = requester.fulfilledToday === 0 ? INCREASE_FIRST_REQUEST_RATE_BONUS : 1.0;

  // increase the size of subscribers' requests
  const isSubscribed = subscribedViewers.has(requester.name.toLowerCase());

  const size = 1.0
    - fulfilledPenalty
    - recentlyFulfilledPenalty
    + (ageBonus * firstRequestBonus)
    + bumpBonus
    + (isSubscribed ? INCREASE_SUB_BONUS : 0);

  // clamp the final result
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, size));
}

function createPieSlice(startAngle: number, endAngle: number): string {
  const startAngleRad = ((startAngle - 90) * Math.PI) / 180;
  const endAngleRad = ((endAngle - 90) * Math.PI) / 180;
  const center = WHEEL_CONFIG.VIEWBOX_SIZE / 2;

  const x1 = center + WHEEL_CONFIG.RADIUS * Math.cos(startAngleRad);
  const y1 = center + WHEEL_CONFIG.RADIUS * Math.sin(startAngleRad);
  const x2 = center + WHEEL_CONFIG.RADIUS * Math.cos(endAngleRad);
  const y2 = center + WHEEL_CONFIG.RADIUS * Math.sin(endAngleRad);

  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return `M ${center} ${center} L ${x1} ${y1} A ${WHEEL_CONFIG.RADIUS} ${WHEEL_CONFIG.RADIUS} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

// =============================================================================
// BORDER AND LIGHTS SYSTEM
// =============================================================================

function createWheelBorders() {
  // Remove existing borders and lights
  svg.querySelectorAll('.wheel-border, .wheel-light').forEach(element => {
    element.remove();
  });

  // Create outer border (bottom layer)
  const center = WHEEL_CONFIG.VIEWBOX_SIZE / 2;
  const outerBorder = createSVGElement('circle', {
    class: 'wheel-border outer-border',
    cx: center.toString(),
    cy: center.toString(),
    r: (WHEEL_CONFIG.RADIUS + BORDER_CONFIG.OUTER_BORDER_WIDTH / 2).toString(),
    fill: 'none',
    stroke: BORDER_CONFIG.OUTER_BORDER_COLOR,
    'stroke-width': BORDER_CONFIG.OUTER_BORDER_WIDTH.toString()
  });
  svg.insertBefore(outerBorder, svg.firstChild);

  // Create inner border (also bottom layer)
  const innerBorder = createSVGElement('circle', {
    class: 'wheel-border inner-border',
    cx: center.toString(),
    cy: center.toString(),
    r: (WHEEL_CONFIG.RADIUS + BORDER_CONFIG.INNER_BORDER_WIDTH / 2).toString(),
    fill: 'none',
    stroke: BORDER_CONFIG.INNER_BORDER_COLOR,
    'stroke-width': BORDER_CONFIG.INNER_BORDER_WIDTH.toString()
  });
  svg.insertBefore(innerBorder, svg.firstChild);

  // Create lights around the wheel (top layer)
  const angleStep = 360 / BORDER_CONFIG.LIGHT_COUNT;

  for (let i = 0; i < BORDER_CONFIG.LIGHT_COUNT; i++) {
    const angle = (i * angleStep - 90) * Math.PI / 180; // Start at top
    const lightX = center + BORDER_CONFIG.LIGHT_DISTANCE_FROM_CENTER * Math.cos(angle);
    const lightY = center + BORDER_CONFIG.LIGHT_DISTANCE_FROM_CENTER * Math.sin(angle);

    const light = createSVGElement('circle', {
      class: 'wheel-light',
      cx: lightX.toString(),
      cy: lightY.toString(),
      r: BORDER_CONFIG.LIGHT_RADIUS.toString(),
      fill: BORDER_CONFIG.LIGHT_COLORS.inactive,
      stroke: '#222222',
      'stroke-width': '1',
      style: `animation-delay: ${(i / BORDER_CONFIG.LIGHT_COUNT) * BORDER_CONFIG.ANIMATION_DURATION_S}s`
    });

    svg.appendChild(light);
  }
}

function triggerWinnerLightShow(winnerColor: string) {
  const lights = svg.querySelectorAll('.wheel-light');

  lights.forEach((light) => {
    // Set the winner color as a CSS custom property
    (light as HTMLElement).style.setProperty('--winner-color', winnerColor);

    // Remove existing animations and delays
    light.classList.remove('winner-celebration');
    (light as HTMLElement).style.removeProperty('animation-delay');

    // Force a reflow to ensure changes take effect immediately
    (light as HTMLElement).offsetHeight;

    light.classList.add('winner-celebration');
  });
}

function stopWinnerLightShow() {
  const lights = svg.querySelectorAll('.wheel-light');
  lights.forEach((light, index) => {
    light.classList.remove('winner-celebration');
    (light as HTMLElement).style.removeProperty('--winner-color');

    // Restore the original cascade animation delay
    const delay = (index / BORDER_CONFIG.LIGHT_COUNT) * BORDER_CONFIG.ANIMATION_DURATION_S;
    (light as HTMLElement).style.setProperty('animation-delay', `${delay}s`);
  });
}

// =============================================================================
// WHEEL CREATION
// =============================================================================

function createSliceText(
  wheelGroup: SVGElement,
  item: string,
  textX: number,
  textY: number,
  midAngle: number,
) {
  const text = createSVGElement('text', {
    x: textX.toString(),
    y: textY.toString(),
    transform: `rotate(${midAngle - 90}, ${textX}, ${textY})`,
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
    class: 'slice-text fixed-item-info'
  });

  const tempText = createTemporaryTextElement('slice-text fixed-item-info');
  wheelGroup.appendChild(tempText);
  tempText.textContent = item;
  const baseWidth = tempText.getComputedTextLength();
  wheelGroup.removeChild(tempText);
  const maxWidth = WHEEL_CONFIG.RADIUS * 0.8;
  const fontSize = baseWidth < maxWidth ? '100%' : (maxWidth / baseWidth) * 100 + '%';
  text.style.fontSize = fontSize;

  text.textContent = item;
  wheelGroup.appendChild(text);
}

function createPointer() {
  svg.querySelector('.pointer')?.remove();

  const pointer = createSVGElement('polygon', {
    class: 'pointer',
    points: `${POINTER_CONFIG.TIP_X},${POINTER_CONFIG.CENTER_Y} ${POINTER_CONFIG.BASE_X},${POINTER_CONFIG.TOP_Y} ${POINTER_CONFIG.BASE_X},${POINTER_CONFIG.BOTTOM_Y}`,
    fill: POINTER_CONFIG.FILL_COLOR,
    stroke: POINTER_CONFIG.STROKE_COLOR,
    'stroke-width': POINTER_CONFIG.STROKE_WIDTH
  });

  svg.appendChild(pointer);
}

function createHatWheel(items: string[]) {
  // Remove existing wheel content except pointer
  Array.from(svg.children)
    .filter(child => !child.classList.contains('pointer'))
    .forEach(element => svg.removeChild(element));

  const wheelGroup = createSVGElement('g', {
    class: 'wheel-group'
  }) as SVGGElement;

  const center = WHEEL_CONFIG.VIEWBOX_SIZE / 2;
  wheelGroup.style.transformOrigin = `${center}px ${center}px`;
  wheelGroup.style.cursor = 'pointer';
  wheelGroup.style.transform = 'rotate(0deg)';
  wheelGroup.style.transition = 'none';
  clearAllAnimationsAndTimeouts();
  isSpinning = false;
  currentRotation = 0;

  svg.appendChild(wheelGroup);
  wheelGroup.addEventListener('click', spinWheel);

  const filteredItems = items.filter(item => !selectionHistory.some(history =>
    history.item === item && history.time > new Date(Date.now() - HAT_TIMEOUT_MS)));
  const numElements = filteredItems.length;

  // Store base colors globally for highlighting
  sliceColors = filteredItems.map(() => generatePastelColor());

  // Calculate equal angles for fixed items (no scaling)
  const anglePerSlice = 360 / numElements;
  currentSliceAngles = []; // Store globally for highlighting/selection logic

  for (let i = 0; i < numElements; i++) {
    const item = filteredItems[i];
    const startAngle = i * anglePerSlice;
    const endAngle = (i + 1) * anglePerSlice;
    currentSliceAngles.push({ startAngle, endAngle, scaleFactor: 1 });
    const baseColor = sliceColors[i];

    const path = createSVGElement('path', {
      class: 'slice',
      d: createPieSlice(startAngle, endAngle),
      fill: baseColor,
      stroke: 'black',
    });
    wheelGroup.appendChild(path);

    // Create text - positioned at the normal text radius
    const midAngle = (startAngle + endAngle) / 2;
    const textRadius = WHEEL_CONFIG.RADIUS * WHEEL_CONFIG.TEXT_RADIUS_MULTIPLIER;
    const textAngleRad = ((midAngle - 90) * Math.PI) / 180;
    const textX = center + textRadius * Math.cos(textAngleRad);
    const textY = center + textRadius * Math.sin(textAngleRad);

    createSliceText(wheelGroup, item, textX, textY, midAngle);
  }

  createWheelBorders();
  createPointer();
}

function createSongRequesterWheel(requesters: SongRequester[]) {
  Array.from(svg.children)
    .filter(child => !child.classList.contains('pointer'))
    .forEach(element => svg.removeChild(element));

  currentRequesters = requesters;

  const center = WHEEL_CONFIG.VIEWBOX_SIZE / 2;
  const wheelGroup = createSVGElement('g', {
    class: 'wheel-group'
  }) as SVGGElement;

  wheelGroup.style.transformOrigin = `${center}px ${center}px`;
  wheelGroup.style.cursor = 'pointer';
  wheelGroup.style.transform = 'rotate(0deg)';
  wheelGroup.style.transition = 'none';
  clearAllAnimationsAndTimeouts();
  isSpinning = false;
  currentRotation = 0;

  svg.appendChild(wheelGroup);
  wheelGroup.addEventListener('click', spinWheel);

  const numElements = requesters.length;

  // Get user colors for each song
  sliceColors = requesters.map(requester => getUserColor(requester.name));

  // Calculate scale factors for each song
  const scaleFactors = requesters.map(requester => calculateSliceScale(requester));
  const totalScaleFactor = scaleFactors.reduce((sum, scale) => sum + scale, 0);

  // Calculate proportional angles based on scale factors
  let currentAngle = 0;
  currentSliceAngles = []; // Store globally for highlighting/selection logic

  for (let i = 0; i < numElements; i++) {
    const requester = requesters[i];
    const proportionalAngle = (scaleFactors[i] / totalScaleFactor) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + proportionalAngle;
    currentSliceAngles.push({ startAngle, endAngle, scaleFactor: scaleFactors[i] });
    currentAngle = endAngle;

    const baseColor = sliceColors[i];

    // Create slice (opacity controlled by CSS)
    const path = createSVGElement('path', {
      class: 'slice',
      d: createPieSlice(startAngle, endAngle),
      fill: baseColor,
      stroke: 'black',
      'data-requester': requester.name.toLowerCase() || '',
    });
    wheelGroup.appendChild(path);

    // Create text - positioned at the normal text radius
    const midAngle = (startAngle + endAngle) / 2;
    const textRadius = WHEEL_CONFIG.RADIUS * WHEEL_CONFIG.TEXT_RADIUS_MULTIPLIER;
    const textAngleRad = ((midAngle - 90) * Math.PI) / 180;
    const textX = center + textRadius * Math.cos(textAngleRad);
    const textY = center + textRadius * Math.sin(textAngleRad);
    createSliceText(
      wheelGroup,
      requester.name,
      textX,
      textY,
      midAngle
    );
  }

  createWheelBorders();
  createPointer();
}

// =============================================================================
// MAIN SPINNING LOGIC
// =============================================================================

async function spinWheel() {
  if (isSpinning) return;

  clearAllAnimationsAndTimeouts();
  resetSelection();
  stopWinnerLightShow();
  document.querySelector('.winner-announcement')?.remove();

  await initializeWheel();

  const spinDurationMs = ANIMATION_CONFIG.MIN_SPIN_DURATION_MS +
    Math.random() * (ANIMATION_CONFIG.MAX_SPIN_DURATION_MS - ANIMATION_CONFIG.MIN_SPIN_DURATION_MS);

  try {
    isSpinning = true;

    const baseRotations = ANIMATION_CONFIG.MIN_ROTATIONS + Math.random() * ANIMATION_CONFIG.MAX_ADDITIONAL_ROTATIONS;
    const randomAdditionalAngle = Math.random() * 360;
    const additionalRotation = baseRotations * 360 + randomAdditionalAngle;
    const newTotalRotation = currentRotation + additionalRotation;
    currentRotation = newTotalRotation;

    const wheelGroup = svg.querySelector('.wheel-group') as SVGElement;
    if (wheelGroup) {
      wheelGroup.style.transition = `transform ${spinDurationMs / 1000}s ${ANIMATION_CONFIG.TIMING_FUNCTION}`;
      wheelGroup.style.transform = `rotate(${newTotalRotation}deg)`;
      updateRealtimeHighlighting();
    }
  } catch (error) {
    console.error('Failed to prepare wheel before spinning:', error);
    isSpinning = false;
    clearAllAnimationsAndTimeouts();
    return;
  }

  spinTimeoutId = setTimeout(() => {
    clearAllAnimationsAndTimeouts();

    const selectedSliceIndex = getCurrentSliceUnderIndicator();

    isSpinning = false;
    spinTimeoutId = null;

    let label = '', sublabel = '';
    if (isHatWheelMode) {
      label = svg.querySelectorAll('.slice.selected')[0].nextElementSibling!.textContent;
      selectionHistory.push({ item: label, time: new Date() });
      window.ipcRenderer.send('wheel_select_hat', label);
    } else {
      const requester = currentRequesters[selectedSliceIndex];
      label = requester.name;
      if (requester.requests?.length > 0) {
        sublabel = requester.requests.map(request =>
          request.artist ? `${request.artist} - ${request.title}` : request.title
        ).join('<br>');
      }
      window.ipcRenderer.send('wheel_select_song_requester', requester.name);
    }

    // Trigger winner light show with the selected slice color
    const winnerColor = sliceColors[selectedSliceIndex] || generatePastelColor();
    triggerWinnerLightShow(winnerColor);

    winnerTimeoutId = setTimeout(() => {
      showWinnerAnnouncement(label, sublabel);
      winnerTimeoutId = null;
    }, ANIMATION_CONFIG.WINNER_DELAY_MS);
  }, spinDurationMs);
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

async function fetchSongRequests(): Promise<SongRequestData[]> {
  try {
    const response = await fetch('http://localhost:3000/requests');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const requests: SongRequestData[] = await response.json();
    return requests.toSorted(() => Math.random() - 0.5);
  } catch (error) {
    console.error('Failed to fetch song requests:', error);
    return [];
  }
}

async function initializeWheel() {
  document.querySelector('.winner-announcement')?.remove();

  if (isHatWheelMode) {
    createHatWheel(ALL_HATS);
  } else {
    const songRequests = await fetchSongRequests();
    const requesters = Array.from(new Set(songRequests.map(request => request.requester)));
    const requestersWithMeta = requesters.map(name => {
      const requests = songRequests.filter(request => request.requester === name);
      const earliestRequestedByDate = requests.reduce((earliest, request) => {
        return request.effectiveCreatedAt < earliest ? request.effectiveCreatedAt : earliest;
      }, requests[0]!.effectiveCreatedAt);
      return {
        name,
        fulfilledToday: requests[0]!.fulfilledToday,
        lastFulfilledAt: requests[0]!.lastFulfilledAt,
        currentBumpCount: requests[0]!.currentBumpCount,
        oldestRequestAge: new Date().getTime() - new Date(earliestRequestedByDate).getTime(),
        requests,
      };
    }) as SongRequester[];
    createSongRequesterWheel(requestersWithMeta);
  }
}

// =============================================================================
// WEBSOCKET MESSAGE HANDLERS
// =============================================================================

window.ipcRenderer.on('wheel_toggle_visibility', async () => {
  const isCurrentlyVisible = globalContainer.classList.contains('wheel-visible');
  globalContainer.classList.toggle('wheel-visible');

  // If wheel is now visible (was hidden, now shown), update wheel content and hide winner message
  if (!isCurrentlyVisible) {
    // Hide any previous winner message
    initializeWheel();
  }
});

window.ipcRenderer.on('wheel_toggle_mode', async () => {
  isHatWheelMode = !isHatWheelMode;
  initializeWheel();
});

window.ipcRenderer.on('wheel_spin', () => {
  if (!isSpinning) {
    spinWheel();
  }
});

window.ipcRenderer.on('song_played', () => {
  globalContainer.classList.remove('wheel-visible');
});

window.ipcRenderer.on('viewers_update', (_, payload) => {
  payload.viewers.forEach((viewer: StreamerbotViewer) => {
    if (viewer.color) {
      userColors.set(viewer.login.toLowerCase(), viewer.color);
      if (!isSpinning) {
        document.querySelectorAll<SVGPathElement>(`[data-requester="${viewer.login.toLowerCase()}"]`).forEach(element => {
          element.style.fill = viewer.color!;
        });
      }
    }
    if (viewer.subscribed) {
      subscribedViewers.add(viewer.login.toLowerCase());
    }
  });
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'f') {
    initializeWheel();
  } else if (event.key === 's') {
    spinWheel();
  } else if (event.key === 'h') {
    isHatWheelMode = !isHatWheelMode;
    initializeWheel();
  }
});
