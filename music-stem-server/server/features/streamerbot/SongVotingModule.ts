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
import { StreamerbotEventPayload } from '@streamerbot/client';
import StreamerbotWebSocketClient from '../../StreamerbotWebSocketClient';
import { db } from '../../database';
import * as queries from '../../queries';
import * as Streamerbot from '../../../../shared/streamerbot';
import { WebSocketMessage } from '../../../../shared/messages';
import WebSocketCoordinatorServer from '../../WebSocketCoordinatorServer';

export default class SongVotingModule {
  constructor(
    private client: StreamerbotWebSocketClient,
    private wss: WebSocketCoordinatorServer
  ) {
    this.client.on('Command.Triggered', this.handleCommandTriggered);
    this.wss.registerHandler('song_playback_completed', this.handleSongEnded);
  }

  private async handleSongEnded(payload: WebSocketMessage<'song_playback_completed'>) {
    // Notify chat of any votes that happened during playback
    const votes = await queries.songVotesSinceTime(payload.id, this.client.currentSongSelectedAtTime!);
    if (Number(votes[0].voteCount) > 0) {
      await this.client.sendTwitchMessage(`${this.client.currentSong?.artist} - ${this.client.currentSong?.title} score: ${votes[0].value}`);
    }
  }

  private handleCommandTriggered = async (payload: StreamerbotEventPayload<"Command.Triggered">) => {
    const message = payload.data.message.trim();
    const userName = payload.data.user.display;
    const commandName = Streamerbot.CommandAliases[payload.data.command];

    if (commandName === 'Vote ++' || commandName === 'Vote --') {
      if (!this.client.currentSong) return;
      let value = 1;
      if (commandName === 'Vote --') value = -1;
      const existingVote = await queries.existingSongVoteForUser(this.client.currentSong.id, userName);
      if (existingVote.length > 0) {
        await db.updateTable('songVotes')
          .set({ value, createdAt: sql`current_timestamp` })
          .where('id', '=', existingVote[0].id)
          .execute();
      } else {
        await db.insertInto('songVotes').values([{
          songId: this.client.currentSong!.id,
          voterName: userName,
          value,
        }]).execute();
      }
      const newSongValue = await queries.songVoteScore(this.client.currentSong.id);
      await this.client.sendTwitchMessage(
        `@${userName} Current score for ${this.client.currentSong.artist} - ${this.client.currentSong.title}: ${newSongValue[0].value}`,
        undefined,
        'songVoteResponse',
        5000
      );
    }
  };
}
