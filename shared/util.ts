import { SongRequester } from './messages';

export const isURL = (s: string) => {
  try {
    return Boolean(s.match(/^\s*https?:/) && new URL(s));
  } catch (err) {
    return false;
  }
};

export const normalizeURL = (inputURL: string) => {
  const url = new URL(inputURL);

  if (url.hostname === 'youtu.be') {
    // rewrite youtube shortlinks
    const videoId = url.pathname.replace(/^\//, '');
    return `https://www.youtube.com/watch?v=${videoId}`;
  } else if (url.hostname.endsWith('youtube.com')) {
    // normalize youtube subdomains, remove query params
    return `https://www.youtube.com/watch?v=${url.searchParams.get('v')}`;
  } else if (url.hostname === 'open.spotify.com') {
    // normalize spotify track links
    const trackMatch = url.pathname.match(/\/track\/([a-zA-Z0-9]+)/);
    if (trackMatch) {
      return `https://open.spotify.com/track/${trackMatch[1]}`;
    }
  }
  return inputURL;
};

export const sleep = (t: number) => new Promise<void>((resolve) => setTimeout(() => resolve(), t));

export const parseTime = (ts: string) => ts.split(':').reduce((a,t)=> (60 * a) + +t, 0);

export const formatTime = (secs?: number, showHours: boolean = false) => {
  if (!secs) return `0:00`;
  const roundedSecs = Math.floor(secs % 60);
  let minutes = Math.floor(secs / 60);
  if (showHours && minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    minutes = minutes % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(roundedSecs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(roundedSecs).padStart(2, '0')}`;
};

export const createLogger = (name: string, logLevel: 'info' | 'error' | 'warn' = 'info') => {
  return (...args: any) => {
    console[logLevel](new Date().toLocaleString(), `[${name}]`, ...args);
  };
};

export const getOrdinal = (num: number): string => {
  const lastTwoDigits = num % 100;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return `${num}th`;
  }

  switch (num % 10) {
    case 1:
      return `${num}st`;
    case 2:
      return `${num}nd`;
    case 3:
      return `${num}rd`;
    default:
      return `${num}th`;
  }
};

export const calculateSliceScale = (requester: SongRequester, isSubscribed: boolean = false) => {
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 5.0;
  const REDUCTION_PER_FULFILLED_REQUEST = 0.2;
  const REDUCTION_RECENTLY_FULFILLED = 0.6;
  const RECENTLY_FULFILLED_TIME_WINDOW = 1000 * 60 * 15; // 15 minutes
  const INCREASE_PER_BUMP = 0.1;
  const INCREASE_PER_HOUR = 1.5;
  const INCREASE_FIRST_REQUEST = 0.8;
  const INCREASE_SUB_BONUS = 0.5;

  const timeSinceLastRequest = requester.lastFulfilledAt ?
    new Date().getTime() - new Date(requester.lastFulfilledAt).getTime() :
    Infinity;

  // reduce the size based on how many songs a requester has had fulfilled today
  const fulfilledPenalty = (requester.fulfilledToday || 0) * REDUCTION_PER_FULFILLED_REQUEST;

  // reduce the size for requesters that have recently had a song played
  const recentlyFulfilledPenalty = timeSinceLastRequest < RECENTLY_FULFILLED_TIME_WINDOW
    ? (1 - timeSinceLastRequest / RECENTLY_FULFILLED_TIME_WINDOW) * REDUCTION_RECENTLY_FULFILLED
    : 0;

  // increase size based on number of bumps (NTT wins)
  const bumpBonus = requester.currentBumpCount * INCREASE_PER_BUMP;

  // increase the size for requests based on their age
  const ageBonus = requester.oldestRequestAgeMinutes
    ? (requester.oldestRequestAgeMinutes / 60) * INCREASE_PER_HOUR
    : 0;

  // amplify the age bonus for someone's first request of the day
  const firstRequestBonus = requester.fulfilledToday === 0 ? INCREASE_FIRST_REQUEST : 0;

  // subs get bigger slices
  const subscriberBonus = isSubscribed ? INCREASE_SUB_BONUS : 0;

  // clamp the final result
  const size = Math.max(MIN_SCALE, Math.min(MAX_SCALE,
    1.0
    - fulfilledPenalty
    - recentlyFulfilledPenalty
    + ageBonus
    + firstRequestBonus
    + bumpBonus
    + subscriberBonus
  ));

  return {
    size,
    fulfilledPenalty,
    recentlyFulfilledPenalty,
    ageBonus,
    firstRequestBonus,
    bumpBonus,
    subscriberBonus,
  };
}
