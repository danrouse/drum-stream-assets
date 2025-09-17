# drum-stream-assets

This project is a collection of services that power the [danny_the_liar drumming stream on Twitch](https://www.twitch.tv/danny_the_liar).

Most of the codebase is written in TypeScript on Node.js 22. A few utilities use Python, and the overlays will eventually be migrated to C#.


### [music-stem-server](music-stem-server)

This is the main logic handling stream interactions (largely through Streamer.bot), interpreting and broadcasting messages through a WebSocket server, coordinating song requests, and handling their playback through a [web playback UI](music-stem-server/player).


#### [server](music-stem-server/server)

The server coordinates the many submodules of the project, interacting with the stream using Streamer.bot, and relaying relevant messages using a WebSocket server to the overlays. There are modules for interacting with DMX lighting hardware and relaying MIDI events from the drum module.

Sub-modules are located in [music-stem-server/server/features](music-stem-server/server/features) and WebSocket messages and payload shapes are defined in [shared/messages.ts](shared/messages.ts).

A web server and a WebSocket server both listen locally. Triggers jobs from [job-handlers](job-handlers) using RabbitMQ.

The database for this server runs on Cloudflare D1. All requests to the database are proxied through the [cloudflare-worker](cloudflare-worker).


#### [player](music-stem-server/player)

Web UI for playing back stemmed songs, with options to mute individual stems and synchronizing the rest. Has playback speed options which interact with the (now-disabled) ShenanigansModule from the server.

Songs can be requested manually from the song listing on the left pane, and the right side pane shows playlists (most of the support of which has been remove and can be eventually re-added) as well as an immutable list of all active song requests. Song requests can be canceled from this listing.


### [electron-overlays](electron-overlays)

Live video overlays for the stream, communicating through music-stem-server using WebSockets.

> *All of these are built with Electron for now, which is a major performance bottleneck! While it has enabled rapid prototyping, there is a larger TODO to migrate this to a more performant solution such as C# with WPF.*

Each overlay is located in [electron-overlays/src](electron-overlays/src) in a \*Window directory:

- [AudioDisplayWindow](electron-overlays/src/AudioDisplayWindow): visualizer for the waveform of the drum stem of the currently-playing song
- [GambaWindow](electron-overlays/src/GambaWindow): displays the status of the current Twitch Prediction, which is effectively a coin toss on the number of times drum triggers are hit in the current song
- [GuessTheSongWindow](electron-overlays/src/GuessTheSongWindow): the BRB game on stream which acts as a "Name That Tune" game, using the different stems to play only drum and bass tracks of a song, and collects guesses from stream chat. Winners are granted points (*currently unused*) which are stored in the database
- [ManagerWindow](electron-overlays/src/ManagerWindow): a manager window that controls the other windows, including opening and closing them, restarting them, and displaying their status (🤖 *Largely AI-developed.*)
- [MIDINotesWindow](electron-overlays/src/MIDINotesWindow): the most prevalent overlay, displaying overlays atop each of the drums triggered by MIDI events with Twitch emotes playing on them. Multiple instances of this window run for multiple different cameras
- [NowPlayingWindow](electron-overlays/src/NowPlayingWindow): displays the current song and artist, with the song progress bar shown in the style of an Elden Ring boss health bar
- [SyncedLyricsWindow](electron-overlays/src/SyncedLyricsWindow): displays either synced lyrics, if an LRC file is available (for songs downloaded through spotdl, which can also retrieve synced lyric files); or shows the video of a song downloaded from YouTube
- [WheelWindow](electron-overlays/src/WheelWindow): manages the song selection wheel of all current song requests. Resizes song request slice sizes (and odds of being selected) based on number of past song requests and request age (🤖 *Largely AI-developed.*)
- *currently unused*:
   - [HeartRateWindow](electron-overlays/src/HeartRateWindow):  interacts with the BLE heart rate monitor to display current heart rate
   - [SongHistoryWindow](electron-overlays/src/SongHistoryWindow): displays the current song and the previous and next few songs in the currently selected playlist
   - [DrumTriggersWindow](electron-overlays/src/DrumTriggersWindow): an invisible process that listens for drum trigger events to override trigger sounds. *The TD-30 drum module I'm using does not allow for uploading custom sounds, so this is a workaround, though it does suffer from latency issues*. This process is largely unused now, as all existing trigger changes were from Shenanigan redemptions


### [job-handlers](job-handlers)

Side process to handle song downloading and stemming, generally running on a separate machine than the music-stem-server and overlays (which run local to the stream itself and OBS).

Interacts with [music-stem-server](music-stem-server) using RabbitMQ.

Relies on the following Python packages to be installed in the environment:
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - downloads videos from YouTube
- [spotdl](https://github.com/spotDL/spotDL) - downloads songs from Spotify (indirectly, using Spotify to fetch metadata and retrieving the songs from YouTube Music)
- [ffmpeg-normalize](https://github.com/slhck/ffmpeg-normalize) - normalizes audio levels of downloaded songs
- [demucs](https://github.com/facebookresearch/demucs) - splits downloaded music into stems

The daemon for this module can be started with `npm start`.


### [cloudflare-worker](cloudflare-worker)

🤖 *Largely AI-developed.*

Web UI running on Cloudflare Workers to display current and all past song requests. Relies on `wrangler` for deployment, deployed using `npm run deploy`, and lives online at [https://songs.dannytheliar.com](https://songs.dannytheliar.com).

Also runs a proxy server for [music-stem-server](music-stem-server) to communicate with the database, since Cloudflare's D1 database is only accessible through a worker.

