type WebSocketOutgoingMessage = {
  type: 'download_start',
  query: string,
} | {
  type: 'download_complete',
  name: string,
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
};

type WebSocketIncomingMessage = {
  type: 'song_changed',
  artist: string,
  title: string,
  duration: number,
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
};

interface SongData {
  name: string; // for paths
  artist: string;
  title: string;
  stems: string[];
  downloadDate: Date;
  album: string;
  track: [number, number];
}

