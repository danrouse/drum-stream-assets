// partial from Streamerbot, since these definitions are in a place without dependencies
type StreamerbotViewer = {
  login: string;
  display: string;
  previousActive: string;
  role: string;
  subscribed: boolean;
};

type WebSocketServerMessage = {
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
  type: 'song_requests_updated',
} | {
  type: 'song_request',
  query: string,
} | {
  type: 'client_remote_control',
  action: ChannelPointReward['name'],
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
};

type WebSocketPlayerMessage = {
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
  type: 'song_paused',
} | {
  type: 'song_stopped',
} | {
  type: 'song_speed',
  speed: number,
} | {
  type: 'song_request_completed',
  id: number,
} | {
  type: 'song_request_removed',
  id: number,
} | {
  type: 'guess_the_song_round_complete',
  winner: string | undefined,
  time: number | undefined,
  otherWinners: string[],
};

export type ChannelPointReward = {
  name: 'MuteCurrentSongDrums',
  duration: number,
} | {
  name: 'SlowDownCurrentSong',
  duration: number,
  amount: number,
} | {
  name: 'SpeedUpCurrentSong',
  duration: number,
  amount: number,
} | {
  name: 'OopsAllFarts',
  duration: number,
} | {
  name: 'ChangeDrumKit',
  duration: number,
} | {
  name: 'NoShenanigans',
  duration: number,
} | {
  name: 'LongSong',
} | {
  name: 'PrioritySong',
} | {
  name: 'NoShenanigansSong',
} | {
  name: 'ResetShenanigans',
};

type WebSocketMessage = WebSocketServerMessage | WebSocketPlayerMessage;
type WebSocketBroadcaster = (payload: WebSocketServerMessage | string) => void;
type WebSocketMessageHandler = (payload: WebSocketMessage) => void;

interface SongData {
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

interface SongRequestData extends SongData {
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

interface LegacySongData {
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

interface DownloadedSong {
  basename: string;
  path: string;

  isVideo: boolean;
  lyricsPath?: string;
}

interface ProcessedSong {
  basename: string;
  songPath: string;
  stemsPath: string;
}

interface SongRequestSource {
  requesterName: string;
  rewardId?: string;
  redemptionId?: string;
}
