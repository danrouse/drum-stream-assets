export type SongDownloadErrorType =
  'GENERIC' |
  'UNSUPPORTED_DOMAIN' |
  'DOWNLOAD_FAILED' |
  'VIDEO_UNAVAILABLE' |
  'NO_PLAYLISTS' |
  'TOO_LONG' |
  'AGE_RESTRICTED' |
  'MINIMUM_VIEWS' |
  'COOLDOWN' |
  'MINIMUM_QUERY_LENGTH' |
  'TOO_MANY_REQUESTS' |
  'REQUEST_ALREADY_EXISTS' |
  'DEMUCS_FAILURE';

export default class SongDownloadError extends Error {
  type: SongDownloadErrorType;
  constructor(type: SongDownloadErrorType = 'DOWNLOAD_FAILED') {
    super();
    this.type = type;
  }
}
