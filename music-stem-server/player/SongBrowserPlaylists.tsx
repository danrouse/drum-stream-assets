import Downloader from './Downloader';
import SongList from './SongList';

interface SongBrowserPlaylistsProps {
  songs: SongData[];

  queuedSongs: SongData[];
  setQueuedSongs: (songs: SongData[]) => void;
  isPlayingFromQueue: boolean;
  setIsPlayingFromQueue: (isPlayingFromQueue: boolean) => void;
  selectedSong?: SongData;
  setSelectedSong: (song: SongData) => void;
  songSearchQuery: string;
  setSongSearchQuery: (query: string) => void;
  
  className?: string;
  socket?: WebSocket;
  onDownloadComplete: () => void;
}

export default function SongBrowserPlaylists({
  songs,

  queuedSongs, setQueuedSongs,
  isPlayingFromQueue, setIsPlayingFromQueue,
  selectedSong, setSelectedSong,
  songSearchQuery, setSongSearchQuery,

  className,
  socket,
  onDownloadComplete,
}: SongBrowserPlaylistsProps) {
  return (
    <div className={`SongBrowserPlaylists ${className || ''}`}>
      <div className={isPlayingFromQueue ? '' : 'active'}>
        {socket &&
          <Downloader
            onDownloadComplete={onDownloadComplete}
            onInputChanged={q => setSongSearchQuery(q)}
            value={songSearchQuery}
            socket={socket}
          />
        }
        <div className="playlist-top">
          <h2>Song Index</h2>
          <button onClick={() => setQueuedSongs(songs.slice())}>
            <i className="fa-solid fa-plus" /> Queue All
          </button>
          <button onClick={() => setQueuedSongs(songs.slice().toSorted(() => Math.random() - 0.5))}>
            <i className="fa-solid fa-shuffle" /> Queue All (Shuffled)
          </button>
        </div>
        <SongList
          songs={songs}
          selectedSong={selectedSong}
          renderActions={(song: SongData) => (
            <>
              <button onClick={() => {
                setSelectedSong(song);
                setIsPlayingFromQueue(false);
              }}>
                <i className="fa-solid fa-play" /> Select
              </button>
              <button onClick={() => !queuedSongs.includes(song) && setQueuedSongs([...queuedSongs, song])}>
                <i className="fa-solid fa-plus" /> Queue
              </button>
            </>
          )}
        />
      </div>
      <div className={isPlayingFromQueue ? 'active' : ''}>
        <div className="playlist-top">
          <h2>Queue</h2>
          <button onClick={() => setQueuedSongs([])}><i className="fa-solid fa-trash" /> Clear All</button>
        </div>
        <SongList
          songs={queuedSongs}
          selectedSong={selectedSong}
          renderActions={(song, index) => (
            <>
              <button onClick={() => {
                setSelectedSong(song);
                setIsPlayingFromQueue(true);
              }}>
                <i className="fa-solid fa-play" /> Select
              </button>
              <button onClick={() => setQueuedSongs(queuedSongs.toSpliced(index, 1))}>
                <i className="fa-solid fa-trash" /> Remove
              </button>
            </>
          )}
        />
      </div>
    </div>
  );
}
