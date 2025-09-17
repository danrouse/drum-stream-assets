using System.Text.Json.Serialization;

namespace DrumStreamOverlays.Messages;

// Partial from Streamerbot, since these definitions are in a place without dependencies
public class StreamerbotViewer
{
    [JsonPropertyName("login")]
    public string Login { get; set; } = string.Empty;

    [JsonPropertyName("display")]
    public string Display { get; set; } = string.Empty;

    [JsonPropertyName("previousActive")]
    public string PreviousActive { get; set; } = string.Empty;

    [JsonPropertyName("role")]
    public string Role { get; set; } = string.Empty;

    [JsonPropertyName("subscribed")]
    public bool Subscribed { get; set; }

    [JsonPropertyName("online")]
    public bool Online { get; set; }
}

public abstract class WebSocketServerMessage
{
    [JsonPropertyName("type")]
    public abstract string Type { get; }
}

public class SongRequestAddedMessage : WebSocketServerMessage
{
    public override string Type => "song_request_added";

    [JsonPropertyName("songRequestId")]
    public int SongRequestId { get; set; }
}

public class SongRequestRemovedMessage : WebSocketServerMessage
{
    public override string Type => "song_request_removed";

    [JsonPropertyName("songRequestId")]
    public int SongRequestId { get; set; }
}

public class SongRequestMovedMessage : WebSocketServerMessage
{
    public override string Type => "song_request_moved";

    [JsonPropertyName("songRequestId")]
    public int SongRequestId { get; set; }
}

public class SongRequestMessage : WebSocketServerMessage
{
    public override string Type => "song_request";

    [JsonPropertyName("query")]
    public string Query { get; set; } = string.Empty;
}

public class ClientRemoteControlMessage : WebSocketServerMessage
{
    public override string Type => "client_remote_control";

    [JsonPropertyName("action")]
    public string Action { get; set; } = string.Empty;

    [JsonPropertyName("duration")]
    public double? Duration { get; set; }

    [JsonPropertyName("amount")]
    public int? Amount { get; set; }
}

public class EmoteUsedMessage : WebSocketServerMessage
{
    public override string Type => "emote_used";

    [JsonPropertyName("emoteURLs")]
    public string[] EmoteURLs { get; set; } = Array.Empty<string>();
}

public class EmoteDefaultSetMessage : WebSocketServerMessage
{
    public override string Type => "emote_default_set";

    [JsonPropertyName("emoteURL")]
    public string EmoteURL { get; set; } = string.Empty;
}

public class EmotePinnedMessage : WebSocketServerMessage
{
    public override string Type => "emote_pinned";

    [JsonPropertyName("emoteURL")]
    public string? EmoteURL { get; set; }
}

public class MidiNoteOnMessage : WebSocketServerMessage
{
    public override string Type => "midi_note_on";

    [JsonPropertyName("note")]
    public int Note { get; set; }

    [JsonPropertyName("velocity")]
    public int Velocity { get; set; }
}

public class ViewersUpdateMessage : WebSocketServerMessage
{
    public override string Type => "viewers_update";

    [JsonPropertyName("viewers")]
    public StreamerbotViewer[] Viewers { get; set; } = Array.Empty<StreamerbotViewer>();
}

public class ObsSceneChangedMessage : WebSocketServerMessage
{
    public override string Type => "obs_scene_changed";

    [JsonPropertyName("scene")]
    public string Scene { get; set; } = string.Empty;

    [JsonPropertyName("oldScene")]
    public string OldScene { get; set; } = string.Empty;
}

public class ChatMessageMessage : WebSocketServerMessage
{
    public override string Type => "chat_message";

    [JsonPropertyName("user")]
    public string User { get; set; } = string.Empty;

    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;
}

public class GuessTheSongScore
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("count")]
    public int Count { get; set; }
}

public class GuessTheSongScoresMessage : WebSocketServerMessage
{
    public override string Type => "guess_the_song_scores";

    [JsonPropertyName("daily")]
    public GuessTheSongScore[] Daily { get; set; } = Array.Empty<GuessTheSongScore>();

    [JsonPropertyName("weekly")]
    public GuessTheSongScore[] Weekly { get; set; } = Array.Empty<GuessTheSongScore>();

    [JsonPropertyName("lifetime")]
    public GuessTheSongScore[] Lifetime { get; set; } = Array.Empty<GuessTheSongScore>();
}

public class GambaStartedMessage : WebSocketServerMessage
{
    public override string Type => "gamba_started";

    [JsonPropertyName("drumName")]
    public string DrumName { get; set; } = string.Empty;
}

public class GambaProgressMessage : WebSocketServerMessage
{
    public override string Type => "gamba_progress";

    [JsonPropertyName("count")]
    public int Count { get; set; }
}

public class GambaCompleteMessage : WebSocketServerMessage
{
    public override string Type => "gamba_complete";
}

public class WheelToggleVisibilityMessage : WebSocketServerMessage
{
    public override string Type => "wheel_toggle_visibility";
}

public class WheelSpinMessage : WebSocketServerMessage
{
    public override string Type => "wheel_spin";
}

public class WheelSelectionMessage : WebSocketServerMessage
{
    public override string Type => "wheel_selection";

    [JsonPropertyName("songRequestId")]
    public int SongRequestId { get; set; }
}

// Player messages
public abstract class WebSocketPlayerMessage
{
    [JsonPropertyName("type")]
    public abstract string Type { get; }
}

public class SongData
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("createdAt")]
    public string? CreatedAt { get; set; }

    [JsonPropertyName("artist")]
    public string Artist { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("album")]
    public string? Album { get; set; }

    [JsonPropertyName("duration")]
    public double Duration { get; set; }

    [JsonPropertyName("stemsPath")]
    public string StemsPath { get; set; } = string.Empty;

    [JsonPropertyName("downloadPath")]
    public string? DownloadPath { get; set; }

    [JsonPropertyName("isVideo")]
    public int? IsVideo { get; set; }

    [JsonPropertyName("lyricsPath")]
    public string? LyricsPath { get; set; }

    [JsonPropertyName("requester")]
    public string? Requester { get; set; }

    [JsonPropertyName("priority")]
    public int? Priority { get; set; }

    [JsonPropertyName("noShenanigans")]
    public int? NoShenanigans { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("songRequestId")]
    public int? SongRequestId { get; set; }

    [JsonPropertyName("fulfilledToday")]
    public int? FulfilledToday { get; set; }
}

public class QueueInfo
{
    [JsonPropertyName("songs")]
    public int Songs { get; set; }

    [JsonPropertyName("duration")]
    public double Duration { get; set; }
}

public class SongChangedMessage : WebSocketPlayerMessage
{
    public override string Type => "song_changed";

    [JsonPropertyName("song")]
    public SongData Song { get; set; } = new();

    [JsonPropertyName("previousSongs")]
    public SongData[]? PreviousSongs { get; set; }

    [JsonPropertyName("nextSongs")]
    public SongData[]? NextSongs { get; set; }

    [JsonPropertyName("queue")]
    public QueueInfo? Queue { get; set; }

    [JsonPropertyName("lyrics")]
    public LyricLine[]? Lyrics { get; set; }
}

public class SongProgressMessage : WebSocketPlayerMessage
{
    public override string Type => "song_progress";

    [JsonPropertyName("timestamp")]
    public double Timestamp { get; set; }
}

public class SongPlayedMessage : WebSocketPlayerMessage
{
    public override string Type => "song_played";

    [JsonPropertyName("timestamp")]
    public double Timestamp { get; set; }
}

public class SongPlaybackPausedMessage : WebSocketPlayerMessage
{
    public override string Type => "song_playpack_paused";
}

public class SongStoppedMessage : WebSocketPlayerMessage
{
    public override string Type => "song_stopped";
}

public class SongSpeedMessage : WebSocketPlayerMessage
{
    public override string Type => "song_speed";

    [JsonPropertyName("speed")]
    public double Speed { get; set; }
}

public class SongPlaybackStartedMessage : WebSocketPlayerMessage
{
    public override string Type => "song_playback_started";

    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("songRequestId")]
    public int? SongRequestId { get; set; }
}

public class SongPlaybackCompletedMessage : WebSocketPlayerMessage
{
    public override string Type => "song_playback_completed";

    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("songRequestId")]
    public int? SongRequestId { get; set; }
}

public class PlayerSongRequestRemovedMessage : WebSocketPlayerMessage
{
    public override string Type => "song_request_removed";

    [JsonPropertyName("songRequestId")]
    public int SongRequestId { get; set; }
}

public class GuessTheSongRoundCompleteMessage : WebSocketPlayerMessage
{
    public override string Type => "guess_the_song_round_complete";

    [JsonPropertyName("winner")]
    public string? Winner { get; set; }

    [JsonPropertyName("time")]
    public int? Time { get; set; }

    [JsonPropertyName("otherWinners")]
    public string[] OtherWinners { get; set; } = Array.Empty<string>();
}

public class SongRequestData : SongData
{
    [JsonPropertyName("downloadPath")]
    public new string DownloadPath { get; set; } = string.Empty;

    [JsonPropertyName("isVideo")]
    public new int IsVideo { get; set; }

    [JsonPropertyName("lyricsPath")]
    public new string? LyricsPath { get; set; }

    [JsonPropertyName("requester")]
    public new string? Requester { get; set; }

    [JsonPropertyName("priority")]
    public new int Priority { get; set; }

    [JsonPropertyName("noShenanigans")]
    public new int? NoShenanigans { get; set; }

    [JsonPropertyName("status")]
    public new string Status { get; set; } = string.Empty;

    [JsonPropertyName("songRequestId")]
    public new int SongRequestId { get; set; }

    [JsonPropertyName("createdAt")]
    public new string CreatedAt { get; set; } = string.Empty;

    [JsonPropertyName("bumpCount")]
    public int BumpCount { get; set; }
}

public class LegacySongData
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty; // for paths

    [JsonPropertyName("artist")]
    public string Artist { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("stems")]
    public string[] Stems { get; set; } = Array.Empty<string>();

    [JsonPropertyName("downloadDate")]
    public DateTime DownloadDate { get; set; }

    [JsonPropertyName("album")]
    public string Album { get; set; } = string.Empty;

    [JsonPropertyName("track")]
    public int[] Track { get; set; } = new int[2]; // [number, number]

    [JsonPropertyName("duration")]
    public double Duration { get; set; }

    [JsonPropertyName("requesterName")]
    public string? RequesterName { get; set; }

    [JsonPropertyName("requestTime")]
    public DateTime? RequestTime { get; set; }
}

public class LyricLine
{
    [JsonPropertyName("timestamp")]
    public double Timestamp { get; set; }

    [JsonPropertyName("text")]
    public string Text { get; set; } = string.Empty;
}
