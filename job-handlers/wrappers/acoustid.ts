import 'dotenv/config';
import { execSync } from 'child_process';
import { resolve } from 'path';
import bottleneck from 'bottleneck';

const limiter = new bottleneck({
  minTime: 334,
  maxConcurrent: 1,
});

if (!process.env.ACOUSTID_CLIENT_ID) {
  throw new Error('ACOUSTID_CLIENT_ID is not set');
}
const API_URL = new URL('https://api.acoustid.org/v2/lookup');
API_URL.searchParams.set('client', process.env.ACOUSTID_CLIENT_ID);
API_URL.searchParams.set('meta', 'recordingids+sources');

const PATH_TO_FPCALC = resolve('../../bin/fpcalc.exe');

function generateAcoustidFingerprint(path: string): { duration: number, fingerprint: string } {
  const fingerprint = execSync(`${PATH_TO_FPCALC} -json "${path}"`, { encoding: 'utf-8' });
  return JSON.parse(fingerprint);
}

async function getAcoustidRecordingId(path: string) {
  const { duration, fingerprint } = generateAcoustidFingerprint(path);

  const url = new URL(API_URL);
  url.searchParams.set('duration', Math.floor(duration).toString());
  url.searchParams.set('fingerprint', fingerprint);

  const response = await fetch(url);
  if (!response.ok) return;

  const data = await response.json();
  if (data.status !== 'ok') return;
  if (!Array.isArray(data.results) || !data.results.length) return;

  // use best fingerprint match from AcoustID
  const bestMatch = data.results.reduce((best: any, current: any) =>
    current.score > best.score ? current : best, {});
  if (!Array.isArray(bestMatch.recordings)) return;

  // find the recording with the most reported sources
  // this prevents the worst of data pollution in the AcoustID database
  const bestRecording = bestMatch.recordings.reduce((best: any, current: any) =>
    current.sources > best.sources ? current : best, {});
  return bestRecording.id as string;
}

export default limiter.wrap(getAcoustidRecordingId);

