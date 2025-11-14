/**
 * Database definitions using Kysely
 * Interfaces and types are exported here,
 * as well as an `initializeDatabase` function which can be used to
 * handle initial DB setup (used to set up a manual testing env, at least)
 */
import {
  Kysely,
  ColumnType,
  Generated,
  Selectable,
  Insertable,
  Updateable,
} from 'kysely';
import { HttpD1Dialect } from './HttpD1Dialect';

type CreatedAtType = ColumnType<string, string | undefined, string>;

interface SongRequestsTable {
  id: Generated<number>;
  createdAt: CreatedAtType;
  effectiveCreatedAt: CreatedAtType;

  query: string;
  requester: string | null;
  twitchRewardId: string | null;
  twitchRedemptionId: string | null;
  status: 'processing' | 'ready' | 'fulfilled' | 'cancelled' | 'playing';
  priority: number;
  noShenanigans: number | null;
  songId: number | null;
  fulfilledAt: ColumnType<string, string, string> | null;
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

  tag: string; // NB: Not enum?

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
  startedAt: CreatedAtType;
  endedAt: CreatedAtType;
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
  currentBumpCount: Generated<number>;
  lastFreeBumpStreamHistoryId: number | null;
  availableLongSongs: Generated<number>;
  lastLongSongStreamHistoryId: number | null;
}

export type SongRequest = Selectable<SongRequestsTable>;
export type NewSongRequest = Insertable<SongRequestsTable>;
export type SongRequestUpdate = Updateable<SongRequestsTable>;
export type Download = Selectable<DownloadsTable>;
export type NewDownload = Insertable<DownloadsTable>;
export type DownloadUpdate = Updateable<DownloadsTable>;
export type Song = Selectable<SongsTable>;
export type NewSong = Insertable<SongsTable>;
export type SongUpdate = Updateable<SongsTable>;
export type SongTag = Selectable<SongTagsTable>;
export type NewSongTag = Insertable<SongTagsTable>;
export type SongTagUpdate = Updateable<SongTagsTable>;
export type SongVote = Selectable<SongVotesTable>;
export type NewSongVote = Insertable<SongVotesTable>;
export type SongVoteUpdate = Updateable<SongVotesTable>;
export type SongHistory = Selectable<SongHistoryTable>;
export type NewSongHistory = Insertable<SongHistoryTable>;
export type SongHistoryUpdate = Updateable<SongHistoryTable>;
export type StreamHistory = Selectable<StreamHistoryTable>;
export type NewStreamHistory = Insertable<StreamHistoryTable>;
export type StreamHistoryUpdate = Updateable<StreamHistoryTable>;
export type NameThatTuneScore = Selectable<NameThatTuneScoresTable>;
export type NewNameThatTuneScore = Insertable<NameThatTuneScoresTable>;
export type NameThatTuneScoreUpdate = Updateable<NameThatTuneScoresTable>;
export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

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

export const db = new Kysely<Database>({
  dialect: new HttpD1Dialect({
    workerUrl: process.env.CLOUDFLARE_WORKER_URL || 'https://songs.dannytheliar.com',
    apiKey: process.env.DATABASE_API_KEY || '',
  }),
});
