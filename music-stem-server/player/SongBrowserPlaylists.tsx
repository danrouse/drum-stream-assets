import { useState } from 'react';
import Downloader from './Downloader';
import SongList from './SongList';

interface SongBrowserPlaylistsProps {
  songs: SongData[];

  isPlayingFromPlaylist: boolean;
  setIsPlayingFromPlaylist: (isPlayingFromPlaylist: boolean) => void;
  selectedSong?: SongData;
  setSelectedSong: (song: SongData) => void;
  songSearchQuery: string;
  setSongSearchQuery: (query: string) => void;
  playlists: Playlist[];
  setPlaylists: (playlists: Playlist[]) => void;
  selectedPlaylistIndex: number;
  setSelectedPlaylistIndex: (index: number) => void;
  
  className?: string;
  socket?: WebSocket;
  onDownloadComplete: () => void;
}

export default function SongBrowserPlaylists({
  songs,

  isPlayingFromPlaylist, setIsPlayingFromPlaylist,
  selectedSong, setSelectedSong,
  songSearchQuery, setSongSearchQuery,
  playlists, setPlaylists,
  selectedPlaylistIndex, setSelectedPlaylistIndex,

  className,
  socket,
  onDownloadComplete,
}: SongBrowserPlaylistsProps) {
  const isDefaultPlaylistSelected =
    playlists[selectedPlaylistIndex].title === 'Base Playlist' ||
    playlists[selectedPlaylistIndex].title === 'Requests';
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
          <button onClick={() => setPlaylists(playlists.toSpliced(selectedPlaylistIndex, 1, {
            ...playlists[selectedPlaylistIndex],
            songs: [...playlists[selectedPlaylistIndex].songs, ...songs.slice()]
          }))}>
            <i className="fa-solid fa-plus" /> Queue All
          </button>
          <button onClick={() => setPlaylists(playlists.toSpliced(selectedPlaylistIndex, 1, {
            ...playlists[selectedPlaylistIndex],
            songs: [...playlists[selectedPlaylistIndex].songs, ...songs.slice().toSorted(() => Math.random() - 0.5)]
          }))}>
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
                setIsPlayingFromPlaylist(false);
              }}>
                <i className="fa-solid fa-play" /> Select
              </button>
              <button onClick={() => {
                if (!playlists[selectedPlaylistIndex].songs.includes(song)) {
                  setPlaylists(playlists.toSpliced(selectedPlaylistIndex, 1, {
                    ...playlists[selectedPlaylistIndex],
                    songs: [...playlists[selectedPlaylistIndex].songs, song]
                  }));
                }
              }}>
                <i className="fa-solid fa-plus" /> Queue
              </button>
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
            <button
              onClick={() =>
                setPlaylists(playlists.toSpliced(selectedPlaylistIndex, 1, {
                  ...playlists[selectedPlaylistIndex], songs: [] }))
            }>
              <i className="fa-solid fa-trash" /> Clear All
            </button>
            <button onClick={() => {
              const playlistName = prompt('Playlist name') || 'New Playlist';
              const newPlaylist =  { title: playlistName, songs: [] };
              setPlaylists([...playlists, newPlaylist]);
              setSelectedPlaylistIndex(playlists.length);
            }}>
              <i className="fa-solid fa-plus" /> New Playlist
            </button>
            {!isDefaultPlaylistSelected &&
              <button onClick={() => {
                if (isDefaultPlaylistSelected) {
                  alert('Cannot delete the default playlists!');
                } else if (confirm(`Are you sure you want to delete ${playlists[selectedPlaylistIndex].title}?`)) {
                  setPlaylists(playlists.toSpliced(selectedPlaylistIndex, 1));
                  setSelectedPlaylistIndex(0);
                }
              }}>
                <i className="fa-solid fa-trash" /> Delete Playlist
              </button>
            }
          </div>
          <SongList
            songs={playlists[selectedPlaylistIndex].songs}
            selectedSong={selectedSong}
            renderActions={(song, index) => (
              <>
                <button onClick={() => {
                  setSelectedSong(song);
                  setIsPlayingFromPlaylist(true);
                }}>
                  <i className="fa-solid fa-play" /> Select
                </button>
                <button onClick={() => {
                  setPlaylists(playlists.toSpliced(selectedPlaylistIndex, 1, {
                    ...playlists[selectedPlaylistIndex], songs: playlists[selectedPlaylistIndex].songs.toSpliced(index, 1)
                  }));
                }}>
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
