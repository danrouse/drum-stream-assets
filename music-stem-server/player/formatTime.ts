const formatTime = (secs?: number) => {
  if (!secs) return `0:00`;
  const roundedSecs = Math.floor(secs % 60);
  return `${Math.floor(secs / 60)}:${roundedSecs < 10 ? `0${roundedSecs}` : roundedSecs}`;
};
export default formatTime;
