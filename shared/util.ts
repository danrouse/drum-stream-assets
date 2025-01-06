export const isURL = (s: string) => {
  try {
    return Boolean(new URL(s));
  } catch (err) {
    return false;
  }
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
