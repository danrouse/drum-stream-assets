import { Generated, ColumnType } from 'kysely';

// Use the exact same type definition as music-stem-server
type CreatedAtType = ColumnType<string, string | undefined, string>;

// Use the exact same interfaces as music-stem-server
interface SongRequestsTable {
  id: Generated<number>;
  createdAt: CreatedAtType;
  effectiveCreatedAt: CreatedAtType;

  query: string;
  requester: string | null;
  twitchRewardId: string | null;
  twitchRedemptionId: string | null;
  status: 'processing' | 'ready' | 'fulfilled' | 'cancelled';
  priority: number;
  noShenanigans: number | null;
  songId: number | null;
  fulfilledAt: ColumnType<string, string, string> | null;
  bumpCount: Generated<number>;
}

interface DownloadsTable {
  id: Generated<number>;
  createdAt: CreatedAtType;

  path: string;
  lyricsPath: string | null;
  isVideo: number;

  songRequestId: number;
}

interface SongsTable {
  id: Generated<number>;
  createdAt: CreatedAtType;

  artist: string;
  title: string;
  album: string | null;
  track: number | null;
  duration: number;

  stemsPath: string;

  downloadId: number;
}

interface SongTagsTable {
  id: Generated<number>;
  createdAt: CreatedAtType;

  tag: string;

  songId: number;
}

interface SongVotesTable {
  id: Generated<number>;
  createdAt: CreatedAtType;
  value: number;
  songId: number;
  voterName: string;
}

interface SongHistoryTable {
  id: Generated<number>;
  startedAt: CreatedAtType;
  endedAt: CreatedAtType;
  songId: number;
  songRequestId: number | null;
}

interface StreamHistoryTable {
  id: Generated<number>;
  createdAt: CreatedAtType;
  endedAt: ColumnType<string, string, string> | null;
}

interface NameThatTuneScoresTable {
  id: Generated<number>;
  createdAt: CreatedAtType;
  name: string;
  placement: number;
}

interface UsersTable {
  id: Generated<number>;
  createdAt: Generated<CreatedAtType>;
  name: string;
  nameThatTunePoints: Generated<number>;
  availableBumps: Generated<number>;
  lastFreeBumpStreamHistoryId: number | null;
  availableLongSongs: Generated<number>;
  lastLongSongStreamHistoryId: number | null;
}

export interface Database {
  songRequests: SongRequestsTable;
  downloads: DownloadsTable;
  songs: SongsTable;
  songTags: SongTagsTable;
  songVotes: SongVotesTable;
  songHistory: SongHistoryTable;
  streamHistory: StreamHistoryTable;
  nameThatTuneScores: NameThatTuneScoresTable;
  users: UsersTable;
}
