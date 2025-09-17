using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;
using System.IO;
using System.Net.Http;
using DrumStreamOverlays.Messages;
using NAudio.Wave;

namespace DrumStreamOverlays;

public partial class AudioDisplayWindow : BaseOverlayWindow
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

    private readonly HttpClient _httpClient;
    private readonly DispatcherTimer _renderTimer;
    private double _duration = 0;
    private double _currentPosition = 0;
    private double _lastSyncedPosition = 0;
    private DateTime _lastSyncTime = DateTime.Now;
    private double _lastRenderedPosition = -1;
    private bool _isPlaying = false;
    private double _playbackRate = 1.0;
    private float[] _waveformData = Array.Empty<float>();
    private readonly List<Rectangle> _waveformBars = new();

    // Audio visualization constants (matching original)
    private const double MinPixelsPerSecond = 300; // 300 pixels per second of audio
    private const double BarHeight = 2.5;
    private const string WaveColor = "#ef5959";
    private const double VisibleTimeWindow = 10.0; // Show ~10 seconds at a time
    private const double TimingOffset = -0.3; // Small offset to compensate for audio analysis timing differences
    // Adjust this value if centering is still off:
    // - Increase if waveform appears too early (e.g., 0.08, 0.1)
    // - Decrease if waveform appears too late (e.g., 0.02, 0.0)

    public override string WindowKey => "audio-display";

    public AudioDisplayWindow()
    {
        InitializeComponent();
        _httpClient = new HttpClient();

        // Set up 60fps render timer (like the original requestAnimationFrame)
        _renderTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(1000.0 / 60.0) // 60 FPS
        };
        _renderTimer.Tick += OnRenderTick;
        _renderTimer.Start();

        Console.WriteLine($"[AudioDisplayWindow] Constructor called");

        Loaded += (_, _) =>
        {
            Console.WriteLine($"[AudioDisplayWindow] Window loaded and visible");
            // Ensure progress line is added to canvas
            if (!WaveformCanvas.Children.Contains(ProgressLine))
            {
                WaveformCanvas.Children.Add(ProgressLine);
            }
        };
    }

    private void OnRenderTick(object? sender, EventArgs e)
    {
        if (_isPlaying && _duration > 0)
        {
            // Interpolate current position based on time elapsed since last sync
            var elapsed = (DateTime.Now - _lastSyncTime).TotalSeconds;
            var newPosition = _lastSyncedPosition + (elapsed * _playbackRate);

            // Clamp to song duration
            newPosition = Math.Max(0, Math.Min(newPosition, _duration));

            // Only update if position actually changed significantly
            if (Math.Abs(newPosition - _currentPosition) > 0.001)
            {
                _currentPosition = newPosition;
            }
        }

        // Update progress indicator and waveform at 60fps
        UpdateProgressIndicator();
    }

    public override void HandleWebSocketMessage(object message)
    {
        var messageTypeName = message.GetType().Name;

        // Only log messages that aren't in the ignore list
        if (!UnloggedMessageTypes.Contains(messageTypeName))
        {
            Console.WriteLine($"[AudioDisplayWindow] Received WebSocket message: {messageTypeName}");
        }

        Dispatcher.Invoke(() =>
        {
            switch (message)
            {
                case SongChangedMessage songChanged:
                    Console.WriteLine($"[AudioDisplayWindow] Song changed: {songChanged.Song.Artist} - {songChanged.Song.Title}");
                    Console.WriteLine($"[AudioDisplayWindow] Stems path: {songChanged.Song.StemsPath}");
                    HandleSongChanged(songChanged);
                    break;

                case SongProgressMessage progress:
                    HandleSongProgress(progress);
                    break;

                case SongStoppedMessage:
                    Console.WriteLine($"[AudioDisplayWindow] Song stopped");
                    HandleSongStopped();
                    break;

                case SongPlayedMessage played:
                    Console.WriteLine($"[AudioDisplayWindow] Song played at: {played.Timestamp}s");
                    HandleSongPlayed(played);
                    break;

                case SongPlaybackPausedMessage:
                    Console.WriteLine($"[AudioDisplayWindow] Song paused");
                    HandleSongPaused();
                    break;

                case SongSpeedMessage speed:
                    Console.WriteLine($"[AudioDisplayWindow] Playback speed changed to: {speed.Speed}x");
                    HandleSongSpeed(speed);
                    break;

                case SongPlaybackCompletedMessage:
                    Console.WriteLine($"[AudioDisplayWindow] Song playback completed");
                    HandleSongStopped(); // Same behavior as song stopped
                    break;
            }
        });
    }

    private async void HandleSongChanged(SongChangedMessage message)
    {
        Console.WriteLine($"[AudioDisplayWindow] HandleSongChanged called");

        // Clear existing waveform
        ClearWaveform();

        _duration = message.Song.Duration;
        _currentPosition = 0;
        _lastSyncedPosition = 0;
        _lastSyncTime = DateTime.Now;
        _lastRenderedPosition = -1; // Force re-render on new song
        _isPlaying = false;

        // Show the window when a new song starts
        Console.WriteLine("[AudioDisplayWindow] Showing window - new song loaded");
        Visibility = Visibility.Visible;

        // Load audio from drums stem
        if (!string.IsNullOrEmpty(message.Song.StemsPath))
        {
            var drumsUrl = $"http://localhost:3000{message.Song.StemsPath}/drums.mp3";
            Console.WriteLine($"[AudioDisplayWindow] Loading drums audio from: {drumsUrl}");

            ShowLoading(true);
            await LoadAudioWaveform(drumsUrl);
            ShowLoading(false);
        }
        else
        {
            Console.WriteLine($"[AudioDisplayWindow] No stems path provided");
        }
    }

    private void HandleSongProgress(SongProgressMessage message)
    {
        // Sync the interpolation with the actual position from the server
        _currentPosition = message.Timestamp;
        _lastSyncedPosition = message.Timestamp;
        _lastSyncTime = DateTime.Now;
        // Note: UpdateProgressIndicator() is called by the 60fps timer
    }

    private void HandleSongStopped()
    {
        _isPlaying = false;
        _currentPosition = 0;
        _lastSyncedPosition = 0;
        _lastSyncTime = DateTime.Now;
        ClearWaveform();

        // Hide the entire window when song is stopped
        Console.WriteLine("[AudioDisplayWindow] Hiding window - song stopped");
        Visibility = Visibility.Hidden;
    }

    private void HandleSongPlayed(SongPlayedMessage message)
    {
        _isPlaying = true;
        _currentPosition = message.Timestamp;
        _lastSyncedPosition = message.Timestamp;
        _lastSyncTime = DateTime.Now;
    }

    private void HandleSongPaused()
    {
        _isPlaying = false;
    }

    private void HandleSongSpeed(SongSpeedMessage message)
    {
        _playbackRate = message.Speed;
    }

    private async Task LoadAudioWaveform(string audioUrl)
    {
        try
        {
            Console.WriteLine($"[AudioDisplayWindow] Downloading audio for waveform analysis...");

            // Download the audio file
            var audioData = await _httpClient.GetByteArrayAsync(audioUrl);
            Console.WriteLine($"[AudioDisplayWindow] Downloaded {audioData.Length} bytes");

            // Use NAudio to analyze the actual audio content
            await GenerateRealWaveform(audioData);

            Console.WriteLine($"[AudioDisplayWindow] Waveform generated successfully");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[AudioDisplayWindow] Error loading audio waveform: {ex.Message}");
        }
    }

    private async Task GenerateRealWaveform(byte[] audioData)
    {
        await Task.Run(() =>
        {
            try
            {
                Console.WriteLine($"[AudioDisplayWindow] Starting real audio analysis with NAudio...");

                // Save the audio data to a temporary file since NAudio often requires file paths
                var tempFilePath = System.IO.Path.GetTempFileName();
                var tempMp3Path = System.IO.Path.ChangeExtension(tempFilePath, ".mp3");
                File.WriteAllBytes(tempMp3Path, audioData);

                // Use Mp3FileReader to decode the MP3 file
                WaveStream audioReader;
                try
                {
                    audioReader = new Mp3FileReader(tempMp3Path);
                }
                catch (Exception ex)
                {
                    // Clean up temp file and fallback to byte analysis
                    File.Delete(tempMp3Path);
                    File.Delete(tempFilePath);
                    Console.WriteLine($"[AudioDisplayWindow] MP3 decoding failed: {ex.Message}");
                    throw new NotSupportedException("MP3 decoding not available");
                }

                using (audioReader)
                {
                    Console.WriteLine($"[AudioDisplayWindow] Audio info - Sample Rate: {audioReader.WaveFormat.SampleRate}, Channels: {audioReader.WaveFormat.Channels}, Duration: {audioReader.TotalTime.TotalSeconds:F2}s");

                    // Calculate how many samples we want for our waveform display
                    var targetSamples = (int)(_duration * MinPixelsPerSecond); // Even higher resolution for smoother bars
                    var waveform = new float[targetSamples];

                    // Convert to sample provider for easier processing
                    var sampleProvider = audioReader.ToSampleProvider();
                    var audioSamplesPerWaveformSample = (double)(audioReader.TotalTime.TotalSeconds * audioReader.WaveFormat.SampleRate) / targetSamples;

                    Console.WriteLine($"[AudioDisplayWindow] Analyzing audio into {targetSamples} waveform points");

                    // Read and analyze the audio in chunks
                    var sampleBuffer = new float[audioReader.WaveFormat.SampleRate]; // 1 second buffer
                    var waveformIndex = 0;
                    var currentMax = 0.0f;
                    var audioSampleIndex = 0;
                    var nextWaveformSampleAt = audioSamplesPerWaveformSample;

                    int samplesRead;
                    while ((samplesRead = sampleProvider.Read(sampleBuffer, 0, sampleBuffer.Length)) > 0 && waveformIndex < targetSamples)
                    {
                        for (int i = 0; i < samplesRead; i += audioReader.WaveFormat.Channels)
                        {
                            // Average stereo channels if present, or take mono
                            float sampleValue = 0.0f;
                            for (int channel = 0; channel < audioReader.WaveFormat.Channels && i + channel < samplesRead; channel++)
                            {
                                sampleValue += Math.Abs(sampleBuffer[i + channel]);
                            }
                            sampleValue /= audioReader.WaveFormat.Channels;

                            // Track the maximum amplitude in this bucket
                            currentMax = Math.Max(currentMax, sampleValue);

                            // Check if we've reached the next waveform sample point
                            if (audioSampleIndex >= nextWaveformSampleAt && waveformIndex < targetSamples)
                            {
                                // Store the peak amplitude for this time window
                                waveform[waveformIndex] = currentMax;

                                // Reset for next bucket
                                currentMax = 0.0f;
                                waveformIndex++;
                                nextWaveformSampleAt += audioSamplesPerWaveformSample;
                            }

                            audioSampleIndex++;
                        }
                    }

                    // Fill any remaining waveform samples
                    for (int i = waveformIndex; i < targetSamples; i++)
                    {
                        waveform[i] = 0.0f;
                    }

                    _waveformData = waveform;

                    Console.WriteLine($"[AudioDisplayWindow] Audio analysis complete. Generated {targetSamples} waveform points with peak amplitude: {waveform.Max():F3}");
                }

                // Clean up temporary file
                try
                {
                    File.Delete(tempMp3Path);
                    File.Delete(tempFilePath);
                }
                catch
                {
                    // Ignore cleanup errors
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[AudioDisplayWindow] Error during audio analysis: {ex.Message}");
                Console.WriteLine($"[AudioDisplayWindow] Falling back to silent waveform");

                // Fall back to a silent waveform on error
                var targetSamples = (int)(_duration * MinPixelsPerSecond / 2);
                _waveformData = new float[targetSamples]; // All zeros = silence
            }
        });

        // Update UI on main thread
        Dispatcher.Invoke(() =>
        {
            RenderWaveform();
        });
    }

    private void RenderWaveform()
    {
        if (_waveformData.Length == 0) return;

        ClearWaveform();

        var canvasWidth = WaveformCanvas.ActualWidth > 0 ? WaveformCanvas.ActualWidth : Width;
        var canvasHeight = WaveformCanvas.ActualHeight > 0 ? WaveformCanvas.ActualHeight : Height;

        if (canvasWidth <= 0 || canvasHeight <= 0) return;

        // Calculate which portion of the waveform to show
        var startTime = Math.Max(0, _currentPosition - VisibleTimeWindow / 2);
        var endTime = Math.Min(_duration, _currentPosition + VisibleTimeWindow / 2);

        // Calculate sample indices for the visible window
        var samplesPerSecond = _waveformData.Length / _duration;
        var startIndex = (int)(startTime * samplesPerSecond);
        var endIndex = (int)(endTime * samplesPerSecond);
        var visibleSamples = endIndex - startIndex;

        if (visibleSamples <= 0) return;

        // Calculate bar width - use smaller bars for smoother appearance
        var pixelsPerSecond = canvasWidth / VisibleTimeWindow;
        var barWidth = Math.Max(0.3, pixelsPerSecond / samplesPerSecond * VisibleTimeWindow * 0.8); // Smaller bars with gap

        var centerY = canvasHeight / 2;

        // Render visible waveform bars
        for (int i = 0; i < visibleSamples && i + startIndex < _waveformData.Length; i++)
        {
            var sampleIndex = startIndex + i;
            var amplitude = _waveformData[sampleIndex];
            var barHeightPixels = amplitude * centerY * BarHeight;

            // Create bar rectangle
            var bar = new Rectangle
            {
                Width = Math.Max(0.5, barWidth - 0.2), // Smaller gap between bars for smoother look
                Height = Math.Max(1, barHeightPixels),
                Fill = new SolidColorBrush((Color)ColorConverter.ConvertFromString(WaveColor)),
                RadiusX = 0.3,
                RadiusY = 0.3
            };

            // Position the bar - map sample position to canvas position
            var sampleTime = (double)sampleIndex / samplesPerSecond;
            var relativeTime = sampleTime - _currentPosition - TimingOffset; // Apply timing offset to compensate for analysis differences
            var xPosition = (relativeTime / VisibleTimeWindow) * canvasWidth + (canvasWidth / 2); // Offset by center

            Canvas.SetLeft(bar, xPosition);
            Canvas.SetTop(bar, centerY - barHeightPixels / 2);

            WaveformCanvas.Children.Add(bar);
            _waveformBars.Add(bar);
        }

        if (Math.Abs(_currentPosition - _lastRenderedPosition) > 1.0) // Only log every second
        {
            Console.WriteLine($"[AudioDisplayWindow] Rendered {_waveformBars.Count} bars for time {startTime:F1}s - {endTime:F1}s (pos: {_currentPosition:F2}s)");
        }
    }

    private void UpdateProgressIndicator()
    {
        var canvasWidth = WaveformCanvas.ActualWidth > 0 ? WaveformCanvas.ActualWidth : Width;
        var canvasHeight = WaveformCanvas.ActualHeight > 0 ? WaveformCanvas.ActualHeight : Height;

        // Progress line is always at the center of the view since current position is centered
        var progressX = canvasWidth / 2;

        ProgressLine.X1 = progressX;
        ProgressLine.X2 = progressX;
        ProgressLine.Y1 = 0;
        ProgressLine.Y2 = canvasHeight;

        // Ensure progress line is always on top by removing and re-adding it
        if (WaveformCanvas.Children.Contains(ProgressLine))
        {
            WaveformCanvas.Children.Remove(ProgressLine);
        }
        WaveformCanvas.Children.Add(ProgressLine); // This puts it on top

        ProgressLine.Visibility = Visibility.Visible; // Always visible

        // Re-render waveform more frequently for smooth scrolling (60fps) when data is available
        if (_waveformData.Length > 0 && _duration > 0 && Math.Abs(_currentPosition - _lastRenderedPosition) > 0.016) // ~60fps threshold
        {
            RenderWaveform();
            _lastRenderedPosition = _currentPosition;
        }
    }

    private void ClearWaveform()
    {
        // Remove only waveform bars, keep progress line
        foreach (var bar in _waveformBars)
        {
            WaveformCanvas.Children.Remove(bar);
        }
        _waveformBars.Clear();
        // Keep progress line visible at all times
    }

    private void ShowLoading(bool show)
    {
        LoadingText.Visibility = show ? Visibility.Visible : Visibility.Hidden;
    }

    protected override void OnRenderSizeChanged(SizeChangedInfo sizeInfo)
    {
        base.OnRenderSizeChanged(sizeInfo);

        // Re-render waveform when window is resized (if data available)
        if (_waveformData.Length > 0)
        {
            RenderWaveform();
        }

        // Always update progress indicator position when window is resized
        UpdateProgressIndicator();
    }

    protected override void OnClosed(EventArgs e)
    {
        _renderTimer?.Stop();
        _httpClient?.Dispose();
        base.OnClosed(e);
    }
}
