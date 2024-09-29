import { StreamerbotClient } from '@streamerbot/client';
import { SongDownloadError, MAX_SONG_REQUEST_DURATION } from './wrappers/spotdl';
import formatTime from '../player/formatTime';

const MINIMUM_SONG_REQUEST_QUERY_LENGTH = 5;

interface IdMap { [name: string]: string }

export default function createStreamerbotClient(
  handleSongRequest: (query: string) => Promise<ProcessedSong>,
) {
  // Store a mapping of command names to IDs so that they can be called by name
  let actions: IdMap;
  const loadActions = async () => {
    const mapping: IdMap = {};
    const res = await client.getActions();
    res.actions.forEach((action) => {
      mapping[action.name] = action.id;
    });
    return mapping;
  };
  const client = new StreamerbotClient({
    onConnect: async () => actions = await loadActions()
  });
  client.on('Application.*', async () => actions = await loadActions());

  // Send Twitch messages by calling the Streamerbot action made for it
  const sendTwitchMessage = (message: string, replyTo?: string) =>
    client.doAction(actions['Twitch chat message'], { message, replyTo });
  
  // Streamerbot Command.Triggered events which were triggered by Twitch messages
  // don't include the messageId which triggered them, but the Twitch.ChatMessage
  // event gets triggered first, so store a mapping of userIds to messageIds for replies
  const twitchMessageIdsByUser: IdMap = {};
  client.on('Twitch.ChatMessage', (data) => {
    twitchMessageIdsByUser[data.data.message.userId] = data.data.message.msgId;
  });

  client.on('Command.Triggered', async (payload) => {
    switch (payload.data.command) {
      case '!request':
      case '!sr':
      case '!ssr':
        const message = payload.data.message.replace(/[\udc00|\udb40]/g, '').trim();
        const replyId = twitchMessageIdsByUser[payload.data.user.id];

        // Show the help command if we get an empty or nearly-empty request
        // Anything with an actual title and artist SHOULD be above this length
        if (message.length < MINIMUM_SONG_REQUEST_QUERY_LENGTH) {
          try {
            await client.doAction(actions['!how']);
          } catch (e) {}
          return;
        }

        // Only send a heartbeat message if we didn't process it super quickly
        let hasSentMessage = false;
        setTimeout(async () => {
          if (!hasSentMessage) await sendTwitchMessage(`Working on it!`, replyId);
        }, 1000);

        try {
          const song = await handleSongRequest(message);
          await sendTwitchMessage(`${song.basename} was added!`, replyId);
        } catch (e: any) {
          let message = 'There was an error adding your song request!';
          if (e instanceof SongDownloadError) {
            if (e.type === 'VIDEO_UNAVAILABLE') message = 'That video is not available.';
            if (e.type === 'UNSUPPORTED_DOMAIN') message = 'Only Spotify or YouTube links are supported.';
            if (e.type === 'DOWNLOAD_FAILED') message = 'I wasn\'t able to download that link.';
            if (e.type === 'NO_PLAYLISTS') message = 'Playlists aren\'t supported, request a single song instead.';
            if (e.type === 'TOO_LONG') message = `That song is too long! Keep song requests under ${formatTime(MAX_SONG_REQUEST_DURATION)}.`;
          }
          await sendTwitchMessage(message, replyId);
        } finally {
          // Don't send that heartbeat message if we made it here super quickly
          hasSentMessage = true;
        }
      break;
    }
  });

  return client;
}
