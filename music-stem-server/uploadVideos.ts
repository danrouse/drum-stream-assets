import 'dotenv/config';
import { createReadStream, existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import readline from 'readline';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import DiscordIntegration from './server/DiscordIntegration';
import { db } from './server/database';
import { isURL } from '../shared/util';

const YOUTUBE_TOKEN_PATH = './youtube_oauth_token.json';
const RECORDINGS_PATH = 'L:\\OBS Recordings';

const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
const clientId = process.env.YOUTUBE_CLIENT_ID;
const redirectUrl = process.env.YOUTUBE_OAUTH_REDIRECT_URL;

const youtube = google.youtube('v3');

const authorize = () => new Promise<OAuth2Client>((resolve) => {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUrl);
  if (!existsSync(YOUTUBE_TOKEN_PATH)) {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.upload']
    });
    console.log('Authorize this app by visiting this url: ', authUrl);
    const rl = readline.createInterface({
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

const oauth2Client = await authorize();
const discordIntegration = new DiscordIntegration();

discordIntegration.on('ready', async (client) => {
  let lastMessageTime = new Date();

  for (let filename of readdirSync(RECORDINGS_PATH)) {
    const srMatch = filename.match(/SR #(\d+)/);
    // only process videos with "SR #\d+" in the title
    if (!filename.endsWith('.mp4') || !srMatch) continue;

    const partsMatch = filename.match(/([\d-\s]+)_\d+_Song #(\d+) SR #(\d+)/);
    if (!partsMatch) continue;

    const streamTime = new Date(partsMatch[1].replace(/(\d+)\-(\d+)\-(\d+)$/, '$1:$2:$3'));
    
    while (!lastMessageTime || (streamTime < lastMessageTime)) {
      console.log('fetch more', !lastMessageTime, (streamTime < lastMessageTime), streamTime, lastMessageTime)
      const previousSize = discordIntegration.songRequestsChannel?.messages.cache.size;
      await discordIntegration.songRequestsChannel?.messages.fetch({ limit: 100, before: discordIntegration.songRequestsChannel?.messages.cache.last()?.id });
      lastMessageTime = new Date(discordIntegration.songRequestsChannel?.messages.cache.last()?.createdTimestamp!);
      // if (discordIntegration.songRequestsChannel?.messages.cache.size === previousSize) {
      //   console.warn('ran out of messages in discord before finding one to update!', discordIntegration.songRequestsChannel?.messages.cache.size, previousSize, streamTime, lastMessageTime);
      //   return;
      // };
    }

    // const songId = partsMatch[2];
    const songRequestId = partsMatch[3];

    const songData = await db.selectFrom('songRequests')
      .innerJoin('songs', 'songs.id', 'songRequests.songId')
      .selectAll('songs')
      .select('query')
      .where('songRequests.id', '=', Number(songRequestId))
      .execute();
    let songTitle = [songData[0].artist, songData[0].title].filter(s => s).join(' - ')
      .replace(/[\[\(](official)?\s*(music|lyric|hd|hq|4k)?\s*(video|audio|lyrics)?[\)\]]/i, '')
      .replace(/\s+/, ' ')
      .replace('⧸', '/')
      .replace('：', ':')
      .trim();
    // if (songTitle.length > 70) {
    //   songTitle = songTitle.replace(`${songData[0].artist} - `, '');
    //   if (songTitle.length > 70) {
    //     songTitle = songTitle.replace(/\(feat[^\)]+\)/i, '');
    //   }
    // }
    // songTitle 

    let songURL = '';
    if (isURL(songData[0].query)) {
      const url = new URL(songData[0].query);
      url.searchParams.delete('si');
      url.searchParams.delete('index');
      url.searchParams.delete('playlist');
      url.searchParams.delete('context');
      url.searchParams.delete('feature');
      url.searchParams.delete('ab_channel');
      url.searchParams.delete('list');
      url.search = url.searchParams.toString();
      songURL = `\nOriginal song: ${url}\n`;
    }

    const titlePrefix = 'VOD: ';
    const titleSuffix = ' | Drum Stream Song Requests';
    const titleMain = songTitle.length + titlePrefix.length + titleSuffix.length > 100 ?
      songTitle.slice(0, 100 - titlePrefix.length - titleSuffix.length - 1) + '…' :
      songTitle;
    const videoTitle = `${titlePrefix}${titleMain}${titleSuffix}`;
    const videoDescription = `Drum playthrough of ${songTitle} from live stream on ${streamTime.toLocaleDateString('us-US', { timeZone: 'CST', day: '2-digit', month: 'long', year: 'numeric' })}.

Most of these song requests are blind playthroughs of music I've never heard before, requested from viewers like you!

Catch the live streams Twitch and request some songs of your own! ➡️ https://www.twitch.tv/danny_the_liar
${songURL}
Song request 🆔 ${songRequestId}`;

    console.log(videoTitle, '\n', videoDescription, '\n\n');
    // break;

    const response = await youtube.videos.insert({
      auth: oauth2Client,
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: videoTitle,
          description: videoDescription,
        },
        status: {
          privacyStatus: 'public'
        }
      },
      media: {
        body: createReadStream(join(RECORDINGS_PATH, filename))
      }
    });

    const youtubeId = response.data.id;
    const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
    console.log('Uploaded YT video', youtubeId);
    await discordIntegration.updateCompletedSongRequest(Number(songRequestId), undefined, youtubeUrl);
    console.log('Updated SR#', songRequestId, youtubeUrl);

    unlinkSync(join(RECORDINGS_PATH, filename));
  }
  console.log('Done!');
});
