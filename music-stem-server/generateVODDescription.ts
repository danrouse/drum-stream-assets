/**
 * Upload a full VOD to YouTube with a description including timestamps for
 * individual songs, and update the Discord song request posts with deep links
 * to the YouTube video.
 *
 * Run with `tsx generateVODDescription.ts <filename>`, where <filename> is the
 * path to the VOD file.
 */
import 'dotenv/config';
import { execSync } from 'child_process';
import {
  createReadStream,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync
} from 'fs';
import { basename } from 'path';
import { createInterface as createReadlineInterface } from 'readline';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import DiscordModule from './server/features/DiscordModule';
import { formatTime } from '../shared/util';
import { db } from './server/database';

// This should match with what the Streamer.bot action sets in the "Create Stream Start Marker" action
const STREAM_START_CHAPTER_DESCRIPTION = 'Stream Start';

// Path to locally cached YouTube OAuth token. .gitignore this!
const YOUTUBE_TOKEN_PATH = './youtube_oauth_token.json';

const youtube = google.youtube('v3');

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

// Parse the results of ffprobe to get the chapters of a video file
function getFFProbeChapters(filename: string) {
  const ffprobeResult = execSync(`ffprobe -i "${process.argv[2]}" -print_format json -show_chapters -loglevel error`, { encoding: 'utf-8' });
  return JSON.parse(ffprobeResult).chapters as FFProbeChapter[];
}

// Tag ffprobe chapters with song titles
let cachedVideoChapters = new Map<string, TaggedChapter[]>();
async function getVideoChapters(filename: string): Promise<TaggedChapter[]> {
  if (!cachedVideoChapters.has(filename)) {
    const videoChapters = await Promise.all(
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
    cachedVideoChapters.set(filename, videoChapters);
  }
  return cachedVideoChapters.get(filename)!;
}

// Format chapters for a YouTube video description
// In this format, the description will generate chapters inside the YT video
function chaptersToYouTubeDescription(chapters: TaggedChapter[]): string {
  return '0:00 Stream Start\n' +
    chapters.map(chapter => `${formatTime(chapter.timestamp, true)} ${chapter.songTitle}`)
      .join('\n');
}

async function generateYouTubeVideoMeta(filename: string) {
  const streamTime = parseOBSVideoTimestamp(filename).toLocaleDateString('us-US', {
    timeZone: 'CST',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
  const title = `Drum Live Stream Song Requests | ${streamTime} | VOD`;

  const chapters = await getVideoChapters(filename);
  const description = `Drum playthroughs of viewer song requests from live stream on ${streamTime}.

Most of these song requests are blind playthroughs of music I've never heard before, requested from viewers like you!

Catch the live streams Twitch and request some songs of your own! ➡️ https://www.twitch.tv/danny_the_liar

${chaptersToYouTubeDescription(chapters)}`;
  if (description.length > 5000) throw new Error('Generated description over 5000 bytes!');

  return [title, description];
}

async function uploadYouTubeVideo(filename: string) {
  const [title, description] = await generateYouTubeVideoMeta(filename);
  const oauth2Client = await authorizeYouTube();
  console.info('Uploading to YouTube:\n', `\tTitle: ${title}\n`, `\tDescription: ${description}\n`);
  const response = await youtube.videos.insert({
    auth: oauth2Client,
    part: ['snippet', 'status'],
    requestBody: {
      snippet: { title, description },
      status: {
        privacyStatus: 'public'
      }
    },
    media: {
      body: createReadStream(filename)
    }
  });
  if (!response.data.id) throw new Error(`Upload failed! ${response}`);
  console.info('Upload complete with id', response.data.id);
  return response.data.id;
}

function parseOBSVideoTimestamp(filename: string) {
  const partsMatch = basename(filename).match(/([\d-\s]+)?/);
  if (!partsMatch) throw new Error(`Filename doesn\'t match OBS output date pattern! ${filename}`);

  const streamTime = new Date(partsMatch[1].replace(/\-$/, '').replace(/(\d+)\-(\d+)\-(\d+)$/, '$1:$2:$3'));
  return streamTime;
}

async function updateDiscordSongRequestPosts(filename: string, youtubeVideoId: string) {
  const youtubeUrlBase = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
  const songRequests = (await getVideoChapters(filename)).filter(s => s.songRequestId);
  const streamTime = parseOBSVideoTimestamp(filename);
  const discordModule = new DiscordModule();
  return new Promise<void>((resolve) => {
    discordModule.on('ready', async (client) => {
      // preload song request posts
      let lastMessageTime = new Date();
      while (!lastMessageTime || (streamTime < lastMessageTime)) {
        console.log('Preloading Discord messages...');
        await discordModule.songRequestsChannel?.messages.fetch({ limit: 100, before: discordModule.songRequestsChannel?.messages.cache.last()?.id });
        lastMessageTime = new Date(discordModule.songRequestsChannel?.messages.cache.last()?.createdTimestamp!);
      }

      for (let chapter of songRequests) {
        await discordModule.updateCompletedSongRequest(
          Number(chapter.songRequestId),
          undefined,
          `${youtubeUrlBase}#t=${formatTime(chapter.timestamp).replace(':', 'm')}`
        );
      }
      resolve();
    });
  });
}

// Remove everything in a video before the first chapter marked with STREAM_START_CHAPTER_DESCRIPTION
function removeStreamStartSegment(filename: string) {
  const dstFilename = filename.replace('.mp4', '-clipped.mp4');
  if (existsSync(dstFilename)) return dstFilename;
  const start = getFFProbeChapters(filename).find(chapter => chapter.tags.title === STREAM_START_CHAPTER_DESCRIPTION)!;
  execSync(`ffmpeg -i "${filename}" -ss ${start.start_time} -c copy "${dstFilename}"`);
  return dstFilename;
}

const authorizeYouTube = () => new Promise<OAuth2Client>((resolve) => {
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const redirectUrl = process.env.YOUTUBE_OAUTH_REDIRECT_URL;
  if (!clientSecret || !clientId || !redirectUrl) throw new Error('YouTube OAuth credentials not set in .env');
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUrl);
  if (!existsSync(YOUTUBE_TOKEN_PATH)) {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/youtube',
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/youtube.upload'
      ]
    });
    console.log('Authorize this app by visiting this url: ', authUrl);
    const rl = createReadlineInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question('Enter the code from that page here: ', async function(code) {
      rl.close();
      const token = await oauth2Client.getToken(code);
      writeFileSync(YOUTUBE_TOKEN_PATH, JSON.stringify(token));
      oauth2Client.credentials = token.tokens;
      resolve(oauth2Client);
    });
  } else {
    oauth2Client.credentials = JSON.parse(readFileSync(YOUTUBE_TOKEN_PATH, 'utf-8')).tokens;
    resolve(oauth2Client);
  }
});

const strippedFilename = removeStreamStartSegment(process.argv[2]);
const id = await uploadYouTubeVideo(strippedFilename);
await updateDiscordSongRequestPosts(strippedFilename, id);
console.log('done');
