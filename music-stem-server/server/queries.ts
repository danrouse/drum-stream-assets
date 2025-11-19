/**
 * Most of the Kysely queries are defined and exported here;
 * There turned out to be a few queries doing nearly the same thing,
 * but also with slightly different (in a bad way) logic, so
 * they have been colocated here to make it easier to keep track.
 */
import { sql } from 'kysely';
import { db } from './database';
import { SongRequester } from '../../shared/messages';

//
// song request by user
//
export const songRequestsByUser = (user: string) => db.selectFrom('songRequests')
  .innerJoin('songs', 'songs.id', 'songRequests.songId')
  .select(['songRequests.id', 'songs.artist', 'songs.title', 'songRequests.priority', 'songRequests.noShenanigans', 'songRequests.effectiveCreatedAt'])
  .where('status', 'in', ['processing', 'ready'])
  .where('requester', '=', user)
  .orderBy('songRequests.effectiveCreatedAt asc')
  .execute();

export const numOpenRequestsByUser = (user: string) => db.selectFrom('songRequests')
  .select(db.fn.countAll().as('count'))
  .where('requester', '=', user)
  .where('status', 'in', ['processing', 'ready'])
  .execute();

export const lastRequestTimeByUser = (user: string) => db.selectFrom('songRequests')
  .innerJoin('songs', 'songs.id', 'songRequests.songId')
  .select(['songRequests.createdAt', 'songs.duration'])
  .where('requester', '=', user)
  .where('status', '=', 'ready')
  .orderBy('songRequests.id desc')
  .execute();

export const requestsByUserToday = (user: string) => db.selectFrom('songRequests')
  .select(['songRequests.id', 'songRequests.priority'])
  .where('requester', '=', user)
  .where('status', '!=', 'cancelled')
  .where('createdAt', '>', sql<any>`(select createdAt from streamHistory order by id desc limit 1)`)
  .orderBy('id desc')
  .execute();


//
// songs and song requests
//

export const allSongs = () => db.selectFrom('songs')
  .leftJoin('downloads', 'downloads.id', 'downloadId')
  .leftJoin('songRequests', 'songRequests.id', 'downloads.songRequestId')
  .select([
    'songs.id', 'songs.artist', 'songs.title', 'songs.album', 'songs.duration', 'songs.stemsPath', 'songs.createdAt',
    'downloads.path as downloadPath', 'downloads.isVideo', 'downloads.lyricsPath',
    'songRequests.requester',
  ])
  .execute();

export const allSongRequests = () => db.selectFrom('songRequests')
  .innerJoin('songs', 'songs.id', 'songRequests.songId')
  .innerJoin('downloads', 'downloads.id', 'songs.downloadId')
  .leftJoin(
    db.selectFrom('songRequests as sr2')
      .select([
        'sr2.requester',
        db.fn.countAll<number>().as('fulfilledToday')
      ])
      .where('sr2.status', '=', 'fulfilled')
      .where('sr2.createdAt', '>', sql<string>`(select createdAt from streamHistory order by id desc limit 1)`)
      .groupBy('sr2.requester')
      .as('fulfilledCounts'),
    join => join.onRef('fulfilledCounts.requester', '=', 'songRequests.requester')
  )
  .leftJoin(
    db.selectFrom('songRequests as sr3')
      .select(['sr3.requester', sql<string>`max(sr3.fulfilledAt)`.as('lastFulfilledAt')])
      .where('sr3.status', '=', 'fulfilled')
      .where('sr3.createdAt', '>', sql<string>`(select createdAt from streamHistory order by id desc limit 1)`)
      .orderBy('sr3.fulfilledAt', 'desc')
      .groupBy('sr3.requester')
      .as('lastFulfilled'),
    join => join.onRef('lastFulfilled.requester', '=', 'songRequests.requester')
  )
  .leftJoin(
    db.selectFrom('users')
      .select(['name', 'currentBumpCount'])
      .as('users'),
    join => join.onRef('users.name', '=', 'songRequests.requester')
  )
  .where('songRequests.status', '=', 'ready')
  .select([
    'songs.id', 'songs.artist', 'songs.title', 'songs.album', 'songs.duration', 'songs.stemsPath',
    'downloads.path as downloadPath', 'downloads.isVideo', 'downloads.lyricsPath',
    'songRequests.requester', 'songRequests.priority', 'songRequests.noShenanigans', 'songRequests.status', 'songRequests.id as songRequestId', 'songRequests.createdAt', 'songRequests.effectiveCreatedAt',
    'fulfilledCounts.fulfilledToday',
    'lastFulfilled.lastFulfilledAt',
    'users.currentBumpCount',
  ])
  .orderBy(['songRequests.priority desc', 'songRequests.effectiveCreatedAt asc'])
  .execute();

export const allSongRequesters = () => db.selectFrom('songRequests')
  .where('songRequests.status', 'in', ['processing', 'ready'])
  .groupBy('songRequests.requester')
  .innerJoin('songs', 'songs.id', 'songRequests.songId')
  .leftJoin(
    db.selectFrom('songRequests as sr2')
      .select([
        'sr2.requester',
        db.fn.countAll<number>().as('fulfilledToday')
      ])
      .where('sr2.status', '=', 'fulfilled')
      .where('sr2.createdAt', '>', sql<string>`(select createdAt from streamHistory order by id desc limit 1)`)
      .groupBy('sr2.requester')
      .as('fulfilledCounts'),
    join => join.onRef('fulfilledCounts.requester', '=', 'songRequests.requester')
  )
  .leftJoin(
    db.selectFrom('songRequests as sr3')
      .select(['sr3.requester', sql<string>`max(sr3.fulfilledAt)`.as('lastFulfilledAt')])
      .where('sr3.status', '=', 'fulfilled')
      .where('sr3.createdAt', '>', sql<string>`(select createdAt from streamHistory order by id desc limit 1)`)
      .orderBy('sr3.fulfilledAt', 'desc')
      .groupBy('sr3.requester')
      .as('lastFulfilled'),
    join => join.onRef('lastFulfilled.requester', '=', 'songRequests.requester')
  )
  .innerJoin(
    db.selectFrom('users')
      .select(['name', 'currentBumpCount'])
      .as('users'),
    join => join.onRef('users.name', '=', 'songRequests.requester')
  )
  .select([
    sql<string>`coalesce(songRequests.requester, 'danny_the_liar')`.as('name'),
    sql<string>`group_concat(case when songs.artist == '' then songs.title else concat(songs.artist, ' - ', songs.title) end, '\n')`.as('requestLabels'),
    sql<number>`(julianday('now') - julianday(min(songRequests.effectiveCreatedAt))) * 24 * 60`.as('oldestRequestAgeMinutes'),
    'fulfilledCounts.fulfilledToday',
    'lastFulfilled.lastFulfilledAt',
    'users.currentBumpCount',
  ])
  .execute() satisfies Promise<SongRequester[]>;

export const songRequestQueue = () => db.selectFrom('songRequests')
  .innerJoin('songs', 'songs.id', 'songRequests.songId')
  .where('songRequests.status', '=', 'ready')
  .select(['songs.title', 'songs.artist', 'songs.duration', 'songRequests.id'])
  .orderBy(['songRequests.priority desc', 'songRequests.effectiveCreatedAt asc'])
  .execute();


//
// non-song request
//

export const songsPlayedTodayCount = () => db.selectFrom('songHistory')
  .select(db.fn.countAll<number>().as('count'))
  .where(sql<any>`datetime(songHistory.startedAt) > (select datetime(createdAt) from streamHistory order by id desc limit 1)`)
  .execute();

export const currentStreamHistory = () => db.selectFrom('streamHistory')
  .select('id')
  .orderBy('id desc')
  .limit(1)
  .execute();

//
// name that tune
//

export const nameThatTuneScores = () => db.selectFrom('nameThatTuneScores')
  .select('name')
  .select(q => q.fn.count<number>('id').as('count'))
  .groupBy('name')
  .where('placement', '=', 1)
  .orderBy('count desc')
  .orderBy('createdAt desc');

export const nameThatTuneWinStreak = () => db
  .with('currentWinner', q => q.selectFrom('nameThatTuneScores').select('name as n').where('placement', '=', 1).orderBy('id desc').limit(1))
  .selectFrom(['nameThatTuneScores', 'currentWinner'])
  .select('name')
  .select(q => q.fn.count<number>('id').as('streak'))
  .where('id', '>', q => q.selectFrom('nameThatTuneScores')
    .select('id')
    .where('placement', '=', 1)
    .where('name', '!=', sql<string>`currentWinner.n`)
    .orderBy('id desc')
  )
  .where('placement', '=', 1)
  .where('name', '=', sql<string>`currentWinner.n`)
  .execute();

//
// song voting
//
export const songVotesSinceTime = (songId: number, time: string) => db.selectFrom('songVotes')
  .select(db.fn.countAll().as('voteCount'))
  .select(db.fn.sum('songVotes.value').as('value'))
  .where('songId', '=', songId)
  .where('createdAt', '>', sql<any>`datetime(${time})`)
  .execute();

export const existingSongVoteForUser = (songId: number, user: string) => db.selectFrom('songVotes')
  .select(['id'])
  .where('voterName', '=', user)
  .where('songId', '=', songId)
  .execute();

export const songVoteScore = (songId: number) => db.selectFrom('songVotes')
  .select(db.fn.sum('value').as('value'))
  .where('songId', '=', songId)
  .execute();
