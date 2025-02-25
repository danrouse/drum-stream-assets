import { sql } from 'kysely';
import { db } from './database';

//
// song request by user
//
export const mostRecentlyRequestedSongByUser = (user: string) => db.selectFrom('songRequests')
  .innerJoin('songs', 'songs.id', 'songRequests.songId')
  .select(['songRequests.id', 'songs.artist', 'songs.title'])
  .where('status', 'in', ['processing', 'ready'])
  .where('requester', '=', user)
  .orderBy('songRequests.id desc')
  .limit(1)
  .execute();

export const nextSongByUser = (user: string) => db.selectFrom('songRequests')
  .innerJoin('songs', 'songs.id', 'songRequests.songId')
  .selectAll('songRequests')
  .select(['songs.title', 'songs.artist'])
  .where('songRequests.status', '=', 'ready')
  .where('songRequests.requester', '=', user)
  .limit(1)
  .orderBy(['songRequests.priority desc', 'songRequests.id asc'])
  .execute();

export const numRequestsByUser = (user: string) => db.selectFrom('songRequests')
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
// song requests by id
//
export async function getTimeUntilSongRequest(songRequestId: number) {
  const priority = await db.selectFrom('songRequests').select('priority').where('id', '=', songRequestId).execute();
  const precedingRequests = await db.selectFrom('songRequests')
    .innerJoin('songs', 'songs.id', 'songRequests.songId')
    .select(db.fn.sum<number>('duration').as('totalDuration'))
    .select(eb => eb(db.fn.countAll<number>(), '+', 1).as('numSongRequests'))
    .where('songRequests.status', '=', 'ready')
    .where(q => q.or([
      q('songRequests.priority', '>', priority[0].priority),
      q.and([q('songRequests.priority', '=', priority[0].priority), q('songRequests.id', '<', songRequestId)])
    ]))
    .orderBy(['songRequests.priority desc', 'songRequests.id asc'])
    .execute();
  return precedingRequests[0];
}

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
  .where('songRequests.status', '=', 'ready')
  .select([
    'songs.id', 'songs.artist', 'songs.title', 'songs.album', 'songs.duration', 'songs.stemsPath',
    'downloads.path as downloadPath', 'downloads.isVideo', 'downloads.lyricsPath',
    'songRequests.requester', 'songRequests.priority', 'songRequests.noShenanigans', 'songRequests.status', 'songRequests.id as songRequestId', 'songRequests.createdAt',
  ])
  .orderBy(['songRequests.priority desc', 'songRequests.order asc', 'songRequests.id asc'])
  .execute();

export const songRequestQueue = () => db.selectFrom('songRequests')
  .innerJoin('songs', 'songs.id', 'songRequests.songId')
  .where('songRequests.status', '=', 'ready')
  .select(['songs.title', 'songs.artist', 'songs.duration', 'songRequests.id'])
  .orderBy(['songRequests.priority desc', 'songRequests.id asc'])
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
