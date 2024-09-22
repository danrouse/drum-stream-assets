interface PlaylistProps {
  selectedSong?: SongData;
  onSongSelected: (song: SongData) => void;
}

export default function Playlist({}: PlaylistProps) {
  return (
    <div className="Playlist">
      
    </div>
  );
}
