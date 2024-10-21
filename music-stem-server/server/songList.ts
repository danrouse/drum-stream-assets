import { join } from 'path';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import getSongTags from './getSongTags';
import * as Paths from './paths';
import { SongRequest, SongData } from '../../shared/messages';

async function getSongData(songBasename: string, requests?: SongRequest[]): Promise<SongData | undefined> {
  const stems = readdirSync(join(Paths.STEMS_PATH, songBasename));
  if (!stems.length) return;
  requests ||= JSON.parse(readFileSync(join(Paths.__dirname, 'songrequests.json'), 'utf-8')) as SongRequest[];
  
  const stat = statSync(join(Paths.STEMS_PATH, songBasename, stems[0]));
  const tags = await getSongTags(songBasename, false, Paths.DOWNLOADS_PATH);
  const matchingRequest = requests.findLast(req => req.basename === songBasename);
  return {
    name: songBasename,
    artist: String(tags.common?.artist) || '',
    title: String(tags.common?.title) || '',
    stems: stems,
    downloadDate: stat.mtime,
    album: String(tags.common?.album) || '',
    track: [tags.common?.track.no || 1, tags.common?.track.of || 1],
    duration: tags.format?.duration,
    requesterName: matchingRequest?.requesterName,
    requestTime: matchingRequest?.time ? new Date(matchingRequest?.time) : undefined,
  };
}

async function getSongDataList() {
  const output: SongData[] = [];
  const stemmedSongs = readdirSync(Paths.STEMS_PATH)
    .filter(s => statSync(join(Paths.STEMS_PATH, s)).isDirectory());
  const requests = JSON.parse(readFileSync(join(Paths.__dirname, 'songrequests.json'), 'utf-8')) as SongRequest[];
  for (let songBasename of stemmedSongs) {
    const row = await getSongData(songBasename, requests);
    if (row) {
      output.push(row);
    }
  }
  return output;
}

export async function saveSongData(songBasename: string) {
  const index = JSON.parse(readFileSync(Paths.SONG_LIST_PATH, 'utf-8')) as SongData[];
  const newSongData = await getSongData(songBasename);
  if (newSongData) index.push(newSongData);
  writeFileSync(Paths.SONG_LIST_PATH, JSON.stringify(index, null, 2));
}

export async function generateSongDataList() {
  const data = await getSongDataList();
  writeFileSync(Paths.SONG_LIST_PATH, JSON.stringify(data, null, 2));
  return data;
}
