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
}

export default class DMXLightingModule {
  private port!: SerialPort; // Will be initialized in initializeDMX
  private dmxData: Uint8Array;
  private isConnected: boolean = false;
  private transmissionInterval: NodeJS.Timeout | null = null;
  private fadeIntervals: Map<string, NodeJS.Timeout> = new Map();

  // Define drum-to-light mappings (mirrored layout)
  // Layout: Kick(4) + Tom4(3) + Tom3(3) + Tom2(3) + Tom1(3) + Snare(4) + Tom1(3) + Tom2(3) + Tom3(3) + Tom4(3) + Kick(4) = 40 lights
  private drumMappings: DrumMapping[] = [
    {
      name: 'Kick',
      startLight: 1,
      endLight: 4,
      midiKeys: midiNoteKeysByName.Kick,
      color: this.parseColor('#444')
    },
    {
      name: 'Tom4',
      startLight: 5,
      endLight: 7,
      midiKeys: midiNoteKeysByName.Tom4,
      color: this.parseColor('rgb(60 145 40)')
    },
    {
      name: 'Tom3',
      startLight: 8,
      endLight: 10,
      midiKeys: midiNoteKeysByName.Tom3,
      color: this.parseColor('rgb(77 218 134)')
    },
    {
      name: 'Tom2',
      startLight: 11,
      endLight: 13,
      midiKeys: midiNoteKeysByName.Tom2,
      color: this.parseColor('rgb(94 201 231)')
    },
    {
      name: 'Tom1',
      startLight: 14,
      endLight: 16,
      midiKeys: midiNoteKeysByName.Tom1,
      color: this.parseColor('rgb(94 120 231)')
    },
    {
      name: 'Snare',
      startLight: 17,
      endLight: 24, // Middle 8 lights for snare (since it's the most important)
      midiKeys: midiNoteKeysByName.Snare,
      color: this.parseColor('rgb(223, 25, 25)')
    }
  ];

  constructor(private webSocketCoordinatorServer: WebSocketCoordinatorServer) {
    this.dmxData = new Uint8Array(DMX_UNIVERSE_SIZE);
    this.initializeDMX();
    this.setupMIDIListeners();
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

  private handleMIDINoteOn(note: number, velocity: number): void {
    // Find which drum this note belongs to
    const drumMapping = this.drumMappings.find(mapping =>
      mapping.midiKeys.includes(note)
    );

    if (!drumMapping) {
      return; // Not a drum we're interested in
    }

    log(`🥁 ${drumMapping.name} hit (note ${note}, velocity ${velocity})`);
    this.triggerDrumLights(drumMapping, velocity);
  }



  private triggerDrumLights(drumMapping: DrumMapping, velocity: number): void {
    // Cancel any existing fade for this drum
    const fadeKey = drumMapping.name;
    if (this.fadeIntervals.has(fadeKey)) {
      clearInterval(this.fadeIntervals.get(fadeKey)!);
      this.fadeIntervals.delete(fadeKey);
    }

    // Calculate brightness based on velocity (0-127 MIDI range)
    const brightness = Math.floor((velocity / 127) * 255);

    // Set master dimmer
    this.setMasterDimmer(255);

    // Light up the mirrored sections
    // Left side (start of bar)
    for (let i = drumMapping.startLight; i <= drumMapping.endLight; i++) {
      this.setLightRGB(i,
        Math.floor(drumMapping.color.r * brightness / 255),
        Math.floor(drumMapping.color.g * brightness / 255),
        Math.floor(drumMapping.color.b * brightness / 255)
      );
    }

    // Right side (end of bar) - mirror the positions
    const mirrorStart = NUM_LIGHTS - drumMapping.endLight + 1;
    const mirrorEnd = NUM_LIGHTS - drumMapping.startLight + 1;
    for (let i = mirrorStart; i <= mirrorEnd; i++) {
      this.setLightRGB(i,
        Math.floor(drumMapping.color.r * brightness / 255),
        Math.floor(drumMapping.color.g * brightness / 255),
        Math.floor(drumMapping.color.b * brightness / 255)
      );
    }

    // Start fade out after brief flash
    setTimeout(() => {
      this.fadeOutDrumLights(drumMapping);
    }, 100);
  }

  private fadeOutDrumLights(drumMapping: DrumMapping): void {
    let brightness = 255;
    const fadeInterval = setInterval(() => {
      brightness -= 30; // Fade speed

      if (brightness <= 0) {
        // Turn off completely
        for (let i = drumMapping.startLight; i <= drumMapping.endLight; i++) {
          this.setLightRGB(i, 0, 0, 0);
        }

        const mirrorStart = NUM_LIGHTS - drumMapping.endLight + 1;
        const mirrorEnd = NUM_LIGHTS - drumMapping.startLight + 1;
        for (let i = mirrorStart; i <= mirrorEnd; i++) {
          this.setLightRGB(i, 0, 0, 0);
        }

        clearInterval(fadeInterval);
        this.fadeIntervals.delete(drumMapping.name);
      } else {
        // Apply faded color
        const fadedColor = {
          r: Math.floor(drumMapping.color.r * brightness / 255),
          g: Math.floor(drumMapping.color.g * brightness / 255),
          b: Math.floor(drumMapping.color.b * brightness / 255)
        };

        // Left side
        for (let i = drumMapping.startLight; i <= drumMapping.endLight; i++) {
          this.setLightRGB(i, fadedColor.r, fadedColor.g, fadedColor.b);
        }

        // Right side (mirrored)
        const mirrorStart = NUM_LIGHTS - drumMapping.endLight + 1;
        const mirrorEnd = NUM_LIGHTS - drumMapping.startLight + 1;
        for (let i = mirrorStart; i <= mirrorEnd; i++) {
          this.setLightRGB(i, fadedColor.r, fadedColor.g, fadedColor.b);
        }
      }
    }, 40); // Update every 40ms

    this.fadeIntervals.set(drumMapping.name, fadeInterval);
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
    this.setMasterDimmer(0);
    for (let i = 1; i <= NUM_LIGHTS; i++) {
      this.setLightRGB(i, 0, 0, 0);
    }
  }

  public close(): void {
    log('Closing DMX connection...');

    // Clear all fade intervals
    this.fadeIntervals.forEach(interval => clearInterval(interval));
    this.fadeIntervals.clear();

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
