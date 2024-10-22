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
  type: 'song_request_added',
  name: string,
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
  emote: string,
} | {
  type: 'midi_note_on',
  note: number,
  velocity: number,
};

type WebSocketPlayerMessage = {
  type: 'song_changed',
  artist: string,
  title: string,
  duration: number,
  album?: string,
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
};

export type ChannelPointReward = {
  name: 'SongRequest',
} | {
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
};

type WebSocketBroadcaster = (payload: WebSocketServerMessage | string) => void;
type WebSocketMessageHandler = (payload: WebSocketServerMessage | WebSocketPlayerMessage) => void;

interface SongData {
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
  time: Date;
}
type SongRequest = SongRequestSource & DownloadedSong;
