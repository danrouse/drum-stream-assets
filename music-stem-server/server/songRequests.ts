import { join } from 'path';
import { unlinkSync } from 'fs';
import Demucs from './wrappers/demucs';
import spotdl, { SongDownloadError, MAX_SONG_REQUEST_DURATION } from './wrappers/spotdl';
import getSongTags from './getSongTags';
import * as Paths from './paths';

const YOUTUBE_MUSIC_COOKIE_FILE = join(Paths.__dirname, '..', 'music.youtube.com_cookies.txt');

let broadcast: WebSocketBroadcaster = () => {};

interface DemucsSubscriber {
  song: DownloadedSong;
  callback: (song?: ProcessedSong) => void;
}
let demucsSubscribers: DemucsSubscriber[] = [];

const demucs = new Demucs(Paths.DEMUCS_OUTPUT_PATH);
demucs.onProcessingStart = (song) => broadcast({ type: 'demucs_start', name: song.basename });
demucs.onProcessingProgress = (song, progress) => broadcast({ type: 'demucs_progress', progress, name: song.basename });
demucs.onProcessingComplete = (song) => {
  broadcast({ type: 'demucs_complete', stems: `/stems/${song.basename}` });
  demucsSubscribers.filter(s => s.song.basename === song.basename).forEach(s => s.callback(song));
  demucsSubscribers = demucsSubscribers.filter(s => s.song.basename !== song.basename);
};
demucs.onProcessingError = (song, errorMessage) => {
  broadcast({ type: 'demucs_error', message: errorMessage });
  demucsSubscribers.filter(s => s.song.basename === song.basename).forEach(s => s.callback());
  demucsSubscribers = demucsSubscribers.filter(s => s.song.basename !== song.basename);
};

// This is... bad
export async function setSongRequestWebSocketBroadcaster(broadcaster: WebSocketBroadcaster) {
  broadcast = broadcaster;
}

async function downloadSong(query: string) {
  console.info('Attempting to download:', query);
  broadcast({ type: 'download_start', query });
  const downloadedSong = await spotdl(query, Paths.DOWNLOADS_PATH, YOUTUBE_MUSIC_COOKIE_FILE);

  if (downloadedSong) {
    broadcast({ type: 'download_complete', name: downloadedSong.basename });
    console.info('Downloaded:', downloadedSong.basename);
  } else {
    broadcast({ type: 'download_error', query });
    console.info('Received no basename from spotdl');
  }
  return downloadedSong;
}

function processDownloadedSong(song: DownloadedSong, callback?: (song?: ProcessedSong) => void) {
  demucs.queue(song);
  if (callback) {
    demucsSubscribers.push({ song, callback });
  }
}

export function handleSongRequest(
  query: string,
  requesterName?: string
) {
  return new Promise<ProcessedSong>(async (resolve, reject) => {
    try {
      const downloadedSong = await downloadSong(query);
      const tags = await getSongTags(downloadedSong.path, true, Paths.DOWNLOADS_PATH);
      if (tags.format?.duration > MAX_SONG_REQUEST_DURATION) {
        reject(new SongDownloadError('TOO_LONG'));
      }

      if (downloadedSong) {
        processDownloadedSong(downloadedSong, (processedSong) => {
          if (processedSong) {
            console.info(`Song request added from request "${downloadedSong.basename}", broadcasting message...`);
            unlinkSync(Paths.SONG_LIST_PATH);
            broadcast({ type: 'song_request_added', name: downloadedSong.basename });
            resolve(processedSong);
          } else {
            reject();
          }
        });
      } else {
        reject();
      }
    } catch (e) {
      reject(e);
    }
  });
}
