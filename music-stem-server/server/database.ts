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
  SqliteDialect,
  sql,
} from 'kysely';
import SQLite from 'better-sqlite3';

type CreatedAtType = ColumnType<string, string | undefined, string>;

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
  availableBumps: Generated<number>;
  lastFreeBumpStreamHistoryId: number | null;
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

const dialect = new SqliteDialect({
  database: new SQLite('db.sqlite'),
});

export const db = new Kysely<Database>({
  dialect,
});

export async function initializeDatabase() {
  await db.executeQuery(sql`PRAGMA foreign_keys = OFF;`.compile(db));
  await db.schema.dropTable('songTags').ifExists().execute();
  await db.schema.dropTable('songVotes').ifExists().execute();
  await db.schema.dropTable('songs').ifExists().execute();
  await db.schema.dropTable('downloads').ifExists().execute();
  await db.schema.dropTable('songRequests').ifExists().execute();
  await db.schema.dropTable('songHistory').ifExists().execute();
  await db.schema.dropTable('streamHistory').ifExists().execute();
  await db.schema.dropTable('nameThatTuneScores').ifExists().execute();
  await db.executeQuery(sql`PRAGMA foreign_keys = ON;`.compile(db));

  await db.schema.createTable('songRequests')
    .ifNotExists()
    .addColumn('id', 'integer', (cb) => cb.primaryKey().autoIncrement().notNull())
    .addColumn('createdAt', 'timestamp', (cb) => cb.notNull().defaultTo(sql`current_timestamp`))
    .addColumn('effectiveCreatedAt', 'timestamp', (cb) => cb.notNull().defaultTo(sql`current_timestamp`))
    .addColumn('fulfilledAt', 'timestamp')
    .addColumn('query', 'varchar(255)', (cb) => cb.notNull())
    .addColumn('requester', 'varchar(255)')
    .addColumn('twitchRewardId', 'varchar(255)')
    .addColumn('twitchRedemptionId', 'varchar(255)')
    .addColumn('status', 'varchar(32)', (cb) => cb.notNull())
    .addColumn('priority', 'integer', (cb) => cb.notNull().defaultTo(0))
    .addColumn('noShenanigans', 'integer', (cb) => cb.notNull().defaultTo(0))
    .addColumn('songId', 'integer', (cb) => cb.references('songs.id'))
    .execute();

  await db.schema.createTable('downloads')
    .ifNotExists()
    .addColumn('id', 'integer', (cb) => cb.primaryKey().autoIncrement().notNull())
    .addColumn('createdAt', 'timestamp', (cb) => cb.notNull().defaultTo(sql`current_timestamp`))
    .addColumn('path', 'varchar(255)', (cb) => cb.notNull())
    .addColumn('lyricsPath', 'varchar(255)')
    .addColumn('isVideo', 'boolean', (cb) => cb.notNull().defaultTo(false))
    .addColumn('songRequestId', 'integer', (cb) => cb.notNull().references('songRequests.id'))
    .execute();

  await db.schema.createTable('songs')
    .ifNotExists()
    .addColumn('id', 'integer', (cb) => cb.primaryKey().autoIncrement().notNull())
    .addColumn('createdAt', 'timestamp', (cb) => cb.notNull().defaultTo(sql`current_timestamp`))
    .addColumn('artist', 'varchar(255)', (cb) => cb.notNull())
    .addColumn('title', 'varchar(255)', (cb) => cb.notNull())
    .addColumn('album', 'varchar(255)')
    .addColumn('track', 'integer')
    .addColumn('duration', 'real', (cb) => cb.notNull())
    .addColumn('stemsPath', 'varchar(255)', (cb) => cb.notNull())
    .addColumn('downloadId', 'integer', (cb) => cb.notNull().references('downloads.id'))
    .execute();

  await db.schema.createTable('songTags')
    .ifNotExists()
    .addColumn('id', 'integer', (cb) => cb.primaryKey().autoIncrement().notNull())
    .addColumn('createdAt', 'timestamp', (cb) => cb.notNull().defaultTo(sql`current_timestamp`))
    .addColumn('tag', 'varchar(255)', (cb) => cb.notNull())
    .addColumn('songId', 'integer', (cb) => cb.notNull().references('songs.id'))
    .execute();

  await db.schema.createTable('songVotes')
    .ifNotExists()
    .addColumn('id', 'integer', (cb) => cb.primaryKey().autoIncrement().notNull())
    .addColumn('createdAt', 'timestamp', (cb) => cb.notNull().defaultTo(sql`current_timestamp`))
    .addColumn('value', 'integer', (cb) => cb.notNull().defaultTo(0))
    .addColumn('songId', 'integer', (cb) => cb.notNull().references('songs.id'))
    .addColumn('voterName', 'varchar(255)', (cb) => cb.notNull())
    .execute();

  await db.schema.createTable('songHistory')
    .ifNotExists()
    .addColumn('id', 'integer', (cb) => cb.primaryKey().autoIncrement().notNull())
    .addColumn('startedAt', 'timestamp', (cb) => cb.notNull())
    .addColumn('endedAt', 'timestamp')
    .addColumn('songId', 'integer', (cb) => cb.notNull().references('songs.id'))
    .addColumn('songRequestId', 'integer', (cb) => cb.references('songRequests.id'))
    .execute();

  await db.schema.createTable('streamHistory')
    .ifNotExists()
    .addColumn('id', 'integer', (cb) => cb.primaryKey().autoIncrement().notNull())
    .addColumn('createdAt', 'timestamp', (cb) => cb.notNull().defaultTo(sql`current_timestamp`))
    .addColumn('endedAt', 'timestamp')
    .execute();

  await db.schema.createTable('nameThatTuneScores')
    .ifNotExists()
    .addColumn('id', 'integer', (cb) => cb.primaryKey().autoIncrement().notNull())
    .addColumn('createdAt', 'timestamp', (cb) => cb.notNull().defaultTo(sql`current_timestamp`))
    .addColumn('name', 'varchar(255)', (cb) => cb.notNull())
    .addColumn('placement', 'integer', (cb) => cb.notNull())
    .execute();

  await db.schema.createTable('users')
    .ifNotExists()
    .addColumn('id', 'integer', (cb) => cb.primaryKey().autoIncrement().notNull())
    .addColumn('createdAt', 'timestamp', (cb) => cb.notNull().defaultTo(sql`current_timestamp`))
    .addColumn('name', 'varchar(255)', (cb) => cb.notNull())
    .addColumn('nameThatTunePoints', 'integer', (cb) => cb.notNull().defaultTo(0))
    .addColumn('availableBumps', 'integer', (cb) => cb.notNull().defaultTo(0))
    .addColumn('lastFreeBumpStreamHistoryId', 'integer', (cb) => cb.references('streamHistory.id'))
    .execute();
}
