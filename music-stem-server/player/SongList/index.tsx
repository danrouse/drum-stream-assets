import { ReactNode } from 'react';
import { formatTime } from '../../../shared/util';
import { SongData, StreamerbotViewer } from '../../../shared/messages';
import './style.css';

interface SongListProps {
  songs: SongData[];
  selectedSong?: SongData;
  showTimeAgo?: boolean;
  renderActions: (song: SongData, index: number) => ReactNode;
  activeViewers?: StreamerbotViewer[];
}

const intl = new Intl.RelativeTimeFormat('en');
const getTimeDiff = (ts: string) => {
  const sec = (new Date().getTime() - new Date(ts + 'Z').getTime()) / 1000;
  if (sec > 60 * 60) {
    return intl.format(Math.round(-1 * sec / (60 * 60)), 'hours');
  }
  return intl.format(Math.round(-1 * sec / 60), 'minutes');
};

export default function SongList({ songs, selectedSong, showTimeAgo, renderActions, activeViewers }: SongListProps) {
  return (
    <div className="SongList">
      <ul>
        {songs.map((song, index) => (
          <li key={index} className={[
            selectedSong === song ? 'selected' : '',
            song.priority ? 'priority' : '',
          ].join(' ')}>
            <div>
              <p className="title">{song.title}</p>
              <p className="artist">{song.artist}</p>
            </div>
            <div>
              <p className="album">{song.album}</p>
              {song.requester && <p className={`requesterName ${activeViewers ? (activeViewers.find(viewer => viewer.display.toLowerCase() === song.requester?.toLowerCase()) ? 'online' : 'offline') : ''}`}>{song.requester}</p>}
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
