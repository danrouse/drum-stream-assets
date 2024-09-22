import formatTime from '../formatTime';
import './style.css';

interface SongListProps {
  songs: SongData[];
  onSongSelected: (song: SongData) => void;
  onSongQueued: (song: SongData) => void;
}

export default function SongList({ songs, onSongSelected, onSongQueued }: SongListProps) {
  return (
    <div className="SongList">
      <ul>
        {songs.map((song) => (
          <li key={song.name}>
            <div>
              <p className="title">{song.title}</p>
              <p className="artist">{song.artist}</p>
            </div>
            <div>
              <p className="album">{song.album}</p>
              <p className="trackNumber">{song.track[0]}/{song.track[1]}</p>
            </div>
            <div>
              <p className="duration">{formatTime(song.duration)}</p>
            </div>
            <div className="buttons">
              <button
                onClick={() => onSongSelected(song)}
              >
                Play
              </button>
              <button
                onClick={() => onSongQueued(song)}
              >
                Add to Playlist
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
