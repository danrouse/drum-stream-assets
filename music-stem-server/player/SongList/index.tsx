import { ReactNode } from 'react';
import formatTime from '../formatTime';
import './style.css';

interface SongListProps {
  songs: SongData[];
  selectedSong?: SongData;
  renderActions: (song: SongData, index: number) => ReactNode;
}

export default function SongList({ songs, selectedSong, renderActions }: SongListProps) {
  return (
    <div className="SongList">
      <ul>
        {songs.map((song, index) => (
          <li key={song.name} className={selectedSong === song ? 'selected' : ''}>
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
              {renderActions(song, index)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
