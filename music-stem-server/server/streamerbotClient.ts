import { StreamerbotClient } from '@streamerbot/client';
import { SongDownloadError, MAX_SONG_REQUEST_DURATION } from './wrappers/spotdl';
import formatTime from '../player/formatTime';
import { handleSongRequest } from './songRequests';

let broadcast: WebSocketBroadcaster = () => {};

const MINIMUM_SONG_REQUEST_QUERY_LENGTH = 5;

const REWARD_IDS = {
  SongRequest: '089b77c3-bf0d-41e4-9063-c239bcb6477b',
  MuteCurrentSongDrums: '0dc1de6b-26fb-4a00-99ba-367b96d660a6',
  SlowDownCurrentSong: 'b07f3e10-7042-4c96-8ba3-e5e385c63aee',
  SpeedUpCurrentSong: '7f7873d6-a017-4a2f-a075-7ad098e65a92',
};

interface IdMap { [name: string]: string }

async function handleStreamerbotSongRequest(
  originalMessage: string,
  sendTwitchMessage: (message: string, replyTo?: string) => void,
  fromUsername: string,
  replyTo?: string,
  // TODO: Store rewardId, and redemptionId to mark redemptions as "fulfilled"
  rewardId?: string,
  redemptionId?: string,
) {
  // Only send a heartbeat message if we didn't process it super quickly
  let hasSentMessage = false;
  setTimeout(async () => {
    if (!hasSentMessage) await sendTwitchMessage(`Working on it, ${fromUsername}!`, replyTo);
  }, 1000);

  try {
    const song = await handleSongRequest(originalMessage, fromUsername);
    hasSentMessage = true;
    await sendTwitchMessage(`${song.basename} was added, ${fromUsername}!`, replyTo);
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
    await sendTwitchMessage(`@${fromUsername} ${message}`, replyTo);
    // rethrow to allow to catch for refund
    throw e;
  }
}

export default function createStreamerbotClient(broadcaster: WebSocketBroadcaster) {
  // TODO: There's got to be a better way to handle this dependency injection
  broadcast = broadcaster;

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
  
  client.on('Twitch.RewardRedemption', async (payload) => {
    if (payload.data.reward.id === REWARD_IDS.SongRequest) {
      // if (payload.data.user_input === 'test') return;
      try {
        await handleStreamerbotSongRequest(
          payload.data.user_input,
          sendTwitchMessage,
          payload.data.user_name,
          payload.data.reward.id,
          payload.data.id
        );
      } catch (e) {
        console.info('Song reward redemption failed with error', (e as any)?.type);
        client.doAction(actions['Refund song request'], { rewardId: payload.data.reward.id, redemptionId: payload.data.id });
      }
    } else {
      const rewards = Object.entries(REWARD_IDS);
      const matchingReward = rewards.find(([name, rewardId]) => rewardId === payload.data.reward.id);
      if (matchingReward) {
        broadcast({ type: 'client_remote_control', action: matchingReward[0] });
      }
    }
  });

  return client;
}
