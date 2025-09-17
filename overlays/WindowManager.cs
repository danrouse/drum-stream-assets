using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows;

namespace DrumStreamOverlays;

public class WindowManager : INotifyPropertyChanged
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

    private readonly Dictionary<string, IOverlayWindow?> _managedWindows = new();
    private readonly Dictionary<string, WindowDefinition> _windowDefinitions = new();
    private readonly WebSocketClient _webSocketClient;
    private readonly WindowSettings _settings;

    public event PropertyChangedEventHandler? PropertyChanged;
    public event EventHandler<WindowStateChangedEventArgs>? WindowStateChanged;

    public ObservableCollection<WindowStatus> WindowStatuses { get; } = new();

    public WindowManager(WebSocketClient webSocketClient)
    {
        _webSocketClient = webSocketClient;
        _settings = SettingsManager.LoadSettings();

        RegisterWindowDefinitions();
        InitializeWindowStatuses();

        // Subscribe to messages after everything else is initialized
        _webSocketClient.Messages.Subscribe(OnWebSocketMessage);
    }

    private void RegisterWindowDefinitions()
    {
        var definitions = new[]
        {
            // Only implemented windows for now
            new WindowDefinition
            {
                Key = "synced-lyrics",
                DisplayName = "Synced Lyrics",
                WindowType = typeof(SyncedLyricsWindow),
                Width = 640,
                Height = 400
            }

            // TODO: Uncomment as windows are implemented
            /*
            new WindowDefinition
            {
                Key = "midi-ride",
                DisplayName = "MIDI Notes (Ride)",
                WindowType = typeof(MidiNotesWindow),
                Width = 1920,
                Height = 1080,
                Parameter = "d7f1f1d39ab23b254ab99defdb308bb89e7039d032b6a6626d344eb392ef4528"
            },
            new WindowDefinition
            {
                Key = "midi-overhead",
                DisplayName = "MIDI Notes (Overhead)",
                WindowType = typeof(MidiNotesWindow),
                Width = 1920,
                Height = 1080,
                Parameter = "062081be9db82c7128351e1b1d673bee186043945ad393c63e876a200e1d59d9"
            },
            new WindowDefinition
            {
                Key = "now-playing",
                DisplayName = "Now Playing",
                WindowType = typeof(NowPlayingWindow),
                Width = 1640,
                Height = 160
            },
            new WindowDefinition
            {
                Key = "audio-display",
                DisplayName = "Audio Display",
                WindowType = typeof(AudioDisplayWindow),
                Width = 1920,
                Height = 100
            },
            new WindowDefinition
            {
                Key = "song-history",
                DisplayName = "Song History",
                WindowType = typeof(SongHistoryWindow),
                Width = 400,
                Height = 270
            },
            new WindowDefinition
            {
                Key = "drum-triggers",
                DisplayName = "Drum Triggers",
                WindowType = typeof(DrumTriggersWindow),
                Width = 128,
                Height = 128
            },
            new WindowDefinition
            {
                Key = "guess-the-song",
                DisplayName = "Guess The Song",
                WindowType = typeof(GuessTheSongWindow),
                Width = 1920,
                Height = 1080
            },
            new WindowDefinition
            {
                Key = "heart-rate",
                DisplayName = "Heart Rate",
                WindowType = typeof(HeartRateWindow),
                Width = 300,
                Height = 100
            },
            new WindowDefinition
            {
                Key = "gamba",
                DisplayName = "GAMBA",
                WindowType = typeof(GambaWindow),
                Width = 260,
                Height = 160,
                DefaultIncludeInOpenAll = false
            },
            new WindowDefinition
            {
                Key = "wheel",
                DisplayName = "Wheel",
                WindowType = typeof(WheelWindow),
                Width = 1920,
                Height = 1080
            }
            */
        };

        foreach (var definition in definitions)
        {
            _windowDefinitions[definition.Key] = definition;
            _managedWindows[definition.Key] = null;
        }
    }

    private void InitializeWindowStatuses()
    {
        foreach (var definition in _windowDefinitions.Values)
        {
            var includeInOpenAll = _settings.IncludeInOpenAll.TryGetValue(definition.Key, out var savedValue)
                ? savedValue
                : definition.DefaultIncludeInOpenAll;

            var windowStatus = new WindowStatus
            {
                WindowKey = definition.Key,
                DisplayName = definition.DisplayName,
                IsOpen = false,
                IncludeInOpenAll = includeInOpenAll
            };

            windowStatus.PropertyChanged += OnWindowStatusPropertyChanged;
            WindowStatuses.Add(windowStatus);
        }
    }

    private void OnWindowStatusPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (sender is WindowStatus windowStatus && e.PropertyName == nameof(WindowStatus.IncludeInOpenAll))
        {
            _settings.IncludeInOpenAll[windowStatus.WindowKey] = windowStatus.IncludeInOpenAll;
            SettingsManager.SaveSettings(_settings);
        }
    }

    public void OpenWindow(string windowKey)
    {
        if (!_windowDefinitions.TryGetValue(windowKey, out var definition))
            return;

        if (_managedWindows[windowKey] != null)
        {
            // Window already exists, focus it
            if (_managedWindows[windowKey] is Window existingWindow)
            {
                existingWindow.Focus();
            }
            return;
        }

        try
        {
            var window = CreateWindow(definition);
            if (window != null)
            {
                _managedWindows[windowKey] = window;

                // Cast to Window to access WPF properties
                if (window is Window wpfWindow)
                {
                    wpfWindow.Width = definition.Width;
                    wpfWindow.Height = definition.Height;
                    wpfWindow.Closed += (_, _) => OnWindowClosed(windowKey);
                    wpfWindow.Show();
                }

                UpdateWindowStatus(windowKey, true);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Failed to open window '{definition.DisplayName}': {ex.Message}",
                          "Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    public void CloseWindow(string windowKey)
    {
        var window = _managedWindows[windowKey];
        if (window is Window wpfWindow)
        {
            wpfWindow.Close();
        }
    }

    public void RestartWindow(string windowKey)
    {
        CloseWindow(windowKey);
        Task.Delay(100).ContinueWith(_ => Application.Current.Dispatcher.Invoke(() => OpenWindow(windowKey)));
    }

    public void OpenAllWindows()
    {
        var windowsToOpen = WindowStatuses.Where(ws => ws.IncludeInOpenAll).Select(ws => ws.WindowKey);
        foreach (var windowKey in windowsToOpen)
        {
            OpenWindow(windowKey);
        }
    }

    public void CloseAllWindows()
    {
        foreach (var windowKey in _managedWindows.Keys.ToList())
        {
            CloseWindow(windowKey);
        }
    }

    public void RestartAllWindows()
    {
        var windowsToRestart = WindowStatuses.Where(ws => ws.IncludeInOpenAll && ws.IsOpen).Select(ws => ws.WindowKey).ToList();
        foreach (var windowKey in windowsToRestart)
        {
            RestartWindow(windowKey);
        }
    }

    private IOverlayWindow? CreateWindow(WindowDefinition definition)
    {
        if (definition.WindowType == typeof(MidiNotesWindow) && !string.IsNullOrEmpty(definition.Parameter))
        {
            return new MidiNotesWindow(definition.Parameter);
        }

        if (definition.WindowType == typeof(SyncedLyricsWindow))
        {
            return new SyncedLyricsWindow();
        }

        return Activator.CreateInstance(definition.WindowType) as IOverlayWindow;
    }

    private void OnWindowClosed(string windowKey)
    {
        _managedWindows[windowKey] = null;
        UpdateWindowStatus(windowKey, false);
    }

    private void UpdateWindowStatus(string windowKey, bool isOpen)
    {
        var status = WindowStatuses.FirstOrDefault(ws => ws.WindowKey == windowKey);
        if (status != null)
        {
            status.IsOpen = isOpen;
        }

        WindowStateChanged?.Invoke(this, new WindowStateChangedEventArgs(windowKey, isOpen));
    }

    private void OnWebSocketMessage(object message)
    {
        var messageTypeName = message.GetType().Name;

        // Only log messages that aren't in the ignore list
        if (!UnloggedMessageTypes.Contains(messageTypeName))
        {
            Console.WriteLine($"[WindowManager] Received WebSocket message: {messageTypeName}");
            Console.WriteLine($"[WindowManager] Active windows: {_managedWindows.Values.Count(w => w != null)}");
        }

        Application.Current.Dispatcher.Invoke(() =>
        {
        foreach (var window in _managedWindows.Values.Where(w => w != null))
        {
            try
            {
                // Only log message distribution for non-ignored message types
                if (!UnloggedMessageTypes.Contains(messageTypeName))
                {
                    Console.WriteLine($"[WindowManager] Sending message to window: {window?.WindowKey}");
                }
                window?.HandleWebSocketMessage(message);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[WindowManager] Error handling WebSocket message in window {window?.WindowKey}: {ex.Message}");
            }
        }
        });
    }

    protected virtual void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}

public class WindowStatus : INotifyPropertyChanged
{
    private bool _isOpen;
    private bool _includeInOpenAll;

    public string WindowKey { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;

    public bool IsOpen
    {
        get => _isOpen;
        set
        {
            if (_isOpen != value)
            {
                _isOpen = value;
                OnPropertyChanged();
            }
        }
    }

    public bool IncludeInOpenAll
    {
        get => _includeInOpenAll;
        set
        {
            if (_includeInOpenAll != value)
            {
                _includeInOpenAll = value;
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

public class WindowStateChangedEventArgs : EventArgs
{
    public string WindowKey { get; }
    public bool IsOpen { get; }

    public WindowStateChangedEventArgs(string windowKey, bool isOpen)
    {
        WindowKey = windowKey;
        IsOpen = isOpen;
    }
}
