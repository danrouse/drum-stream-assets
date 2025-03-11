/**
 * Name That Tune module
 *
 * Handles the BRB "Name That Tune" minigame.
 */
import { sql } from 'kysely';
import StreamerbotWebSocketClient from '../../StreamerbotWebSocketClient';
import { WebSocketBroadcaster, WebSocketMessage } from '../../../../shared/messages';
import { db } from '../../database';
import * as queries from '../../queries';

export default class NameThatTuneModule {
  private client: StreamerbotWebSocketClient;
  private broadcast: WebSocketBroadcaster;

  constructor(client: StreamerbotWebSocketClient, broadcast: WebSocketBroadcaster) {
    this.client = client;
    this.broadcast = broadcast;
  }

  public messageHandler = async (payload: WebSocketMessage) => {
    if (payload.type === 'guess_the_song_round_complete') {
      this.handleGuessTheSongRoundComplete(payload.winner, payload.time, payload.otherWinners);
    }
  }

  private async handleGuessTheSongRoundComplete(winner?: string, time?: number, otherWinners: string[] = []) {
    if (winner && time) {
      // Record this round's winner
      const roundedTime = Math.round(time * 10) / 10;
      let message = `${winner} got the right answer quickest in ${roundedTime} seconds!`;
      if (otherWinners.length) message += ` (${otherWinners.join(', ')} also got it right!)`
      await this.client.sendTwitchMessage(message);

      db.insertInto('nameThatTuneScores').values([{
        name: winner,
        placement: 1,
      }].concat(otherWinners.map((name, i) => ({
        name,
        placement: i + 2,
      })))).execute();

      // Report win streaks
      const streak = await queries.nameThatTuneWinStreak();
      if (streak[0].streak > 1) {
        await this.client.sendTwitchMessage(`${winner} is on a ${streak[0].streak} round win streak!`);
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
    this.broadcast({ type: 'guess_the_song_scores', daily: dailyScores, weekly: weeklyScores, lifetime: lifetimeScores });
  }
}
