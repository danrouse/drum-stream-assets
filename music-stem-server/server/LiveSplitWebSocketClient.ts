import { WebSocket } from 'ws';
import { parseTime } from './util';

export default class LiveSplitWebSocketClient {
  private ws: WebSocket;
  private lastSplitTime = 0;

  constructor(url = 'ws://localhost:16834/livesplit') {
    this.ws = new WebSocket(url);
    this.ws.on('open', () => {
      this.clearAllSplitNames();
    
      // Start timer right away so we can just pause/resume it
      this.ws.send('starttimer');
      this.ws.send('pause');
    });
    this.ws.on('error', () => {
      console.error(`Failed to connect to LiveSplit at ${url}`);
    });
  }

  private clearAllSplitNames() {
    for (let i = 0; i < 200; i++) {
      this.ws.send(`setsplitname ${i} `);
    }
  }

  private getCurrentTime() {
    this.ws.send('getcurrenttime');
    return new Promise<number>((resolve, reject) => {
      this.ws.on('message', (msg) => {
        resolve(parseTime(msg.toString()));
        this.ws.onmessage = null;
      });
    });
  }
  
  public async messageHandler(message: WebSocketPlayerMessage | WebSocketServerMessage) {
    if (message.type === 'song_changed') {
      const currentLivesplitTime = await this.getCurrentTime();
      const currentSplitTime = currentLivesplitTime - this.lastSplitTime;
      this.lastSplitTime = currentLivesplitTime;
      if (Math.floor(currentSplitTime) > 1) {
        // Only move to next split if we've spent > 1 second on current one
        this.ws.send('resume');
        this.ws.send('startorsplit');
        this.ws.send('pause');
      }
      // TODO: More reasonable handling of YouTube song IDs (currently stuffed into title)
      let title = message.title;
      if (message.album === 'YouTube') {
        title = message.title.replace(/\S+$/, '');
      }
      this.ws.send(`setcurrentsplitname ${title} (${message.artist})`);
    } else if (message.type === 'song_played') {
      
      this.ws.send('resume');
    } else if (message.type === 'song_paused') {
      this.ws.send('pause');
    } else if (message.type === 'song_stopped') {
      this.ws.send('split');
      this.ws.send('pause');
    }
  }
}
