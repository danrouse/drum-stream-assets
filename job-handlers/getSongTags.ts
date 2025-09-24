import ffprobe from 'ffprobe';
import ffprobeStatic from 'ffprobe-static';
// @ts-expect-error
import { parseFile } from 'music-metadata';
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
  const ffprobeResult = await ffprobe(songPath, { path: ffprobeStatic.path });
  const id3Tags = await parseFile(songPath);
  // check for metadata downloaded from yt-dlp
  // this allows sanitized filenames, and yt-dlp downloads are
  // seldom well-tagged, so still try to get that info
  const metadataPath = songPath.replace(/\..{3,}$/, '.info.json');
  const hasYouTubeMetadata = existsSync(metadataPath);
  let duration = 0;
  if (ffprobeResult.streams[0].duration) {
    duration = Number(ffprobeResult.streams[0].duration);
  } else if (ffprobeResult.streams[0].tags.DURATION) {
    duration = parseTime(ffprobeResult.streams[0].tags.DURATION);
  }
  if (hasYouTubeMetadata) {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
    // Emerson South override because of how YouTube credits artists
    if (metadata.artist?.startsWith('Emerson South,')) {
      metadata.artist = 'Emerson South';
    }
    return {
      artist: metadata.artist || id3Tags.common.artist || '',
      title: metadata.fulltitle || metadata.track || id3Tags.common.title || '',
      album: id3Tags.common.album || `YouTube [${metadata.id}]`,
      track: {
        no: Number(ffprobeResult.streams[0].tags.TRACK) || id3Tags.common.track?.no || 1,
        of: Number(ffprobeResult.streams[0].tags.TRACKS) || id3Tags.common.track?.of || 1,
      },
      duration,
    };
  } else {
    return {
      artist: id3Tags.common.artist || '',
      title: id3Tags.common.title || 'Unknown',
      album: id3Tags.common.album || '',
      track: {
        no: Number(ffprobeResult.streams[0].tags.TRACK) || id3Tags.common.track?.no || 1,
        of: Number(ffprobeResult.streams[0].tags.TRACKS) || id3Tags.common.track?.of || 1,
      },
      duration,
    };
  }
}
