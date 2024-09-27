import { StreamerbotClient } from '@streamerbot/client';

export default function createStreamerbotClient(
  sendTwitchMessage: (message: string) => void,
  handleSongRequest: (query: string) => Promise<string>,
) {
  const client = new StreamerbotClient();
  const commandIds: { [name: string]: string } = {};

  const loadCommands = async () => {
    const res = await client.getActions();
    res.actions.forEach((action) => {
      commandIds[action.name] = action.id;
    });
  };

  client.on('Twitch.ChatMessage', (data) => {
    // console.log('Twitch.ChatMessage', data);
  });
  let n = 0;
  client.on('Command.Triggered', async (payload) => {
    if (!Object.keys(commandIds).length) {
      await loadCommands();
    }

    switch (payload.data.command) {
      case '!request':
        const message = payload.data.message.trim();
        if (message.length < 5) {
          try {
            await client.doAction(commandIds['!how']);
            return;
          } catch (e) {
            console.error(e);
            return;
          }
        }
        try {
          sendTwitchMessage(`Adding song request for "${message}"!`);
          await handleSongRequest(message);
          sendTwitchMessage(`Song request for ${payload.data.user.display} added!`);
        } catch (e) {
          sendTwitchMessage(`There was an error adding ${payload.data.user.display}'s song request!"`);
        }
        // console.log('Song request from', payload.data.user.name, payload.data.user.display, payload.data.user.id);
        // console.log(payload.data.message);
        // sendTwitchMessage(`foo bar baz, responding to: ${payload.data.user.display} with request for "${payload.data.message}"`);
      break;
    }
  });

  return client;
}
