import { ReactNode } from 'react';
import { formatTime } from '../../../shared/util';
import { SongData } from '../../../shared/messages';
import './style.css';

interface SongListProps {
  songs: SongData[];
  selectedSong?: SongData;
  showTimeAgo?: boolean;
  renderActions: (song: SongData, index: number) => ReactNode;
}

const intl = new Intl.RelativeTimeFormat('en');
const getTimeDiff = (ts: Date) => {
  const sec = new Date().getTime() - new Date(ts).getTime();
  return intl.format(Math.round(-1 * sec / 1000 / 60), 'minutes');
};

export default function SongList({ songs, selectedSong, showTimeAgo, renderActions }: SongListProps) {
  return (
    <div className="SongList">
      <ul>
        {songs.map((song, index) => (
          <li key={song.id} className={selectedSong === song ? 'selected' : ''}>
            <div>
              <p className="title">{song.title}</p>
              <p className="artist">{song.artist}</p>
            </div>
            <div>
              <p className="album">{song.album}</p>
              {song.requester && <p className="requesterName">{song.requester}</p>}
              {showTimeAgo && song.createdAt && <p>{getTimeDiff(song.createdAt)}</p>}
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
