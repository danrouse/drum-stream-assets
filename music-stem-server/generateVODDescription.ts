import { execSync } from 'child_process';
import { formatTime } from '../shared/util';
import { db } from './server/database';

interface FFProbeChapter {
  id: number,
  time_base: string,
  start: number,
  start_time: string,
  end: number,
  end_time: string,
  tags: {
    title: string,
  }
}

interface TaggedChapter {
  timestamp: number,
  songTitle: string,
  songId: number,
  songRequestId?: number,
}

// This should match with what the Streamer.bot action sets in the "Create Stream Start Marker" action
const STREAM_START_CHAPTER_DESCRIPTION = 'Stream Start';

// Parse the results of ffprobe to get the chapters of a video file
function getFFProbeChapters(filename: string) {
  const ffprobeResult = execSync(`ffprobe -i "${process.argv[2]}" -print_format json -show_chapters -loglevel error`, { encoding: 'utf-8' });
  return JSON.parse(ffprobeResult).chapters as FFProbeChapter[];
}

// Tag ffprobe chapters with song titles
async function getVideoChapters(filename: string): Promise<TaggedChapter[]> {
  return Promise.all(
    getFFProbeChapters(filename).filter(chapter =>
      chapter.tags.title.startsWith('Song Start') &&
      chapter.tags.title.match(/Song #(\d+)( SR #(\d+))?/)
    ).map(async (chapter) => {
      const parts = chapter.tags.title.match(/Song #(\d+)( SR #(\d+))?/)!;
      const songData = await db.selectFrom('songs')
        .selectAll('songs')
        .where('id', '=', Number(parts[1]))
        .execute();
      const songTitle = [songData[0].artist, songData[0].title].filter(s => s).join(' - ')
        .replace(/[\[\(](official)?\s*(music|lyric|hd|hq|4k)?\s*(video|audio|lyrics)?[\)\]]/i, '')
        .replace(/\s+/, ' ')
        .replace('⧸', '/')
        .replace('：', ':')
        .trim();

      return {
        timestamp: chapter.start / 1000,
        songTitle,
        songId: Number(parts[1]),
        songRequestId: parts[3] ? Number(parts[3]) : undefined,
      };
    })
  );
}

// Format chapters for a YouTube video description
function getYouTubeChapters(chapters: TaggedChapter[]): string {
  return '0:00 Stream Start\n' +
    chapters.map(chapter => `${formatTime(chapter.timestamp, true)} ${chapter.songTitle}`)
      .join('\n');
}

function generateYouTubeVideoDescription(filename: string) {
  // parse filename date into readable string
  // get youtube chapters
  // ensure that buffer is < 5000 bytes
  // return whole big string
}

function uploadYouTubeVideo(filename: string) {
  // 1. remove stream start segment
  // 2. generate youtube video description
  // 3. upload to youtube
  // return youtube id
}

function updateDiscordSongRequestPosts(filename: string, youtubeVideoId: string) {
  // for all chapters which have a songRequestId marked,
  // tag the song request with the full youtube link including timestamp
}

// Remove everything in a video before the first chapter marked with STREAM_START_CHAPTER_DESCRIPTION
function removeStreamStartSegment(filename: string) {
  const dstFilename = filename.replace('.mp4', '-clipped.mp4');
  const start = getFFProbeChapters(filename).find(chapter => chapter.tags.title === STREAM_START_CHAPTER_DESCRIPTION)!;
  execSync(`ffmpeg -i "${filename}" -ss ${start.start_time} -c copy "${dstFilename}"`);
  return dstFilename;
}

