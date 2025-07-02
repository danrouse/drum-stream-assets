import { SongRequestData } from '../../../shared/messages';

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

const WHEEL_CONFIG = {
  CENTER_X: 200,
  CENTER_Y: 200,
  RADIUS: 180,
  TEXT_RADIUS_MULTIPLIER: 0.55,
  MAX_TEXT_WIDTH_MULTIPLIERS: {
    lessThanOrEqual4: 1.2,
    lessThanOrEqual6: 1.0,
    lessThanOrEqual8: 0.8,
    lessThanOrEqual12: 0.6,
    default: 0.4
  }
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
  CONFETTI_DELAY_MS: 200
} as const;

const POINTER_CONFIG = {
  TIP_X: 365,
  BASE_X: 380,
  TOP_Y: 190,
  BOTTOM_Y: 210,
  CENTER_Y: 200,
  FILL_COLOR: 'rgb(174, 170, 144)',
  STROKE_COLOR: 'black',
  STROKE_WIDTH: '2'
} as const;

const CONFETTI_CONFIG = {
  MIN_PARTICLES: 80,
  MAX_ADDITIONAL_PARTICLES: 40,
  MIN_DURATION_S: 4,
  MAX_ADDITIONAL_DURATION_S: 3,
  MAX_ROTATION_DEGREES: 1080,
  MAX_HORIZONTAL_SPREAD: 400,
  MIN_VERTICAL_DISTANCE: 150,
  MAX_ADDITIONAL_VERTICAL: 250,
  CLEANUP_DELAY_MS: 8000
} as const;

const GRAY_SHADES = [
  '#888888', '#666666', '#777777', '#555555',
  '#999999', '#444444', '#6a6a6a', '#7a7a7a'
] as const;

const CONFETTI_COLORS = [
  '#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24',
  '#f0932b', '#eb4d4b', '#6c5ce7', '#a29bfe'
] as const;

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

let currentSongs: SongRequestData[] = [];
let isSpinning = false;
let selectedSliceIndex = -1;
let currentRotation = 0;
let animationFrameId: number | null = null;
let currentHighlightedSlice = -1;
let spinTimeoutId: NodeJS.Timeout | null = null;
let winnerTimeoutId: NodeJS.Timeout | null = null;
let confettiTimeoutId: NodeJS.Timeout | null = null;

// =============================================================================
// DOM ELEMENTS
// =============================================================================

const globalContainer = document.getElementById('app')!;
globalContainer.classList.add('wheel-visible');

const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
svg.setAttribute('class', 'wheel');
svg.setAttribute('viewBox', '0 0 400 400');
globalContainer.appendChild(svg);

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function formatRequestTime(createdAt: string): string {
  try {
    const isoString = createdAt.replace(' ', 'T') + 'Z';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    const remainingMins = diffMins % 60;

    if (diffHours < 24) {
      return remainingMins === 0 ? `${diffHours}h ago` : `${diffHours}h${remainingMins}m ago`;
    }

    return date.toLocaleDateString();
  } catch {
    return '';
  }
}

function generateRandomPastelColor(): string {
  const hue = Math.floor(Math.random() * 360);
  const saturation = Math.floor(Math.random() * 30) + 60;
  const lightness = Math.floor(Math.random() * 20) + 70;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function generateBrightPastelColor(): string {
  const hue = Math.floor(Math.random() * 360);
  const saturation = Math.floor(Math.random() * 20) + 75; // Higher saturation
  const lightness = Math.floor(Math.random() * 15) + 80; // Higher lightness
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function brightenPastelColor(hslColor: string): string {
  // Parse HSL color string like "hsl(120, 65%, 75%)"
  const match = hslColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!match) {
    // Fallback if parsing fails
    return generateBrightPastelColor();
  }

  const hue = parseInt(match[1]);
  const saturation = parseInt(match[2]);
  const lightness = parseInt(match[3]);

  // Increase saturation and lightness for highlighting
  const newSaturation = Math.min(95, saturation + 15); // Add 15% saturation, cap at 95%
  const newLightness = Math.min(90, lightness + 10);   // Add 10% lightness, cap at 90%

  return `hsl(${hue}, ${newSaturation}%, ${newLightness}%)`;
}

function generateGrayShades(numSlices: number): string[] {
  const colors: string[] = [];

  for (let i = 0; i < numSlices; i++) {
    let colorIndex;

    if (i === 0) {
      colorIndex = Math.floor(Math.random() * GRAY_SHADES.length);
    } else {
      let attempts = 0;
      do {
        colorIndex = Math.floor(Math.random() * GRAY_SHADES.length);
        attempts++;
      } while (GRAY_SHADES[colorIndex] === colors[i - 1] && attempts < 10);

      // For odd numbers of slices, ensure last slice doesn't match first
      if (i === numSlices - 1 && numSlices % 2 === 1) {
        let finalAttempts = 0;
        while ((GRAY_SHADES[colorIndex] === colors[i - 1] || GRAY_SHADES[colorIndex] === colors[0]) && finalAttempts < 10) {
          colorIndex = Math.floor(Math.random() * GRAY_SHADES.length);
          finalAttempts++;
        }
      }
    }

    colors.push(GRAY_SHADES[colorIndex]);
  }

  return colors;
}

function generatePastelColors(numSlices: number): string[] {
  const colors: string[] = [];

  for (let i = 0; i < numSlices; i++) {
    colors.push(generateRandomPastelColor());
  }

  return colors;
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

function truncateTextByWidth(textElement: SVGTextElement, text: string, maxWidth: number): string {
  textElement.textContent = text;

  if (textElement.getComputedTextLength() <= maxWidth) {
    return text;
  }

  let left = 0;
  let right = text.length;
  let bestFit = '';

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const testText = text.substring(0, mid) + '...';

    textElement.textContent = testText;
    const width = textElement.getComputedTextLength();

    if (width <= maxWidth) {
      bestFit = testText;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return bestFit || '...';
}

function getMaxTextWidth(numSlices: number): number {
  const baseWidth = WHEEL_CONFIG.RADIUS * 0.8;
  const { MAX_TEXT_WIDTH_MULTIPLIERS } = WHEEL_CONFIG;

  if (numSlices <= 4) return baseWidth * MAX_TEXT_WIDTH_MULTIPLIERS.lessThanOrEqual4;
  if (numSlices <= 6) return baseWidth * MAX_TEXT_WIDTH_MULTIPLIERS.lessThanOrEqual6;
  if (numSlices <= 8) return baseWidth * MAX_TEXT_WIDTH_MULTIPLIERS.lessThanOrEqual8;
  if (numSlices <= 12) return baseWidth * MAX_TEXT_WIDTH_MULTIPLIERS.lessThanOrEqual12;
  return baseWidth * MAX_TEXT_WIDTH_MULTIPLIERS.default;
}

// =============================================================================
// ANIMATION AND CLEANUP FUNCTIONS
// =============================================================================

function clearAllAnimationsAndTimeouts() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  [spinTimeoutId, winnerTimeoutId, confettiTimeoutId].forEach(timeoutId => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });

  spinTimeoutId = winnerTimeoutId = confettiTimeoutId = null;
  currentHighlightedSlice = -1;

  document.querySelectorAll('.confetti-particle').forEach(particle => {
    particle.parentNode?.removeChild(particle);
  });

  stopWinnerLightShow();
}

function resetSelection() {
  clearAllAnimationsAndTimeouts();

  selectedSliceIndex = -1;
  svg.querySelectorAll('.slice').forEach(slice => {
    slice.classList.remove('selected');
    const originalColor = slice.getAttribute('data-original-color');
    if (originalColor) {
      slice.setAttribute('fill', originalColor);
    }
  });
}

// =============================================================================
// CONFETTI SYSTEM
// =============================================================================

function createConfettiParticle(): HTMLElement {
  const particle = document.createElement('div');
  particle.className = 'confetti-particle';

  const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
  const screenCenterX = window.innerWidth / 2;
  const screenCenterY = window.innerHeight / 2;

  const startX = screenCenterX + (Math.random() - 0.5) * 200;
  const startY = screenCenterY + (Math.random() - 0.5) * 200;

  const animationDuration = CONFETTI_CONFIG.MIN_DURATION_S + Math.random() * CONFETTI_CONFIG.MAX_ADDITIONAL_DURATION_S;
  const rotationSpeed = (Math.random() - 0.5) * CONFETTI_CONFIG.MAX_ROTATION_DEGREES;
  const horizontalDistance = (Math.random() - 0.5) * CONFETTI_CONFIG.MAX_HORIZONTAL_SPREAD;
  const verticalDistance = CONFETTI_CONFIG.MIN_VERTICAL_DISTANCE + Math.random() * CONFETTI_CONFIG.MAX_ADDITIONAL_VERTICAL;

  particle.style.cssText = `
    position: fixed;
    left: ${startX}px;
    top: ${startY}px;
    width: 8px;
    height: 8px;
    background-color: ${color};
    border-radius: 2px;
    pointer-events: none;
    z-index: 5000;
    animation: confetti-fall ${animationDuration}s ease-out forwards;
    --horizontal-distance: ${horizontalDistance}px;
    --vertical-distance: ${verticalDistance}px;
    --rotation: ${rotationSpeed}deg;
  `;

  return particle;
}

function createConfettiBurst() {
  const container = document.body;
  const particleCount = CONFETTI_CONFIG.MIN_PARTICLES + Math.random() * CONFETTI_CONFIG.MAX_ADDITIONAL_PARTICLES;

  for (let i = 0; i < particleCount; i++) {
    const particle = createConfettiParticle();
    container.appendChild(particle);

    setTimeout(() => {
      particle.parentNode?.removeChild(particle);
    }, CONFETTI_CONFIG.CLEANUP_DELAY_MS);
  }
}

// =============================================================================
// WINNER ANNOUNCEMENT
// =============================================================================

function showWinnerAnnouncement(song: SongRequestData) {
  const container = document.querySelector('#app')!;

  container.querySelector('.winner-announcement')?.remove();

  const announcement = document.createElement('div');
  announcement.className = 'winner-announcement';

  const timeAgo = formatRequestTime(song.createdAt);
  const songDisplay = song.artist ? `${song.artist} - ${song.title}` : song.title;
  announcement.innerHTML = `
    <div class="winner-song">${songDisplay}</div>
    <div class="winner-requester">Requested by ${song.requester || 'Anonymous'}${timeAgo ? ` • ${timeAgo}` : ''}</div>
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
  if (currentSongs.length === 0) return -1;

  const anglePerSlice = 360 / currentSongs.length;
  const currentDOMRotation = getCurrentRotationFromDOM();
  const effectiveRotation = currentDOMRotation % 360;
  const originalAngleAtIndicator = (-effectiveRotation + 90 + 360) % 360;

  return Math.floor(originalAngleAtIndicator / anglePerSlice);
}

function updateRealtimeHighlighting() {
  if (!isSpinning || currentSongs.length === 0) return;

  const currentSliceIndex = getCurrentSliceUnderIndicator();

  if (currentSliceIndex !== currentHighlightedSlice) {
    const slices = svg.querySelectorAll('.slice');

    slices.forEach(slice => {
      const originalColor = slice.getAttribute('data-original-color');
      if (originalColor) {
        slice.setAttribute('fill', originalColor);
      }
      slice.classList.remove('selected');
    });

    if (currentSliceIndex >= 0 && currentSliceIndex < slices.length) {
      const currentSlice = slices[currentSliceIndex] as SVGElement;
      if (currentSlice) {
        currentSlice.classList.add('selected');
        const originalColor = currentSlice.getAttribute('data-original-color') || '';
        const brighterColor = brightenPastelColor(originalColor);
        currentSlice.setAttribute('fill', brighterColor);
      }
    }

    currentHighlightedSlice = currentSliceIndex;
  }

  animationFrameId = requestAnimationFrame(updateRealtimeHighlighting);
}

function highlightSelectedSlice() {
  if (selectedSliceIndex >= 0) {
    const slices = svg.querySelectorAll('.slice');
    const selectedSlice = slices[selectedSliceIndex] as SVGElement;
    if (selectedSlice) {
      selectedSlice.classList.add('selected');
      const originalColor = selectedSlice.getAttribute('data-original-color') || '';
      const brighterColor = brightenPastelColor(originalColor);
      selectedSlice.setAttribute('fill', brighterColor);
      selectedSlice.setAttribute('data-selected-color', brighterColor);
    }
  }
}

// =============================================================================
// GEOMETRY FUNCTIONS
// =============================================================================

function createPieSlice(startAngle: number, endAngle: number): string {
  const startAngleRad = ((startAngle - 90) * Math.PI) / 180;
  const endAngleRad = ((endAngle - 90) * Math.PI) / 180;

  const x1 = WHEEL_CONFIG.CENTER_X + WHEEL_CONFIG.RADIUS * Math.cos(startAngleRad);
  const y1 = WHEEL_CONFIG.CENTER_Y + WHEEL_CONFIG.RADIUS * Math.sin(startAngleRad);
  const x2 = WHEEL_CONFIG.CENTER_X + WHEEL_CONFIG.RADIUS * Math.cos(endAngleRad);
  const y2 = WHEEL_CONFIG.CENTER_Y + WHEEL_CONFIG.RADIUS * Math.sin(endAngleRad);

  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return `M ${WHEEL_CONFIG.CENTER_X} ${WHEEL_CONFIG.CENTER_Y} L ${x1} ${y1} A ${WHEEL_CONFIG.RADIUS} ${WHEEL_CONFIG.RADIUS} 0 ${largeArc} 1 ${x2} ${y2} Z`;
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
  const outerBorder = createSVGElement('circle', {
    class: 'wheel-border outer-border',
    cx: WHEEL_CONFIG.CENTER_X.toString(),
    cy: WHEEL_CONFIG.CENTER_Y.toString(),
    r: (WHEEL_CONFIG.RADIUS + BORDER_CONFIG.OUTER_BORDER_WIDTH / 2).toString(),
    fill: 'none',
    stroke: BORDER_CONFIG.OUTER_BORDER_COLOR,
    'stroke-width': BORDER_CONFIG.OUTER_BORDER_WIDTH.toString()
  });
  svg.insertBefore(outerBorder, svg.firstChild);

  // Create inner border (also bottom layer)
  const innerBorder = createSVGElement('circle', {
    class: 'wheel-border inner-border',
    cx: WHEEL_CONFIG.CENTER_X.toString(),
    cy: WHEEL_CONFIG.CENTER_Y.toString(),
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
    const lightX = WHEEL_CONFIG.CENTER_X + BORDER_CONFIG.LIGHT_DISTANCE_FROM_CENTER * Math.cos(angle);
    const lightY = WHEEL_CONFIG.CENTER_Y + BORDER_CONFIG.LIGHT_DISTANCE_FROM_CENTER * Math.sin(angle);

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

  lights.forEach((light, index) => {
    // Set the winner color as a CSS custom property
    (light as HTMLElement).style.setProperty('--winner-color', winnerColor);

    // Remove existing animations and delays
    light.classList.remove('winner-celebration', 'winner-celebration-even', 'winner-celebration-odd');
    (light as HTMLElement).style.removeProperty('animation-delay');

    // Force a reflow to ensure changes take effect immediately
    (light as HTMLElement).offsetHeight;

    // Apply alternating classes - even/odd lights get different animations
    if (index % 2 === 0) {
      light.classList.add('winner-celebration-even');
    } else {
      light.classList.add('winner-celebration-odd');
    }
  });
}

function stopWinnerLightShow() {
  const lights = svg.querySelectorAll('.wheel-light');
  lights.forEach((light, index) => {
    light.classList.remove('winner-celebration', 'winner-celebration-even', 'winner-celebration-odd');
    (light as HTMLElement).style.removeProperty('--winner-color');

    // Restore the original cascade animation delay
    const delay = (index / BORDER_CONFIG.LIGHT_COUNT) * BORDER_CONFIG.ANIMATION_DURATION_S;
    (light as HTMLElement).style.setProperty('animation-delay', `${delay}s`);
  });
}

// =============================================================================
// WHEEL CREATION
// =============================================================================

function createSliceText(wheelGroup: SVGElement, song: SongRequestData, textX: number, textY: number, midAngle: number, maxTextWidth: number) {
  const combinedText = createSVGElement('text', {
    x: textX.toString(),
    y: textY.toString(),
    transform: `rotate(${midAngle - 90}, ${textX}, ${textY})`,
    'text-anchor': 'middle',
    'dominant-baseline': 'middle'
  });
  wheelGroup.appendChild(combinedText);

  // Song title
  const songTspan = createSVGElement('tspan', {
    class: 'slice-text song-info',
    x: textX.toString(),
    dy: '-0.6em'
  });

  const fullSongText = song.artist ? `${song.artist} - ${song.title}` : song.title;
  const tempText = createTemporaryTextElement('slice-text song-info');
  wheelGroup.appendChild(tempText);
  songTspan.textContent = truncateTextByWidth(tempText, fullSongText, maxTextWidth);
  wheelGroup.removeChild(tempText);
  combinedText.appendChild(songTspan);

  // Requester name
  if (song.requester) {
    const requesterTspan = createSVGElement('tspan', {
      class: 'slice-text requester-info',
      x: textX.toString(),
      dy: '1.4em',
      'font-style': 'italic'
    });

    const tempRequesterText = createTemporaryTextElement('slice-text requester-info', { 'font-style': 'italic' });
    wheelGroup.appendChild(tempRequesterText);
    requesterTspan.textContent = truncateTextByWidth(tempRequesterText, song.requester, maxTextWidth * 0.9);
    wheelGroup.removeChild(tempRequesterText);
    combinedText.appendChild(requesterTspan);
  }
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

function createWheel(songs: SongRequestData[], preserveSpinningState = false) {
  currentSongs = songs;

    // Remove existing wheel content except pointer
  Array.from(svg.children)
    .filter(child => !child.classList.contains('pointer'))
    .forEach(element => svg.removeChild(element));

  if (songs.length === 0) {
    const text = createSVGElement('text', {
      class: 'no-songs-text',
      x: WHEEL_CONFIG.CENTER_X.toString(),
      y: WHEEL_CONFIG.CENTER_Y.toString(),
      'text-anchor': 'middle',
      'dominant-baseline': 'middle'
    });
    text.textContent = 'No song requests available';
    svg.appendChild(text);
    return;
  }

  const wheelGroup = createSVGElement('g', {
    class: 'wheel-group'
  }) as SVGGElement;

  wheelGroup.style.transformOrigin = `${WHEEL_CONFIG.CENTER_X}px ${WHEEL_CONFIG.CENTER_Y}px`;
  wheelGroup.style.cursor = 'pointer';

  if (!preserveSpinningState) {
    wheelGroup.style.transform = 'rotate(0deg)';
    wheelGroup.style.transition = 'none';
    clearAllAnimationsAndTimeouts();
    isSpinning = false;
    selectedSliceIndex = -1;
    currentRotation = 0;
  } else {
    wheelGroup.style.transform = `rotate(${currentRotation}deg)`;
    const averageDuration = (ANIMATION_CONFIG.MIN_SPIN_DURATION_MS + ANIMATION_CONFIG.MAX_SPIN_DURATION_MS) / 2;
    wheelGroup.style.transition = `transform ${averageDuration / 1000}s ${ANIMATION_CONFIG.TIMING_FUNCTION}`;
  }

  svg.appendChild(wheelGroup);
  wheelGroup.addEventListener('click', spinWheel);

  const numElements = songs.length;
  const anglePerSlice = 360 / numElements;
  const pastelColors = generatePastelColors(numElements);

  for (let i = 0; i < numElements; i++) {
    const song = songs[i];
    const startAngle = i * anglePerSlice;
    const endAngle = (i + 1) * anglePerSlice;
    const pastelColor = pastelColors[i];

    // Create slice
    const path = createSVGElement('path', {
      class: 'slice',
      d: createPieSlice(startAngle, endAngle),
      'data-song-id': song.id.toString(),
      fill: pastelColor,
      'data-original-color': pastelColor
    });
    wheelGroup.appendChild(path);

    // Create text
    const midAngle = (startAngle + endAngle) / 2;
    const textRadius = WHEEL_CONFIG.RADIUS * WHEEL_CONFIG.TEXT_RADIUS_MULTIPLIER;
    const textAngleRad = ((midAngle - 90) * Math.PI) / 180;
    const textX = WHEEL_CONFIG.CENTER_X + textRadius * Math.cos(textAngleRad);
    const textY = WHEEL_CONFIG.CENTER_Y + textRadius * Math.sin(textAngleRad);
    const maxTextWidth = getMaxTextWidth(numElements);

    createSliceText(wheelGroup, song, textX, textY, midAngle, maxTextWidth);
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
  isSpinning = true;

  document.querySelector('.winner-announcement')?.remove();
  stopWinnerLightShow();
  resetSelection();

  // Generate random spin duration between 10-15 seconds
  const spinDurationMs = ANIMATION_CONFIG.MIN_SPIN_DURATION_MS +
    Math.random() * (ANIMATION_CONFIG.MAX_SPIN_DURATION_MS - ANIMATION_CONFIG.MIN_SPIN_DURATION_MS);

  try {
    const latestSongs = await fetchSongRequests();
    if (latestSongs.length === 0) {
      isSpinning = false;
      clearAllAnimationsAndTimeouts();
      return;
    }

    createWheel(latestSongs, true);

    currentHighlightedSlice = -1;

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
    console.error('Failed to fetch latest songs before spinning:', error);
    isSpinning = false;
    clearAllAnimationsAndTimeouts();
    return;
  }

  spinTimeoutId = setTimeout(() => {
    clearAllAnimationsAndTimeouts();

    const anglePerSlice = 360 / currentSongs.length;
    const effectiveRotation = currentRotation % 360;
    const originalAngleAtIndicator = (-effectiveRotation + 90 + 360) % 360;
    selectedSliceIndex = Math.floor(originalAngleAtIndicator / anglePerSlice);

    highlightSelectedSlice();
    isSpinning = false;
    spinTimeoutId = null;

    const selectedSong = currentSongs[selectedSliceIndex];
    const logSongDisplay = selectedSong.artist ? `${selectedSong.artist} - ${selectedSong.title}` : selectedSong.title;
    console.log('Selected song:', logSongDisplay, selectedSong.requester ? `(requested by ${selectedSong.requester})` : '');

    // Broadcast wheel selection via websocket
    if (selectedSong.songRequestId) {
      window.ipcRenderer.send('wheel_selection', selectedSong.songRequestId);
    }

    // Trigger winner light show with the selected slice color
    const slices = svg.querySelectorAll('.slice');
    const selectedSlice = slices[selectedSliceIndex] as SVGElement;
    const originalColor = selectedSlice?.getAttribute('data-original-color') || '';
    const winnerColor = brightenPastelColor(originalColor);
    triggerWinnerLightShow(winnerColor);

    winnerTimeoutId = setTimeout(() => {
      showWinnerAnnouncement(selectedSong);
      winnerTimeoutId = null;

      confettiTimeoutId = setTimeout(() => {
        createConfettiBurst();
        confettiTimeoutId = null;
      }, ANIMATION_CONFIG.CONFETTI_DELAY_MS);
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

    // Expand requests based on bumpCount - each bump adds one more wheel entry
    const expandedRequests: SongRequestData[] = [];
    for (const request of requests) {
      const wheelEntries = (request.bumpCount || 0) + 1; // Base 1 entry + bump count
      for (let i = 0; i < wheelEntries; i++) {
        expandedRequests.push(request);
      }
    }

    return expandedRequests;
  } catch (error) {
    console.error('Failed to fetch song requests:', error);
    return [];
  }
}

async function initializeWheel() {
  try {
    const songs = await fetchSongRequests();
    createWheel(songs);
  } catch (error) {
    console.error('Failed to initialize wheel:', error);
    createWheel([]);
  }
}

// =============================================================================
// WEBSOCKET MESSAGE HANDLERS
// =============================================================================

window.ipcRenderer.on('wheel_toggle_visibility', async () => {
  const isCurrentlyVisible = globalContainer.classList.contains('wheel-visible');
  globalContainer.classList.toggle('wheel-visible');

  // If wheel is now visible (was hidden, now shown), update song list and hide winner message
  if (!isCurrentlyVisible) {
    // Hide any previous winner message
    document.querySelector('.winner-announcement')?.remove();

    // Update the song list
    try {
      const songs = await fetchSongRequests();
      createWheel(songs);
    } catch (error) {
      console.error('Failed to update wheel when showing:', error);
    }
  }
});

window.ipcRenderer.on('wheel_spin', () => {
  if (!isSpinning && currentSongs.length > 0) {
    spinWheel();
  }
});

window.ipcRenderer.on('song_played', () => {
  globalContainer.classList.remove('wheel-visible');
});

// =============================================================================
// INITIALIZATION
// =============================================================================

initializeWheel();
