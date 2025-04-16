import { sql } from 'kysely';
import StreamerbotWebSocketClient, { CommandPayload } from '../../StreamerbotWebSocketClient';
import { db } from '../../database';
import * as queries from '../../queries';
import { WebSocketMessage } from '../../../../shared/messages';
import WebSocketCoordinatorServer from '../../WebSocketCoordinatorServer';
import { MIDINoteDefinition, midiNoteDefinitions, MIDI_TRIGGER_VELOCITY_MAX } from '../../../../shared/midiNoteDefinitions';

export default class GambaModule {
  private client: StreamerbotWebSocketClient;
  private wss: WebSocketCoordinatorServer;

  private selectedDrum: MIDINoteDefinition | undefined;
  private count = 0;
  private isTracking = false;

  constructor(
    client: StreamerbotWebSocketClient,
    wss: WebSocketCoordinatorServer
  ) {
    this.client = client;
    this.wss = wss;

    this.client.registerCustomEventHandler('GambaStart', this.startGamba);
    this.client.registerCustomEventHandler('GambaEnd', this.resolveGamba);
    this.client.registerCustomEventHandler('GambaCancel', this.cancelGamba);

    this.wss.registerHandler('midi_note_on', ({ note, velocity }) => this.handleMidiNote(note, velocity));
    this.wss.registerHandler('song_playback_started', this.prepareGamba);
    this.wss.registerHandler('song_playback_completed', this.stopTrackingGamba);
  }

  private startGamba = async () => {
    this.selectedDrum = midiNoteDefinitions[Math.floor(Math.random() * midiNoteDefinitions.length)];
    this.count = 0;
    await this.client.doAction('Create Gamba (Twitch)', {
      // Length must be <= 45 chars
      // This maxes out with longest drum name of "Splash2"!
      predictionTitle: `How many times will ${this.selectedDrum.name} be hit next song?`,
      // Current streamerbot setup only handles two options (as results 0 or 1)
      option1: 'Even',
      option2: 'Odd',
      duration: 60,
    });
    this.wss.broadcast({
      type: 'gamba_started',
      drumName: this.selectedDrum.name,
    });
  };

  private prepareGamba = () => {
    this.count = 0;
    this.isTracking = true;
    this.wss.broadcast({
      type: 'gamba_progress',
      count: this.count,
    });
  };

  private stopTrackingGamba = () => {
    this.isTracking = false;
  };

  private resolveGamba = async () => {
    const isOdd = Boolean(this.count % 2);
    await this.client.doAction('Close Gamba (Twitch)', {
      result: isOdd ? 1 : 0,
    });
    this.wss.broadcast({
      type: 'gamba_complete',
    });
    this.count = 0;
    this.isTracking = false;
  };

  private cancelGamba = async () => {
    await this.client.doAction('Cancel Gamba (Twitch)');
    this.count = 0;
    this.isTracking = false;
  };

  private handleMidiNote = (note: number, velocity: number) => {
    if (!this.isTracking) return;
    const normVelocity = velocity / MIDI_TRIGGER_VELOCITY_MAX;
    if (this.selectedDrum?.keys.includes(note)/* && normVelocity > 0.2*/) {
      this.count += 1;
      this.wss.broadcast({
        type: 'gamba_progress',
        count: this.count,
      });
    }
  };
}
