/**
 * Name That Tune module
 *
 * Handles the BRB "Name That Tune" minigame.
 */
import { sql } from 'kysely';
import StreamerbotWebSocketClient from '../../StreamerbotWebSocketClient';
import { WebSocketMessage } from '../../../../shared/messages';
import { db } from '../../database';
import * as queries from '../../queries';
import WebSocketCoordinatorServer from '../../WebSocketCoordinatorServer';

export default class NameThatTuneModule {
  constructor(
    private client: StreamerbotWebSocketClient,
    private wss: WebSocketCoordinatorServer
  ) {
    this.wss.registerHandler('guess_the_song_round_complete', this.handleGuessTheSongRoundComplete);
  }

  private async handleGuessTheSongRoundComplete(payload: WebSocketMessage<'guess_the_song_round_complete'>) {
    if (payload.winner && payload.time) {
      // Record this round's winner
      const roundedTime = Math.round(payload.time * 10) / 10;
      let message = `${payload.winner} got the right answer quickest in ${roundedTime} seconds!`;
      if (payload.otherWinners.length) message += ` (${payload.otherWinners.join(', ')} also got it right!)`
      await this.client.sendTwitchMessage(message);

      db.insertInto('nameThatTuneScores').values([{
        name: payload.winner,
        placement: 1,
      }].concat(payload.otherWinners.map((name, i) => ({
        name,
        placement: i + 2,
      })))).execute();

      // Report win streaks
      const streak = await queries.nameThatTuneWinStreak();
      if (streak[0].streak > 1) {
        await this.client.sendTwitchMessage(`${payload.winner} is on a ${streak[0].streak} round win streak!`);
      }
    }

    // Update scores in leaderboard
    const dailyScores = await queries.nameThatTuneScores()
      .where(sql<any>`datetime(createdAt) > (select datetime(createdAt) from streamHistory order by id desc limit 1)`)
      .execute();
    const weeklyScores = await queries.nameThatTuneScores()
      .where('createdAt', '>', sql<any>`datetime(\'now\', \'-7 day\')`)
      .execute();
    const lifetimeScores = await queries.nameThatTuneScores()
      .execute();
    this.wss.broadcast({ type: 'guess_the_song_scores', daily: dailyScores, weekly: weeklyScores, lifetime: lifetimeScores });
  }
}
