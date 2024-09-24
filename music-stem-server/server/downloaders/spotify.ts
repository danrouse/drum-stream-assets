/**
 * TODO: Everything
 * Plan to replace spotdl + syrics with new code here
 * 
 * Downloading from spotify is *against* their TOS.
 * Use at your own discretion? Figure it out at your own discretion?
 * 🤷‍♂️
 * 
 * spotdl has a lot of limitations because it doesn't actually download from spotify.
 * It gets metadata from spotify and uses that to try and identify something from YouTube.
 * But then it's impossible to do some things, like enforcing no live versions,
 * or downloading title songs from albums, unless you use a direct song link, sometimes.
 * 
 * Downloading is a kinda tricky process:
 * - find the song on Spotify and get its metadata
 * - turn the song ID from metadata into a path to a stream
 * - capture the stream and pull all the chunks from it
 * There's some python code that does this, it's just a matter of porting it reasonably.
 */
