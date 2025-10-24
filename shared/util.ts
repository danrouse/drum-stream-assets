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
