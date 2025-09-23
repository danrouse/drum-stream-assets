import ffprobe from 'ffprobe';
import ffprobeStatic from 'ffprobe-static';
import { basename } from 'path';
import { parseTime } from '../shared/util';
import { existsSync, readFileSync } from 'fs';

interface SongTags {
  artist: string;
  title: string;
  album: string;
  track: { no: number; of: number };
  duration: number;
}

export default async function getSongTags(songPath: string): Promise<SongTags> {
  // most metadata can come from analyzing the media file directly with ffprobe
  const res = await ffprobe(songPath, { path: ffprobeStatic.path });
  // check for metadata downloaded from yt-dlp
  // this allows sanitized filenames, and yt-dlp downloads are
  // seldom well-tagged, so still try to get that info
  const metadataPath = songPath.replace(/\..{3,}$/, '.info.json');
  const hasYouTubeMetadata = existsSync(metadataPath);
  let duration = 0;
  if (res.streams[0].duration) {
    duration = Number(res.streams[0].duration);
  } else if (res.streams[0].tags.DURATION) {
    duration = parseTime(res.streams[0].tags.DURATION);
  }
  if (hasYouTubeMetadata) {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
    // Emerson South override because of how YouTube credits artists
    if (metadata.artist?.startsWith('Emerson South,')) {
      metadata.artist = 'Emerson South';
    }
    return {
      artist: metadata.artist || '',
      title: metadata.fulltitle || metadata.track,
      album: `YouTube [${metadata.id}]`,
      track: {
        no: Number(res.streams[0].tags.TRACK) || 1,
        of: Number(res.streams[0].tags.TRACKS) || 1,
      },
      duration,
    };
  } else {
    return {
      artist: '',
      title: 'Unknown',
      album: '',
      track: {
        no: Number(res.streams[0].tags.TRACK) || 1,
        of: Number(res.streams[0].tags.TRACKS) || 1,
      },
      duration,
    };
  }
}
