/**
 * Song Voting module
 *
 * This is still scarcely used!
 * Users can say ++ or -- in chat while a song is playing to vote on it.
 * Perhaps there will be a better way to make use of this -
 * scoreboards or for making "best of" playlists...
 * Still TBD.
 */
import { sql } from 'kysely';
import StreamerbotWebSocketClient, { CommandPayload } from '../../StreamerbotWebSocketClient';
import { db } from '../../database';
import * as queries from '../../queries';
import { WebSocketMessage } from '../../../../shared/messages';
import WebSocketCoordinatorServer from '../../WebSocketCoordinatorServer';

export default class SongVotingModule {
  constructor(
    private client: StreamerbotWebSocketClient,
    private wss: WebSocketCoordinatorServer
  ) {
    this.client.registerCommandHandler('Vote ++', this.handleVote.bind(this, 1));
    this.client.registerCommandHandler('Vote --', this.handleVote.bind(this, -1));
    this.wss.registerHandler('song_playback_completed', this.handleSongEnded);
  }

  private handleSongEnded = async (payload: WebSocketMessage<'song_playback_completed'>) => {
    // Notify chat of any votes that happened during playback
    const votes = await queries.songVotesSinceTime(payload.id, this.client.currentSongSelectedAtTime!);
    if (Number(votes[0].voteCount) > 0) {
      await this.client.sendTwitchMessage(`${this.client.currentSong?.artist} - ${this.client.currentSong?.title} score: ${votes[0].value}`);
    }
  };

  private handleVote = async (value: number, payload: CommandPayload) => {
    if (!this.client.currentSong) return;
    const existingVote = await queries.existingSongVoteForUser(this.client.currentSong.id, payload.user);
    if (existingVote.length > 0) {
      await db.updateTable('songVotes')
        .set({ value, createdAt: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` })
        .where('id', '=', existingVote[0].id)
        .execute();
    } else {
      await db.insertInto('songVotes').values([{
        songId: this.client.currentSong!.id,
        voterName: payload.user,
        value,
      }]).execute();
    }
    const newSongValue = await queries.songVoteScore(this.client.currentSong.id);
    await this.client.sendTwitchMessage(
      `@${payload.user} Current score for ${this.client.currentSong.artist} - ${this.client.currentSong.title}: ${newSongValue[0].value}`,
      undefined,
      'songVoteResponse',
      5000
    );
  };
}
