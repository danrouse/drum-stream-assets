import { ReactNode } from 'react';
import { formatTime } from '../../../shared/util';
import { SongData, SongRequestData, StreamerbotViewer } from '../../../shared/messages';
import './style.css';

interface SongListProps {
  songs: Array<SongData | SongRequestData>;
  selectedSong?: SongData;
  showTimeAgo?: boolean;
  showRuntime?: boolean;
  renderActions: (song: SongData, index: number) => ReactNode;
  activeViewers?: StreamerbotViewer[];
}

const intl = new Intl.RelativeTimeFormat('en');
const getTimeDiff = (ts: string) => {
  const sec = (new Date().getTime() - new Date(ts).getTime()) / 1000;
  if (sec > 60 * 60 * 24) {
    return intl.format(Math.round(-1 * sec / (60 * 60)), 'hours');
  }
  return intl.format(Math.round(-1 * sec / 60), 'minutes');
};

export default function SongList({ songs, selectedSong, showTimeAgo, showRuntime, renderActions, activeViewers }: SongListProps) {
  const totalRuntime = formatTime(songs.reduce((acc, song) => acc + song.duration, 0), true);
  const remainingRuntime = formatTime(songs.slice(selectedSong ? songs.indexOf(selectedSong) : 0).reduce((acc, song) => acc + song.duration, 0), true);
  return (
    <div className="SongList">
      {showRuntime && <p className="runtime">Runtime: {selectedSong ? `${remainingRuntime} / ${totalRuntime}` : totalRuntime}</p>}
      <ul>
        {songs.map((song, index) => (
          <li key={index} className={[
            selectedSong === song ? 'selected' : '',
            song.priority ? `priority priority-${song.priority}` : '',
            song.noShenanigans ? 'no-shens' : '',
          ].join(' ')}>
            <div>
              <p className="title">{song.title}</p>
              <p className="artist">{song.artist}</p>
            </div>
            <div>
              <p className="album">{song.album}</p>
              {song.requester && <p className={`requesterName ${activeViewers?.find(viewer => viewer.display.toLowerCase() === song.requester?.toLowerCase())?.online ? 'online' : 'offline'}`}>{song.requester} (#{(song.fulfilledToday || 0) + 1})</p>}
              {showTimeAgo && song.createdAt && <p>{getTimeDiff(song.createdAt)}</p>}
              {showTimeAgo && 'lastFulfilledAt' in song && song.lastFulfilledAt && <p>last song: {getTimeDiff(song.lastFulfilledAt)}</p>}
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
