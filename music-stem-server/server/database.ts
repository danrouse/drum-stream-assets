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
import { join } from 'path';
import { readdirSync, readFileSync } from 'fs';
import * as Paths from './paths';
import { LegacySongData } from '../../shared/messages';

type CreatedAtType = ColumnType<Date, string | undefined, never>;

interface SongRequestsTable {
  id: Generated<number>;
  createdAt: CreatedAtType;

  query: string;
  requester: string | null;
  twitchRewardId: string | null;
  twitchRedemptionId: string | null;
  status: 'processing' | 'ready' | 'fulfilled' | 'cancelled';
  priority: number;
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

interface Database {
  songRequests: SongRequestsTable;
  downloads: DownloadsTable;
  songs: SongsTable;
  songTags: SongTagsTable;
}

const dialect = new SqliteDialect({
  database: new SQLite('db.sqlite'),
});

export const db = new Kysely<Database>({
  dialect,
});

export async function initializeDatabase() {
  await db.schema.dropTable('songTags').ifExists().execute();
  await db.schema.dropTable('songs').ifExists().execute();
  await db.schema.dropTable('downloads').ifExists().execute();
  await db.schema.dropTable('songRequests').ifExists().execute();

  await db.schema.createTable('songRequests')
    .ifNotExists()
    .addColumn('id', 'integer', (cb) => cb.primaryKey().autoIncrement().notNull())
    .addColumn('createdAt', 'timestamp', (cb) => cb.notNull().defaultTo(sql`current_timestamp`))
    .addColumn('query', 'varchar(255)', (cb) => cb.notNull())
    .addColumn('requester', 'varchar(255)')
    .addColumn('twitchRewardId', 'varchar(255)')
    .addColumn('twitchRedemptionId', 'varchar(255)')
    .addColumn('status', 'varchar(32)', (cb) => cb.notNull())
    .addColumn('priority', 'integer', (cb) => cb.notNull().defaultTo(0))
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
}

export async function populateDatabaseFromJSON() {
  const downloadFiles = readdirSync(Paths.DOWNLOADS_PATH);
  const songs = JSON.parse(readFileSync('./server/songlist.json', 'utf-8'))
    .filter((s: LegacySongData) => {
      const matchingAudio = downloadFiles.filter(f =>
        [`${s.name}.m4a`, `${s.name}..m4a`].includes(f));
      const matchingMkv = downloadFiles.filter(f =>
        [`${s.name}.mkv`].includes(f));
      const matchingOtherVideo = downloadFiles.filter(f =>
        [`${s.name}.mp4`, `${s.name}.webm`].includes(f));
      const matchingLyrics = downloadFiles.filter(f =>
        [`${s.name}.lrc`, `${s.name}..lrc`].includes(f));
      const matchingVideo = matchingMkv.length ? matchingMkv : matchingOtherVideo;
      if (matchingAudio.length + matchingVideo.length === 0) {
        console.log('NO matches', s.name);
        return false;
      }
      return true;
    }) as LegacySongData[];

  const songRequestIds = await db.insertInto('songRequests')
    .values(songs.map(s => ({
      query: s.name,
      requester: s.requesterName,
      status: 'fulfilled',
      priority: 0,
    })))
    .returning(['id as id', 'query as query'])
    .execute();
  
  const downloadIds = await db.insertInto('downloads')
    .values(songs.map(s => {
      const matchingAudio = downloadFiles.filter(f =>
        [`${s.name}.m4a`, `${s.name}..m4a`].includes(f));
      const matchingMkv = downloadFiles.filter(f =>
        [`${s.name}.mkv`].includes(f));
      const matchingOtherVideo = downloadFiles.filter(f =>
        [`${s.name}.mp4`, `${s.name}.webm`].includes(f));
      const matchingLyrics = downloadFiles.filter(f =>
        [`${s.name}.lrc`, `${s.name}..lrc`].includes(f))
        .map(f => join(Paths.DOWNLOADS_PATH, f));
      const matchingVideo = matchingMkv.length ? matchingMkv : matchingOtherVideo;
      const path = matchingAudio.length ? matchingAudio[0] : matchingVideo[0];
      return {
        path: join(Paths.DOWNLOADS_PATH, path!),
        songRequestId: songRequestIds.find(({id, query}) => query === s.name)!.id,
        isVideo: matchingVideo.length > 0 ? 1 : 0,
        lyricsPath: matchingLyrics[0],
      };
    }))
    .returning(['id as id', 'songRequestId as songRequestId'])
    .execute();

  const songIds = await db.insertInto('songs')
    .values(songs.map(s => {
      const srId = songRequestIds.find(({id, query}) => query === s.name)!.id;
      const downloadId = downloadIds.find(({id, songRequestId}) => songRequestId === srId)!.id;
      const youtubeId = s.title.match(/(.+) \[(.{11})\]$/);
      const title = youtubeId ? youtubeId[1] : s.title;
      const album = youtubeId ? `YouTube [${youtubeId[2]}]` : s.album;
      return {
        artist: s.artist,
        title,
        album,
        track: s.track?.[0],
        duration: s.duration,
        stemsPath: join(Paths.STEMS_PATH, s.name),
        downloadId,
      };
    }))
    .execute();
}
