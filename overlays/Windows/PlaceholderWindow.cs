using System.Windows.Controls;
using System.Windows.Media;

namespace DrumStreamOverlays;

public class PlaceholderWindow : BaseOverlayWindow
{
    private readonly string _windowKey;

    public PlaceholderWindow(string windowKey, string displayName)
    {
        _windowKey = windowKey;
        Title = displayName;

        var textBlock = new TextBlock
        {
            Text = $"{displayName}\n(Placeholder)",
            FontSize = 24,
            Foreground = Brushes.White,
            Background = new SolidColorBrush(Color.FromArgb(128, 0, 0, 0)),
            TextAlignment = System.Windows.TextAlignment.Center,
            HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
            VerticalAlignment = System.Windows.VerticalAlignment.Center,
            Padding = new System.Windows.Thickness(20)
        };

        Content = textBlock;
    }

    public override string WindowKey => _windowKey;

    public override void HandleWebSocketMessage(object message)
    {
        // Placeholder implementation - specific windows will override this
    }
}

// Placeholder implementations for all window types
public class MidiNotesWindow : PlaceholderWindow
{
    public MidiNotesWindow(string key) : base($"midi-{key}", $"MIDI Notes ({key})")
    {
    }
}

public class NowPlayingWindow : PlaceholderWindow
{
    public NowPlayingWindow() : base("now-playing", "Now Playing")
    {
    }
}

// SyncedLyricsWindow is now implemented in its own file

public class AudioDisplayWindow : PlaceholderWindow
{
    public AudioDisplayWindow() : base("audio-display", "Audio Display")
    {
    }
}

public class SongHistoryWindow : PlaceholderWindow
{
    public SongHistoryWindow() : base("song-history", "Song History")
    {
    }
}

public class DrumTriggersWindow : PlaceholderWindow
{
    public DrumTriggersWindow() : base("drum-triggers", "Drum Triggers")
    {
    }
}

public class GuessTheSongWindow : PlaceholderWindow
{
    public GuessTheSongWindow() : base("guess-the-song", "Guess The Song")
    {
    }
}

public class HeartRateWindow : PlaceholderWindow
{
    public HeartRateWindow() : base("heart-rate", "Heart Rate")
    {
    }
}

public class GambaWindow : PlaceholderWindow
{
    public GambaWindow() : base("gamba", "GAMBA")
    {
    }
}

public class WheelWindow : PlaceholderWindow
{
    public WheelWindow() : base("wheel", "Wheel")
    {
    }
}
