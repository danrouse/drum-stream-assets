import Downloader from './Downloader';
import SongList from './SongList';
import { SongData, StreamerbotViewer } from '../../shared/messages';

interface SongBrowserPlaylistsProps {
  songs: SongData[];

  isPlayingFromPlaylist: boolean;
  setIsPlayingFromPlaylist: (isPlayingFromPlaylist: boolean) => void;
  selectedSong?: SongData;
  setSelectedSong: (song: SongData) => void;
  songSearchQuery: string;
  setSongSearchQuery: (query: string) => void;
  playlists: Playlist[];
  addToPlaylist: (playlist: Playlist, song: SongData) => void;
  removeFromPlaylist: (playlist: Playlist, song: SongData) => void;
  selectedPlaylistIndex: number;
  setSelectedPlaylistIndex: (index: number) => void;
  activeViewers: StreamerbotViewer[];
  
  className?: string;
  socket?: WebSocket;
  onDownloadComplete: () => void;
}

export default function SongBrowserPlaylists({
  songs,

  isPlayingFromPlaylist, setIsPlayingFromPlaylist,
  selectedSong, setSelectedSong,
  songSearchQuery, setSongSearchQuery,
  playlists, addToPlaylist, removeFromPlaylist,
  selectedPlaylistIndex, setSelectedPlaylistIndex,
  activeViewers,

  className,
  socket,
  onDownloadComplete,
}: SongBrowserPlaylistsProps) {
  const isRequestsPlaylistSelected = ['Requests'].includes(playlists[selectedPlaylistIndex].title);
  return (
    <div className={`SongBrowserPlaylists ${className || ''}`}>
      <div className={isPlayingFromPlaylist ? '' : 'active'}>
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
        </div>
        <SongList
          songs={songs}
          selectedSong={selectedSong}
          renderActions={(song: SongData) => (
            <>
              <button onClick={() => {
                setSelectedSong(song);
                setIsPlayingFromPlaylist(false);
              }}>
                <i className="fa-solid fa-play" /> Select
              </button>
              {!isRequestsPlaylistSelected &&
                <button onClick={() => {
                  if (!playlists[selectedPlaylistIndex].songs.includes(song)) {
                    addToPlaylist(playlists[selectedPlaylistIndex], song);
                  }
                }}>
                  <i className="fa-solid fa-plus" /> Queue
                </button>
              }
            </>
          )}
        />
      </div>
      {playlists[selectedPlaylistIndex] &&
        <div className={isPlayingFromPlaylist ? 'active' : ''}>
          <div className="playlist-top">
            <select
              onChange={(event) => setSelectedPlaylistIndex(Number(event.currentTarget.value))}
              value={selectedPlaylistIndex}
            >
              {playlists.map((playlist, i) => (
                <option
                  value={i}
                  key={i}
                >
                  {playlist.title}
                </option>
              ))}
            </select>
          </div>
          <SongList
            songs={playlists[selectedPlaylistIndex].songs}
            selectedSong={selectedSong}
            showTimeAgo={isRequestsPlaylistSelected}
            activeViewers={activeViewers}
            renderActions={(song, index) => (
              <>
                <button onClick={() => {
                  setSelectedSong(song);
                  setIsPlayingFromPlaylist(true);
                }}>
                  <i className="fa-solid fa-play" /> Select
                </button>
                <button onClick={() =>
                  removeFromPlaylist(playlists[selectedPlaylistIndex], playlists[selectedPlaylistIndex].songs[index])
                }>
                  <i className="fa-solid fa-trash" /> Remove
                </button>
              </>
            )}
          />
        </div>
      }
    </div>
  );
}
