using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Threading;
using DrumStreamOverlays.Messages;

namespace DrumStreamOverlays;

public partial class SyncedLyricsWindow : BaseOverlayWindow
{
    // Message types to ignore in logging (like TypeScript version)
    private static readonly HashSet<string> UnloggedMessageTypes = new()
    {
        "ViewersUpdateMessage",
        "SongProgressMessage",
        "ObsSceneChangedMessage",
        "MidiNoteOnMessage",
        "GambaProgressMessage"
    };

    private readonly DispatcherTimer _renderTimer;
    private readonly ObservableCollection<LyricLineViewModel> _lyricLines;
    private LyricLine[] _lyrics = Array.Empty<LyricLine>();
    private bool _isPlaying = false;
    private bool _isSeeking = false;
    private double _currentTimestamp = 0;
    private bool _hasVideo = false;
    private double _playbackRate = 1.0;
    private const int NUM_LYRIC_LINES = 5;

    public override string WindowKey => "synced-lyrics";

    public SyncedLyricsWindow()
    {
        Console.WriteLine("[SyncedLyricsWindow] Constructor called");
        InitializeComponent();

        _lyricLines = new ObservableCollection<LyricLineViewModel>();
        LyricsDisplay.ItemsSource = _lyricLines;

        // Set up render timer to update lyrics smoothly (similar to requestAnimationFrame)
        _renderTimer = new DispatcherTimer(DispatcherPriority.Render)
        {
            Interval = TimeSpan.FromMilliseconds(16) // ~60 FPS
        };
        _renderTimer.Tick += OnRenderTimer;
        _renderTimer.Start();

        MakeClickThrough();

        // Add event handlers for debugging
        Loaded += (s, e) => Console.WriteLine("[SyncedLyricsWindow] Window loaded and visible");
        Activated += (s, e) => Console.WriteLine("[SyncedLyricsWindow] Window activated");

        Console.WriteLine("[SyncedLyricsWindow] Initialization complete");
    }

    private void OnRenderTimer(object? sender, EventArgs e)
    {
        if (_isPlaying)
        {
            // Increment timestamp between WebSocket updates for smoother playback
            _currentTimestamp += (16.0 / 1000.0) * _playbackRate; // 16ms frame time
        }

        RenderLyrics(_currentTimestamp);
    }

    private int _lastCurrentLineIndex = -1;

    private void RenderLyrics(double timestamp)
    {
        if (_lyrics.Length == 0)
        {
            return;
        }

        // Find the current lyric line
        var firstIndexAfterTimestamp = Array.FindIndex(_lyrics, line => line.Timestamp >= timestamp);

        if (firstIndexAfterTimestamp == -1)
        {
            return;
        }

        // Check if we're still on the previous line
        var startIndex = Math.Max(firstIndexAfterTimestamp - 1, 0);
        var nextLines = _lyrics.Skip(startIndex).Take(NUM_LYRIC_LINES).ToArray();

        // Only log when the current line actually changes
        var shouldLog = startIndex != _lastCurrentLineIndex;
        if (shouldLog)
        {
            Console.WriteLine($"[SyncedLyricsWindow] Current line changed to: '{nextLines[0].Text}' (index {startIndex})");
            _lastCurrentLineIndex = startIndex;
        }

        // Update the observable collection
        _lyricLines.Clear();
        for (int i = 0; i < nextLines.Length; i++)
        {
            var line = new LyricLineViewModel
            {
                Text = nextLines[i].Text,
                IsCurrent = i == 0 // First line is the current line
            };
            _lyricLines.Add(line);
        }
    }

    public override void HandleWebSocketMessage(object message)
    {
        var messageTypeName = message.GetType().Name;

        // Only log messages that aren't in the ignore list
        if (!UnloggedMessageTypes.Contains(messageTypeName))
        {
            Console.WriteLine($"[SyncedLyricsWindow] Received WebSocket message: {messageTypeName}");
        }

        Dispatcher.Invoke(() =>
        {
            switch (message)
            {
                case SongChangedMessage songChanged:
                    Console.WriteLine($"[SyncedLyricsWindow] Song changed: {songChanged.Song.Artist} - {songChanged.Song.Title}");
                    Console.WriteLine($"[SyncedLyricsWindow] Has lyrics: {songChanged.Lyrics?.Length ?? 0} lines");
                    Console.WriteLine($"[SyncedLyricsWindow] Is video: {songChanged.Song.IsVideo}");
                    Console.WriteLine($"[SyncedLyricsWindow] Download path: {songChanged.Song.DownloadPath}");
                    Console.WriteLine($"[SyncedLyricsWindow] Lyrics path: {songChanged.Song.LyricsPath}");
                    HandleSongChanged(songChanged);
                    break;

                case SongProgressMessage progress:
                    HandleSongProgress(progress);
                    break;

                case SongStoppedMessage:
                    Console.WriteLine($"[SyncedLyricsWindow] Song stopped");
                    HandleSongStopped();
                    break;

                case SongPlayedMessage played:
                    Console.WriteLine($"[SyncedLyricsWindow] Song played at: {played.Timestamp}s");
                    HandleSongPlayed(played);
                    break;

                case SongPlaybackPausedMessage:
                    Console.WriteLine($"[SyncedLyricsWindow] Song paused");
                    HandleSongPaused();
                    break;

                case SongSpeedMessage speed:
                    Console.WriteLine($"[SyncedLyricsWindow] Speed changed to: {speed.Speed}");
                    HandleSongSpeed(speed);
                    break;

                case SongPlaybackCompletedMessage:
                    Console.WriteLine($"[SyncedLyricsWindow] Song playback completed");
                    HandleSongStopped(); // Same behavior as song stopped
                    break;
            }
        });
    }

    private async void HandleSongChanged(SongChangedMessage message)
    {
        Console.WriteLine($"[SyncedLyricsWindow] HandleSongChanged called");
        _lyrics = message.Lyrics ?? Array.Empty<LyricLine>();
        Console.WriteLine($"[SyncedLyricsWindow] Loaded {_lyrics.Length} lyrics from message");

        // Handle video if available
        if (message.Song.IsVideo == 1 && !string.IsNullOrEmpty(message.Song.DownloadPath))
        {
            Console.WriteLine($"[SyncedLyricsWindow] Video detected, loading: {message.Song.DownloadPath}");
            Console.WriteLine($"[SyncedLyricsWindow] File exists check: {File.Exists(message.Song.DownloadPath)}");
            Console.WriteLine($"[SyncedLyricsWindow] Is well-formed URI: {Uri.IsWellFormedUriString(message.Song.DownloadPath, UriKind.Absolute)}");

            try
            {
                // Check if it's a URL or local file
                if (Uri.IsWellFormedUriString(message.Song.DownloadPath, UriKind.Absolute))
                {
                    VideoPlayer.Source = new Uri(message.Song.DownloadPath);
                    Console.WriteLine($"[SyncedLyricsWindow] Set video source to URI: {message.Song.DownloadPath}");
                }
                else if (File.Exists(message.Song.DownloadPath))
                {
                    var fullPath = Path.GetFullPath(message.Song.DownloadPath);
                    VideoPlayer.Source = new Uri(fullPath);
                    Console.WriteLine($"[SyncedLyricsWindow] Set video source to file: {fullPath}");
                }
                else
                {
                    Console.WriteLine($"[SyncedLyricsWindow] Video file not found and not a valid URI: {message.Song.DownloadPath}");
                    _hasVideo = false;
                    return;
                }

                _hasVideo = true;
                Console.WriteLine($"[SyncedLyricsWindow] Video loaded successfully");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[SyncedLyricsWindow] Error loading video: {ex.Message}");
                _hasVideo = false;
            }
        }
        else
        {
            Console.WriteLine($"[SyncedLyricsWindow] No video for this song (IsVideo: {message.Song.IsVideo}, DownloadPath: '{message.Song.DownloadPath}')");
            VideoPlayer.Source = null;
            _hasVideo = false;
        }

        // If no lyrics were provided but we have lyricsPath, try to load them
        if (_lyrics.Length == 0 && !string.IsNullOrEmpty(message.Song.LyricsPath))
        {
            Console.WriteLine($"[SyncedLyricsWindow] No lyrics in message, trying to load from path: {message.Song.LyricsPath}");
            Console.WriteLine($"[SyncedLyricsWindow] Lyrics file exists check: {File.Exists(message.Song.LyricsPath)}");

            try
            {
                _lyrics = await LoadLyricsFromPath(message.Song.LyricsPath, message.Song.DownloadPath, message.Song.Duration);
                Console.WriteLine($"[SyncedLyricsWindow] Loaded {_lyrics.Length} lyrics from file");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[SyncedLyricsWindow] Error loading lyrics: {ex.Message}");
            }
        }
        else if (_lyrics.Length == 0)
        {
            Console.WriteLine($"[SyncedLyricsWindow] No lyrics available - neither in message nor file path provided");
        }

        _currentTimestamp = 0;
        _isPlaying = false;

        // Show the window when a new song starts
        Console.WriteLine("[SyncedLyricsWindow] Showing window - new song loaded");
        Visibility = Visibility.Visible;

        // Update display based on what content is available
        UpdateDisplay();

        Console.WriteLine($"[SyncedLyricsWindow] Calling RenderLyrics with {_lyrics.Length} lyrics");
        RenderLyrics(_currentTimestamp);
    }

    private void HandleSongProgress(SongProgressMessage message)
    {

        // Handle video seeking if needed (like TypeScript code)
        if (_hasVideo && VideoPlayer.Source != null)
        {
            var videoTime = VideoPlayer.Position.TotalSeconds;
            var timeDifference = Math.Abs(videoTime - message.Timestamp);

            if (!_isSeeking && timeDifference > (1 * _playbackRate))
            {
                Console.WriteLine($"[SyncedLyricsWindow] Video seeking: {videoTime:F1}s -> {message.Timestamp:F1}s (diff: {timeDifference:F1}s)");
                VideoPlayer.Position = TimeSpan.FromSeconds(message.Timestamp);
                _isSeeking = true;
            }
            else
            {
                _isSeeking = false;
            }
        }

        _currentTimestamp = message.Timestamp;
        RenderLyrics(_currentTimestamp);
    }

    private void HandleSongStopped()
    {
        _lyrics = Array.Empty<LyricLine>();
        _isPlaying = false;
        VideoPlayer.Source = null;
        VideoPlayer.Visibility = Visibility.Hidden;
        _hasVideo = false;
        RenderLyrics(_currentTimestamp);

        // Hide the entire window when song is stopped
        Console.WriteLine("[SyncedLyricsWindow] Hiding window - song stopped");
        Visibility = Visibility.Hidden;
    }

    private void HandleSongPlayed(SongPlayedMessage message)
    {
        Console.WriteLine($"[SyncedLyricsWindow] Song played at timestamp: {message.Timestamp:F1}s");
        _currentTimestamp = message.Timestamp;
        if (_hasVideo && VideoPlayer.Source != null)
        {
            Console.WriteLine($"[SyncedLyricsWindow] Starting video playback");
            VideoPlayer.Play();
        }
        _isPlaying = true;
    }

    private void HandleSongPaused()
    {
        Console.WriteLine($"[SyncedLyricsWindow] Song paused");
        if (_hasVideo && VideoPlayer.Source != null)
        {
            Console.WriteLine($"[SyncedLyricsWindow] Pausing video playback");
            VideoPlayer.Pause();
        }
        _isPlaying = false;
    }

    private void HandleSongSpeed(SongSpeedMessage message)
    {
        _playbackRate = message.Speed;
        if (_hasVideo && VideoPlayer.Source != null)
        {
            VideoPlayer.SpeedRatio = _playbackRate;
        }
    }

    private async Task<LyricLine[]> LoadLyricsFromPath(string lyricsPath, string? downloadPath, double mediaDuration)
    {
        try
        {
            string lyricsContent;

            // Try to construct the full path using downloadPath (like TypeScript code)
            if (!string.IsNullOrEmpty(downloadPath))
            {
                // Normalize path separators and split
                var normalizedDownloadPath = downloadPath.Replace('\\', '/');
                var pathParts = normalizedDownloadPath.Split('/');
                pathParts[pathParts.Length - 1] = lyricsPath;
                var fullPath = string.Join("/", pathParts);

                Console.WriteLine($"[SyncedLyricsWindow] Constructed lyrics path: {fullPath}");
                Console.WriteLine($"[SyncedLyricsWindow] From downloadPath: {downloadPath}, lyricsPath: {lyricsPath}");

                // Check if it's actually a web URL (not just a well-formed URI)
                if (fullPath.StartsWith("http://") || fullPath.StartsWith("https://") || fullPath.StartsWith("ftp://"))
                {
                    Console.WriteLine($"[SyncedLyricsWindow] Fetching lyrics from URL: {fullPath}");
                    // URL - fetch via HTTP
                    using var client = new HttpClient();
                    lyricsContent = await client.GetStringAsync(fullPath);
                }
                else
                {
                    // Local file path - handle both forward and backslash cases
                    string localPath;

                    // If the original downloadPath contained backslashes, preserve the structure
                    if (downloadPath.Contains('\\'))
                    {
                        // Reconstruct using original path structure
                        var originalParts = downloadPath.Split('\\', '/');
                        originalParts[originalParts.Length - 1] = lyricsPath;
                        localPath = string.Join(Path.DirectorySeparatorChar.ToString(), originalParts);
                    }
                    else
                    {
                        // Convert forward slashes to backslashes for Windows
                        localPath = fullPath.Replace('/', Path.DirectorySeparatorChar);
                    }

                    Console.WriteLine($"[SyncedLyricsWindow] Checking local file: {localPath}");
                    Console.WriteLine($"[SyncedLyricsWindow] File exists: {File.Exists(localPath)}");

                    if (File.Exists(localPath))
                    {
                        Console.WriteLine($"[SyncedLyricsWindow] Loading lyrics from local file");
                        lyricsContent = await File.ReadAllTextAsync(localPath);
                    }
                    else
                    {
                        Console.WriteLine($"[SyncedLyricsWindow] Lyrics file not found at: {localPath}");
                        return Array.Empty<LyricLine>();
                    }
                }
            }
            else
            {
                return Array.Empty<LyricLine>();
            }

            return ParseLyrics(lyricsContent, mediaDuration);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error loading lyrics from path: {ex.Message}");
            return Array.Empty<LyricLine>();
        }
    }

    private static LyricLine[] ParseLyrics(string lyricsContent, double mediaDuration)
    {
        var lines = lyricsContent.Split('\n');
        var lyrics = new List<LyricLine>();

        double offset = 0;

        foreach (var line in lines)
        {
            // Check for length directive
            var lengthMatch = Regex.Match(line, @"^\[length: (\d*:\d*\.?\d*)\]");
            if (lengthMatch.Success)
            {
                var lrcDuration = ParseLRCTimeToFloat(lengthMatch.Groups[1].Value);
                offset = lrcDuration - mediaDuration;
                continue;
            }

            // Parse lyric lines
            var lineMatch = Regex.Match(line, @"^\[(\d*:\d*\.?\d*)\](.+)");
            if (lineMatch.Success)
            {
                var timestamp = ParseLRCTimeToFloat(lineMatch.Groups[1].Value) - offset;
                var text = lineMatch.Groups[2].Value.Trim();

                lyrics.Add(new LyricLine
                {
                    Timestamp = timestamp,
                    Text = text
                });
            }
        }

        if (lyrics.Count > 0) {
            // Pad start with an empty line before the first real line happens
            lyrics.Insert(0, new LyricLine { Timestamp = 0, Text = "" });
        }

        return lyrics.ToArray();
    }

    private static double ParseLRCTimeToFloat(string lrcTime)
    {
        var timeParts = lrcTime.Split(':');
        var mins = int.Parse(timeParts[0]);
        var secs = double.Parse(timeParts[1]);
        return (mins * 60) + secs;
    }

    protected override void OnClosed(EventArgs e)
    {
        _renderTimer?.Stop();
        base.OnClosed(e);
    }

    private void VideoPlayer_MediaEnded(object sender, RoutedEventArgs e)
    {
        Console.WriteLine($"[SyncedLyricsWindow] Video playback ended");
    }

    private void VideoPlayer_MediaFailed(object sender, ExceptionRoutedEventArgs e)
    {
        Console.WriteLine($"[SyncedLyricsWindow] Video playback failed: {e.ErrorException?.Message}");
        VideoPlayer.Visibility = Visibility.Hidden;
        _hasVideo = false;
        UpdateDisplay(); // Refresh display after video failure
    }

    private void UpdateDisplay()
    {
        if (_hasVideo)
        {
            // Show video, hide lyrics
            VideoPlayer.Visibility = Visibility.Visible;
            LyricsContainer.Visibility = Visibility.Hidden;
            Console.WriteLine($"[SyncedLyricsWindow] Display mode: VIDEO (hiding lyrics)");
        }
        else if (_lyrics.Length > 0)
        {
            // Show lyrics, hide video
            VideoPlayer.Visibility = Visibility.Hidden;
            LyricsContainer.Visibility = Visibility.Visible;
            Console.WriteLine($"[SyncedLyricsWindow] Display mode: LYRICS (hiding video)");
        }
        else
        {
            // Hide both
            VideoPlayer.Visibility = Visibility.Hidden;
            LyricsContainer.Visibility = Visibility.Hidden;
            Console.WriteLine($"[SyncedLyricsWindow] Display mode: HIDDEN (no content)");
        }
    }
}

public class LyricLineViewModel : INotifyPropertyChanged
{
    private string _text = string.Empty;
    private bool _isCurrent = false;

    public string Text
    {
        get => _text;
        set
        {
            if (_text != value)
            {
                _text = value;
                OnPropertyChanged();
            }
        }
    }

    public bool IsCurrent
    {
        get => _isCurrent;
        set
        {
            if (_isCurrent != value)
            {
                _isCurrent = value;
                OnPropertyChanged();
            }
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    protected virtual void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
