export const isURL = (s: string) => {
  try {
    return Boolean(new URL(s));
  } catch (err) {
    return false;
  }
};

export const sleep = (t: number) => new Promise<void>((resolve) => setTimeout(() => resolve(), t));

export const parseTime = (ts: string) => ts.split(':').reduce((a,t)=> (60 * a) + +t, 0);

export const formatTime = (secs?: number) => {
  if (!secs) return `0:00`;
  const roundedSecs = Math.floor(secs % 60);
  return `${Math.floor(secs / 60)}:${roundedSecs < 10 ? `0${roundedSecs}` : roundedSecs}`;
};
