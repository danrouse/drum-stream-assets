import { SerialPort } from 'serialport';
import WebSocketCoordinatorServer from '../WebSocketCoordinatorServer';
import { midiNoteDefinitions, midiNoteKeysByName } from '../../../shared/midiNoteDefinitions';
import { createLogger } from '../../../shared/util';

const log = createLogger('DMXLighting');

// DMX512 Configuration
const DMX_PORT = 'COM3';
const DMX_BAUD_RATE = 250000;
const DMX_UNIVERSE_SIZE = 512;
const DEVICE_CHANNELS = 121;
const NUM_LIGHTS = 40;

interface DrumMapping {
  name: string;
  startLight: number;
  endLight: number;
  midiKeys: number[];
  color: { r: number; g: number; b: number };
  altColor: { r: number; g: number; b: number }; // Alternating color
  centerPosition: number; // Center position for ripple effect
  mirrorPosition?: number; // Optional mirror position for symmetric drums
}

interface RippleWave {
  drumName: string;
  centerPosition: number;
  color: { r: number; g: number; b: number };
  intensity: number;
  radius: number;
  maxRadius: number;
  speed: number;
  age: number;
}

export default class DMXLightingModule {
  private port!: SerialPort; // Will be initialized in initializeDMX
  private dmxData: Uint8Array;
  private isConnected: boolean = false;
  private transmissionInterval: NodeJS.Timeout | null = null;
  private rippleInterval: NodeJS.Timeout | null = null;
  private activeWaves: RippleWave[] = [];
  private drumHitCounts: Map<string, number> = new Map(); // Track alternating hits

  // Define drum-to-light mappings with ripple centers and alternating colors (max 50% white saturation)
  private drumMappings: DrumMapping[] = [
    {
      name: 'Kick',
      startLight: 1,
      endLight: 4,
      centerPosition: 2.5, // Left kick section
      mirrorPosition: 37.5, // Right kick section (40-2.5)
      midiKeys: midiNoteKeysByName.Kick,
      color: this.parseColor('rgb(127, 127, 127)'), // Neutral gray for kick (50% white)
      altColor: this.parseColor('rgb(127, 127, 255)') // Blue-gray for alternating hits
    },
    {
      name: 'Tom4',
      startLight: 5,
      endLight: 7,
      centerPosition: 6, // Left tom4 section
      mirrorPosition: 35, // Right tom4 section
      midiKeys: midiNoteKeysByName.Tom4,
      color: this.parseColor('rgb(0, 255, 0)'), // Pure saturated green
      altColor: this.parseColor('rgb(127, 255, 0)') // Yellow-green
    },
    {
      name: 'Tom3',
      startLight: 8,
      endLight: 10,
      centerPosition: 9, // Left tom3 section
      mirrorPosition: 32, // Right tom3 section
      midiKeys: midiNoteKeysByName.Tom3,
      color: this.parseColor('rgb(0, 255, 127)'), // Saturated cyan-green
      altColor: this.parseColor('rgb(0, 255, 255)') // Pure cyan
    },
    {
      name: 'Tom2',
      startLight: 11,
      endLight: 13,
      centerPosition: 12, // Left tom2 section
      mirrorPosition: 29, // Right tom2 section
      midiKeys: midiNoteKeysByName.Tom2,
      color: this.parseColor('rgb(0, 127, 255)'), // Saturated sky blue
      altColor: this.parseColor('rgb(0, 200, 255)') // Brighter sky blue
    },
    {
      name: 'Tom1',
      startLight: 14,
      endLight: 16,
      centerPosition: 15, // Left tom1 section
      mirrorPosition: 26, // Right tom1 section
      midiKeys: midiNoteKeysByName.Tom1,
      color: this.parseColor('rgb(0, 0, 255)'), // Pure saturated blue
      altColor: this.parseColor('rgb(127, 0, 255)') // Purple-blue
    },
    {
      name: 'Snare',
      startLight: 17,
      endLight: 24,
      centerPosition: 20.5, // Center of snare section (middle of the bar)
      midiKeys: midiNoteKeysByName.Snare,
      color: this.parseColor('rgb(255, 0, 0)'), // Pure saturated red
      altColor: this.parseColor('rgb(255, 0, 127)') // Red-magenta
    },
    // Cymbals - positioned around the sides of the kit with small tom-like sizes
    {
      name: 'Crash1',
      startLight: 25,
      endLight: 27,
      centerPosition: 26, // Near snare, left of Tom1 mirror
      midiKeys: midiNoteKeysByName.Crash1,
      color: this.parseColor('rgb(255, 255, 0)'), // Pure yellow
      altColor: this.parseColor('rgb(255, 127, 0)') // Orange
    },
    {
      name: 'Crash2',
      startLight: 28,
      endLight: 30,
      centerPosition: 29, // Between Tom2 and Tom1 mirrors
      midiKeys: midiNoteKeysByName.Crash2,
      color: this.parseColor('rgb(255, 0, 255)'), // Pure magenta
      altColor: this.parseColor('rgb(255, 127, 255)') // Light magenta
    },
    {
      name: 'Crash3',
      startLight: 7,
      endLight: 9,
      centerPosition: 8, // Between Tom4 and Tom3 on left
      midiKeys: midiNoteKeysByName.Crash3,
      color: this.parseColor('rgb(127, 255, 255)'), // Light cyan
      altColor: this.parseColor('rgb(0, 255, 255)') // Pure cyan
    },
    {
      name: 'Ride',
      startLight: 34,
      endLight: 36,
      centerPosition: 35, // Between Tom4 mirror and Tom3 mirror
      midiKeys: midiNoteKeysByName.Ride,
      color: this.parseColor('rgb(255, 127, 0)'), // Orange
      altColor: this.parseColor('rgb(255, 200, 0)') // Yellow-orange
    },
    {
      name: 'Ride2',
      startLight: 37,
      endLight: 39,
      centerPosition: 38, // Near kick mirror
      midiKeys: midiNoteKeysByName.Ride2,
      color: this.parseColor('rgb(200, 100, 0)'), // Dark orange
      altColor: this.parseColor('rgb(255, 150, 0)') // Bright orange
    },
    {
      name: 'Splash',
      startLight: 4,
      endLight: 6,
      centerPosition: 5, // Between kick and Tom4 on left
      midiKeys: midiNoteKeysByName.Splash,
      color: this.parseColor('rgb(127, 0, 255)'), // Purple
      altColor: this.parseColor('rgb(200, 0, 255)') // Bright purple
    },
    {
      name: 'Splash2',
      startLight: 31,
      endLight: 33,
      centerPosition: 32, // Between Tom3 and Tom2 mirrors
      midiKeys: midiNoteKeysByName.Splash2,
      color: this.parseColor('rgb(0, 127, 127)'), // Dark cyan
      altColor: this.parseColor('rgb(0, 200, 200)') // Bright cyan
    }
  ];

    constructor(private webSocketCoordinatorServer: WebSocketCoordinatorServer) {
    this.dmxData = new Uint8Array(DMX_UNIVERSE_SIZE);
    this.initializeDMX();
    this.setupMIDIListeners();
    this.startRippleEngine();
  }

  private parseColor(colorString: string): { r: number; g: number; b: number } {
    // Handle hex colors
    if (colorString.startsWith('#')) {
      const hex = colorString.slice(1);
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
      };
    }

    // Handle rgb() colors
    const rgbMatch = colorString.match(/rgb\((\d+)[,\s]+(\d+)[,\s]+(\d+)\)/);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1]),
        g: parseInt(rgbMatch[2]),
        b: parseInt(rgbMatch[3])
      };
    }

    // Default to white if parsing fails
    log('Could not parse color:', colorString);
    return { r: 255, g: 255, b: 255 };
  }

  private async initializeDMX(): Promise<void> {
    try {
      log('Initializing DMX controller on', DMX_PORT);

      this.port = new SerialPort({
        path: DMX_PORT,
        baudRate: DMX_BAUD_RATE,
        dataBits: 8,
        stopBits: 2,
        parity: 'none'
      });

      this.port.on('open', () => {
        log('✅ Connected to DMX device');
        this.isConnected = true;
        this.startDMXTransmission();
      });

      this.port.on('error', (err) => {
        log('❌ DMX port error:', err.message);
        this.isConnected = false;
      });

      this.port.on('close', () => {
        log('📴 DMX port closed');
        this.isConnected = false;
      });

    } catch (error) {
      log('❌ Failed to initialize DMX:', error);
    }
  }

  private startDMXTransmission(): void {
    this.transmissionInterval = setInterval(() => {
      if (this.isConnected) {
        this.sendDMXFrame();
      }
    }, 40); // 25Hz refresh rate
  }

  private sendDMXFrame(): void {
    try {
      this.port.set({brk: true}, () => {
        setTimeout(() => {
          this.port.set({brk: false}, () => {
            setTimeout(() => {
              const frame = Buffer.alloc(DEVICE_CHANNELS + 1);
              frame[0] = 0x00; // Start code

              for (let i = 0; i < DEVICE_CHANNELS; i++) {
                frame[i + 1] = this.dmxData[i];
              }

              this.port.write(frame, (error) => {
                if (error) {
                  log('Write error:', error.message);
                }
              });
            }, 0.1);
          });
        }, 0.2);
      });
    } catch (error) {
      log('Send frame error:', error);
    }
  }

  private setupMIDIListeners(): void {
    this.webSocketCoordinatorServer.registerHandler('midi_note_on', (data: any) => {
      this.handleMIDINoteOn(data.note, data.velocity);
    });
  }

  private startRippleEngine(): void {
    // Update ripples at 60fps for smooth animation
    this.rippleInterval = setInterval(() => {
      this.updateRipples();
      this.renderLights();
    }, 16); // ~60fps
  }

  private updateRipples(): void {
    // Update all active waves
    for (let i = this.activeWaves.length - 1; i >= 0; i--) {
      const wave = this.activeWaves[i];

      // Expand the ripple
      wave.radius += wave.speed;
      wave.age += 16; // Age in milliseconds

      // Fade out over time
      const fadeTime = 800; // 800ms fade
      wave.intensity = Math.max(0, 1 - (wave.age / fadeTime));

      // Remove dead waves
      if (wave.intensity <= 0 || wave.radius > wave.maxRadius) {
        this.activeWaves.splice(i, 1);
      }
    }
  }

  private renderLights(): void {
    // Set master dimmer to full
    this.setMasterDimmer(255);

    // Clear all lights first
    for (let i = 1; i <= NUM_LIGHTS; i++) {
      this.setLightRGB(i, 0, 0, 0);
    }

    if (this.activeWaves.length === 0) {
      return; // No waves to render
    }

    let lightsSet = 0;

    // Calculate combined color for each light from all active waves
    for (let lightPos = 1; lightPos <= NUM_LIGHTS; lightPos++) {
      let combinedR = 0;
      let combinedG = 0;
      let combinedB = 0;

      // Check influence from each wave
      for (const wave of this.activeWaves) {
        const distance = Math.abs(lightPos - wave.centerPosition);

        // Calculate wave influence based on distance and wave properties
        const waveInfluence = this.calculateWaveInfluence(distance, wave);

        if (waveInfluence > 0) {
          // Add this wave's color contribution
          combinedR += wave.color.r * waveInfluence;
          combinedG += wave.color.g * waveInfluence;
          combinedB += wave.color.b * waveInfluence;
        }
      }

      // Clamp colors to valid range
      combinedR = Math.min(255, Math.floor(combinedR));
      combinedG = Math.min(255, Math.floor(combinedG));
      combinedB = Math.min(255, Math.floor(combinedB));

      // Set the light if it has any color
      if (combinedR > 0 || combinedG > 0 || combinedB > 0) {
        this.setLightRGB(lightPos, combinedR, combinedG, combinedB);
        lightsSet++;
      }
    }


  }

  private calculateWaveInfluence(distance: number, wave: RippleWave): number {
    // Create a wave effect with peak at the center and falloff
    const waveWidth = 3; // Width of the wave ring
    const ringDistance = Math.abs(distance - wave.radius);

    if (ringDistance <= waveWidth) {
      // Within the wave ring - calculate intensity
      const ringIntensity = 1 - (ringDistance / waveWidth);
      return wave.intensity * ringIntensity;
    }

    return 0;
  }

  private handleMIDINoteOn(note: number, velocity: number): void {
    // Find which drum this note belongs to
    const drumMapping = this.drumMappings.find(mapping =>
      mapping.midiKeys.includes(note)
    );

    if (!drumMapping) {
      return; // Not a drum we're interested in
    }

    this.createRippleWave(drumMapping, velocity);
  }

  private createRippleWave(drumMapping: DrumMapping, velocity: number): void {
    // Track hit count for alternating colors
    const currentHits = this.drumHitCounts.get(drumMapping.name) || 0;
    this.drumHitCounts.set(drumMapping.name, currentHits + 1);

    // Use alternating color for every other hit
    const useAltColor = (currentHits % 2) === 1;
    const color = useAltColor ? drumMapping.altColor : drumMapping.color;

    // Calculate intensity based on velocity (0-127 MIDI range) - ensure minimum brightness
    const baseIntensity = Math.max(0.3, velocity / 127); // Minimum 30% intensity

    // Create primary ripple wave
    const wave: RippleWave = {
      drumName: drumMapping.name,
      centerPosition: drumMapping.centerPosition,
      color: {
        r: color.r, // Use full color intensity, apply velocity in wave influence
        g: color.g,
        b: color.b
      },
      intensity: baseIntensity,
      radius: 0,
      maxRadius: NUM_LIGHTS, // Can propagate across entire bar
      speed: 0.8, // Lights per frame
      age: 0
    };

    this.activeWaves.push(wave);

    // Create mirror wave if this drum has a mirror position
    if (drumMapping.mirrorPosition !== undefined) {
      const mirrorWave: RippleWave = {
        drumName: drumMapping.name + '_mirror',
        centerPosition: drumMapping.mirrorPosition,
        color: {
          r: color.r,
          g: color.g,
          b: color.b
        },
        intensity: baseIntensity,
        radius: 0,
        maxRadius: NUM_LIGHTS,
        speed: 0.8,
        age: 0
      };

      this.activeWaves.push(mirrorWave);
    }
  }





  private setMasterDimmer(intensity: number): void {
    this.dmxData[0] = Math.max(0, Math.min(255, Math.floor(intensity)));
  }

  private setLightRGB(lightNumber: number, r: number, g: number, b: number): void {
    if (lightNumber < 1 || lightNumber > NUM_LIGHTS) {
      return;
    }

    // Channel 1 = master dimmer
    // Channels 2-4 = Light 1 RGB, etc.
    const baseChannel = 1 + (lightNumber - 1) * 3;

    this.dmxData[baseChannel] = Math.max(0, Math.min(255, Math.floor(r)));
    this.dmxData[baseChannel + 1] = Math.max(0, Math.min(255, Math.floor(g)));
    this.dmxData[baseChannel + 2] = Math.max(0, Math.min(255, Math.floor(b)));
  }

  public turnOffAllLights(): void {
    // Clear all active waves
    this.activeWaves = [];
    this.setMasterDimmer(255); // Keep master at full for ripple effects
  }

  public close(): void {
    log('Closing DMX connection...');

    // Stop ripple engine
    if (this.rippleInterval) {
      clearInterval(this.rippleInterval);
      this.rippleInterval = null;
    }

    // Clear all active waves
    this.activeWaves = [];

    if (this.transmissionInterval) {
      clearInterval(this.transmissionInterval);
      this.transmissionInterval = null;
    }

    this.turnOffAllLights();

    if (this.port?.isOpen) {
      this.port.close();
    }
  }
}
