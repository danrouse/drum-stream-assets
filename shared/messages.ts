import * as Streamerbot from './streamerbot';

// partial from Streamerbot, since these definitions are in a place without dependencies
export type StreamerbotViewer = {
  login: string;
  display: string;
  previousActive: string;
  role: string;
  subscribed: boolean;
  online: boolean;
};

export type WebSocketServerMessage = {
  type: 'download_start',
  query: string,
} | {
  type: 'download_complete',
  name: string,
} | {
  type: 'download_error',
  query: string,
} | {
  type: 'demucs_start',
  name: string,
} | {
  type: 'demucs_progress',
  progress: number,
  name: string,
} | {
  type: 'demucs_complete',
  stems: string,
} | {
  type: 'demucs_error',
  message: string,
} | {
  type: 'song_request_added',
  songRequestId: number,
} | {
  type: 'song_request_removed',
  songRequestId: number,
} | {
  type: 'song_request',
  query: string,
} | {
  type: 'client_remote_control',
  action: Streamerbot.TwitchRewardName,
  duration?: number,
  amount?: number,
} | {
  type: 'emote_used',
  emoteURLs: string[],
} | {
  type: 'emote_default_set',
  emoteURL: string,
} | {
  type: 'midi_note_on',
  note: number,
  velocity: number,
} | {
  type: 'viewers_update',
  viewers: StreamerbotViewer[],
} | {
  type: 'obs_scene_changed',
  scene: string,
  oldScene: string,
} | {
  type: 'chat_message',
  user: string,
  message: string,
} | {
  type: 'guess_the_song_scores',
  daily: Array<{ name: string, count: number }>,
  weekly: Array<{ name: string, count: number }>,
  lifetime: Array<{ name: string, count: number }>,
};

export type WebSocketPlayerMessage = {
  type: 'song_changed',
  song: SongData,
  previousSongs?: SongData[],
  nextSongs?: SongData[],
} | {
  type: 'song_progress',
  timestamp: number,
} | {
  type: 'song_played',
  timestamp: number,
} | {
  type: 'song_playpack_paused',
} | {
  type: 'song_stopped',
} | {
  type: 'song_speed',
  speed: number,
} | {
  type: 'song_playback_started',
  id: number,
  songRequestId?: number | null,
} | {
  type: 'song_playback_completed',
  id: number,
  songRequestId?: number | null,
} | {
  type: 'song_request_removed',
  songRequestId: number,
} | {
  type: 'guess_the_song_round_complete',
  winner: string | undefined,
  time: number | undefined,
  otherWinners: string[],
};

export type WebSocketMessage = WebSocketServerMessage | WebSocketPlayerMessage;
export type WebSocketBroadcaster = (payload: WebSocketServerMessage) => void;
export type WebSocketMessageHandler = (payload: WebSocketMessage) => void;

export interface SongData {
  id: number;
  createdAt: string | null;
  artist: string;
  title: string;
  album: string | null;
  duration: number;
  stemsPath: string;
  downloadPath: string | null;
  isVideo: number | null;
  lyricsPath: string | null;
  requester?: string | null;
  priority?: number | null;
  noShenanigans?: number | null;
  status?: 'processing' | 'ready' | 'fulfilled' | 'cancelled' | null;
  songRequestId?: number | null;
}

export interface SongRequestData extends SongData {
  downloadPath: string;
  isVideo: number;
  lyricsPath: string | null;
  requester: string | null;
  priority: number;
  noShenanigans?: number | null;
  status: 'processing' | 'ready' | 'fulfilled' | 'cancelled';
  songRequestId: number;
  createdAt: string;
}

export interface LegacySongData {
  name: string; // for paths
  artist: string;
  title: string;
  stems: string[];
  downloadDate: Date;
  album: string;
  track: [number, number];
  duration: number;

  requesterName?: string;
  requestTime?: Date;
}

export interface DownloadedSong {
  basename: string;
  path: string;

  isVideo: boolean;
  lyricsPath?: string;
}

export interface ProcessedSong {
  basename: string;
  songPath: string;
  stemsPath: string;
}

export interface SongRequestSource {
  requesterName: string;
  twitchRewardId?: string;
  twitchRedemptionId?: string;
}
