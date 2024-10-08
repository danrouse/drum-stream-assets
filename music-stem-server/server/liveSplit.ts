import { WebSocket } from 'ws';

const parseTime = (ts: string) =>
  ts.split(':').reduce((a,t)=> (60 * a) + +t, 0);

const clearAllSplitNames = () => {
  for (let i = 0; i < 200; i++) {
    livesplitClient.send(`setsplitname ${i} `);
  }
}

const livesplitClient = new WebSocket(`ws://localhost:16834/livesplit`);
livesplitClient.on('open', () => {
  clearAllSplitNames();

  // Start timer right away so we can just pause/resume it
  livesplitClient.send('starttimer');
  livesplitClient.send('pause');
});

let lastSplitTime = 0;

const handleTimeReceived = () => new Promise<number>((resolve, reject) => {
  livesplitClient.on('message', (msg) => {
    resolve(parseTime(msg.toString()));
    livesplitClient.onmessage = null;
  });
});

export async function handleLiveSplitMessage(message: WebSocketPlayerMessage) {
  if (message.type === 'song_changed') {
    livesplitClient.send('getcurrenttime');
    const currentLivesplitTime = await handleTimeReceived();
    const currentSplitTime = currentLivesplitTime - lastSplitTime;
    lastSplitTime = currentLivesplitTime;
    if (Math.floor(currentSplitTime) > 1) {
      // Only move to next split if we've spent > 1 second on current one
      livesplitClient.send('resume');
      livesplitClient.send('startorsplit');
      livesplitClient.send('pause');
    }
    // TODO: More reasonable handling of YouTube song IDs (currently stuffed into title)
    let title = message.title;
    if (message.album === 'YouTube') {
      title = message.title.replace(/\S+$/, '');
    }
    livesplitClient.send(`setcurrentsplitname ${title} (${message.artist})`);
  } else if (message.type === 'song_played') {
    
    livesplitClient.send('resume');
  } else if (message.type === 'song_paused') {
    livesplitClient.send('pause');
  } else if (message.type === 'song_stopped') {
    livesplitClient.send('split');
    livesplitClient.send('pause');
  }
}
