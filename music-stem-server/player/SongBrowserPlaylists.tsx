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
  refreshRequests?: () => void;
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
  refreshRequests,
}: SongBrowserPlaylistsProps) {
  const isRequestsPlaylistSelected = ['Requests'].includes(playlists[selectedPlaylistIndex].title);

  const handleRemoveAllClick = () => {
    if (confirm('Are you sure you want to remove all song requests? This action cannot be undone.')) {
      playlists[selectedPlaylistIndex].songs.forEach(song => {
        removeFromPlaylist(playlists[selectedPlaylistIndex], song);
      });
    }
  };

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
            {refreshRequests && <button onClick={refreshRequests}>🔃</button>}
            {isRequestsPlaylistSelected && (
              <button onClick={handleRemoveAllClick}>🗑️</button>
            )}
          </div>
          <SongList
            songs={playlists[selectedPlaylistIndex].songs}
            selectedSong={selectedSong}
            showTimeAgo={isRequestsPlaylistSelected}
            showRuntime={true}
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
                  confirm(`Remove ${song.title} from playlist?`) && removeFromPlaylist(playlists[selectedPlaylistIndex], playlists[selectedPlaylistIndex].songs[index])
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
