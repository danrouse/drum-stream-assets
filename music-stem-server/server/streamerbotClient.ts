import { StreamerbotClient } from '@streamerbot/client';
import { SongDownloadError, MAX_SONG_REQUEST_DURATION } from './wrappers/spotdl';
import formatTime from '../player/formatTime';

const MINIMUM_SONG_REQUEST_QUERY_LENGTH = 5;
export default function createStreamerbotClient(
  sendTwitchMessage: (message: string, reply?: string) => void,
  handleSongRequest: (query: string) => Promise<ProcessedSong>,
) {
  const client = new StreamerbotClient();
  const commandIds: { [name: string]: string } = {};
  const twitchMessageIdsByUser: { [userId: string]: string } = {};

  const loadCommands = async () => {
    const res = await client.getActions();
    res.actions.forEach((action) => {
      commandIds[action.name] = action.id;
    });
  };

  client.on('Twitch.ChatMessage', (data) => {
    twitchMessageIdsByUser[data.data.message.userId] = data.data.message.msgId;
  });

  client.on('Command.Triggered', async (payload) => {
    if (!Object.keys(commandIds).length) {
      await loadCommands();
    }
    switch (payload.data.command) {
      case '!request':
      case '!sr':
      case '!ssr':
        const message = payload.data.message.replace(/[\udc00|\udb40]/g, '').trim();
        if (message.length < MINIMUM_SONG_REQUEST_QUERY_LENGTH) {
          try {
            await client.doAction(commandIds['!how']);
          } catch (e) {}
          return;
        }
        const replyId = twitchMessageIdsByUser[payload.data.user.id];
        let hasSentMessage = false;
        setTimeout(() => {
          if (!hasSentMessage) sendTwitchMessage(`Working on it!`, replyId);
        }, 1000);
        try {
          const song = await handleSongRequest(message);
          hasSentMessage = true;
          sendTwitchMessage(`${song.basename} was added!`, replyId);
        } catch (e: any) {
          let message = 'There was an error adding your song request!';
          if (e instanceof SongDownloadError) {
            if (e.type === 'VIDEO_UNAVAILABLE') message = 'That video is not available.';
            if (e.type === 'UNSUPPORTED_DOMAIN') message = 'Only Spotify or YouTube links are supported.';
            if (e.type === 'DOWNLOAD_FAILED') message = 'I wasn\'t able to download that link.';
            if (e.type === 'NO_PLAYLISTS') message = 'Playlists aren\'t supported, request a single song instead.';
            if (e.type === 'TOO_LONG') message = `That song is too long! Keep song requests under ${formatTime(MAX_SONG_REQUEST_DURATION)}.`;
          }
          hasSentMessage = true;
          sendTwitchMessage(message, replyId);
        }
      break;
    }
  });

  return client;
}
