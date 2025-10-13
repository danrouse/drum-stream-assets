using System.Net.WebSockets;
using System.Reactive.Subjects;
using System.Reactive.Linq;
using System.Text;
using System.Text.Json;
using DrumStreamOverlays.Messages;

namespace DrumStreamOverlays;

public class WebSocketClient : IDisposable
{
    private ClientWebSocket _webSocket;
    private readonly CancellationTokenSource _cancellationTokenSource;
    private readonly Subject<object> _messageSubject;
    private readonly Uri _serverUri;
    private readonly TimeSpan _reconnectInterval;
    private readonly int _maxReconnectAttempts;
    private bool _disposed = false;
    private bool _shouldReconnect = true;
    private int _reconnectAttempts = 0;
    private Task? _reconnectTask;

    public IObservable<object> Messages => _messageSubject.AsObservable();
    public bool IsConnected => _webSocket.State == WebSocketState.Open;

    public WebSocketClient(string serverUrl = "ws://127.0.0.1:3000", TimeSpan? reconnectInterval = null, int maxReconnectAttempts = -1)
    {
        _webSocket = new ClientWebSocket();
        _cancellationTokenSource = new CancellationTokenSource();
        _messageSubject = new Subject<object>();
        _serverUri = new Uri(serverUrl);
        _reconnectInterval = reconnectInterval ?? TimeSpan.FromSeconds(5);
        _maxReconnectAttempts = maxReconnectAttempts;
    }

    public async Task ConnectAsync()
    {
        if (_webSocket.State != WebSocketState.None)
        {
            _webSocket?.Dispose();
            _webSocket = new ClientWebSocket();
        }

        _shouldReconnect = true;

        await ConnectInternalAsync();
    }

    private async Task ConnectInternalAsync()
    {
        try
        {
            await _webSocket.ConnectAsync(_serverUri, _cancellationTokenSource.Token);
            _reconnectAttempts = 0; // Reset on successful connection
            _ = Task.Run(ListenForMessages, _cancellationTokenSource.Token);
            Console.WriteLine("WebSocket connected successfully");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"WebSocket connection failed: {ex.Message}");
            if (_shouldReconnect && !_disposed)
            {
                _ = Task.Run(StartReconnectionLoop, _cancellationTokenSource.Token);
            }
            else
            {
                throw;
            }
        }
    }

    private async Task ListenForMessages()
    {
        var buffer = new byte[1024*64];

        try
        {
            while (_webSocket.State == WebSocketState.Open && !_cancellationTokenSource.Token.IsCancellationRequested)
            {
                var result = await _webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), _cancellationTokenSource.Token);

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    var json = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    var message = ParseMessage(json);
                    if (message != null)
                    {
                        _messageSubject.OnNext(message);
                    }
                }
                else if (result.MessageType == WebSocketMessageType.Close)
                {
                    try
                    {
                        if (_webSocket.State == WebSocketState.Open || _webSocket.State == WebSocketState.CloseReceived)
                        {
                            await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Error closing WebSocket in response to close message: {ex.Message}");
                    }
                    break;
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Expected when cancellation is requested
            Console.WriteLine("WebSocket listening cancelled");
        }
        catch (WebSocketException ex)
        {
            Console.WriteLine($"WebSocket error: {ex.Message}");
            if (_shouldReconnect && !_disposed)
            {
                Console.WriteLine("Connection lost unexpectedly");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error listening for WebSocket messages: {ex.Message}");
            if (_shouldReconnect && !_disposed && !_cancellationTokenSource.Token.IsCancellationRequested)
            {
                _messageSubject.OnError(ex);
            }
        }
        finally
        {
            // If we exit the loop and should reconnect, start the reconnection process
            if (_shouldReconnect && !_disposed && !_cancellationTokenSource.Token.IsCancellationRequested)
            {
                Console.WriteLine("WebSocket connection lost, starting reconnection...");
                _ = Task.Run(StartReconnectionLoop, _cancellationTokenSource.Token);
            }
        }
    }

    private object? ParseMessage(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;

            if (!root.TryGetProperty("type", out var typeProperty))
            {
                return null;
            }

            var messageType = typeProperty.GetString();

            return messageType switch
            {
                "song_request_added" => JsonSerializer.Deserialize<SongRequestAddedMessage>(json),
                "song_request_removed" => JsonSerializer.Deserialize<SongRequestRemovedMessage>(json),
                "song_request_moved" => JsonSerializer.Deserialize<SongRequestMovedMessage>(json),
                "song_request" => JsonSerializer.Deserialize<SongRequestMessage>(json),
                "client_remote_control" => JsonSerializer.Deserialize<ClientRemoteControlMessage>(json),
                "emote_used" => JsonSerializer.Deserialize<EmoteUsedMessage>(json),
                "emote_default_set" => JsonSerializer.Deserialize<EmoteDefaultSetMessage>(json),
                "emote_pinned" => JsonSerializer.Deserialize<EmotePinnedMessage>(json),
                "midi_note_on" => JsonSerializer.Deserialize<MidiNoteOnMessage>(json),
                "viewers_update" => JsonSerializer.Deserialize<ViewersUpdateMessage>(json),
                "obs_scene_changed" => JsonSerializer.Deserialize<ObsSceneChangedMessage>(json),
                "chat_message" => JsonSerializer.Deserialize<ChatMessageMessage>(json),
                "guess_the_song_scores" => JsonSerializer.Deserialize<GuessTheSongScoresMessage>(json),
                "gamba_started" => JsonSerializer.Deserialize<GambaStartedMessage>(json),
                "gamba_progress" => JsonSerializer.Deserialize<GambaProgressMessage>(json),
                "gamba_complete" => JsonSerializer.Deserialize<GambaCompleteMessage>(json),
                "wheel_toggle_visibility" => JsonSerializer.Deserialize<WheelToggleVisibilityMessage>(json),
                "wheel_spin" => JsonSerializer.Deserialize<WheelSpinMessage>(json),
                "wheel_selection" => JsonSerializer.Deserialize<WheelSelectionMessage>(json),
                "song_changed" => JsonSerializer.Deserialize<SongChangedMessage>(json),
                "song_progress" => JsonSerializer.Deserialize<SongProgressMessage>(json),
                "song_played" => JsonSerializer.Deserialize<SongPlayedMessage>(json),
                "song_playpack_paused" => JsonSerializer.Deserialize<SongPlaybackPausedMessage>(json),
                "song_stopped" => JsonSerializer.Deserialize<SongStoppedMessage>(json),
                "song_speed" => JsonSerializer.Deserialize<SongSpeedMessage>(json),
                "song_playback_started" => JsonSerializer.Deserialize<SongPlaybackStartedMessage>(json),
                "song_playback_completed" => JsonSerializer.Deserialize<SongPlaybackCompletedMessage>(json),
                "guess_the_song_round_complete" => JsonSerializer.Deserialize<GuessTheSongRoundCompleteMessage>(json),
                _ => null
            };
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error parsing WebSocket message: {ex.Message}");
            return null;
        }
    }

    public async Task SendMessageAsync(object message)
    {
        if (_webSocket.State != WebSocketState.Open)
        {
            throw new InvalidOperationException("WebSocket is not connected");
        }

        var json = JsonSerializer.Serialize(message);
        var bytes = Encoding.UTF8.GetBytes(json);
        await _webSocket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, _cancellationTokenSource.Token);
    }

    private async Task StartReconnectionLoop()
    {
        // Prevent multiple reconnection loops from running
        if (_reconnectTask != null && !_reconnectTask.IsCompleted)
        {
            return;
        }

        _reconnectTask = Task.Run(async () =>
        {
            while (_shouldReconnect && !_disposed && !_cancellationTokenSource.Token.IsCancellationRequested)
            {
                // Check if we've exceeded max reconnection attempts
                if (_maxReconnectAttempts > 0 && _reconnectAttempts >= _maxReconnectAttempts)
                {
                    Console.WriteLine($"Max reconnection attempts ({_maxReconnectAttempts}) reached. Stopping reconnection.");
                    break;
                }

                _reconnectAttempts++;
                Console.WriteLine($"Attempting to reconnect... (Attempt {_reconnectAttempts})");

                try
                {
                    await Task.Delay(_reconnectInterval, _cancellationTokenSource.Token);

                    if (!_disposed && _shouldReconnect)
                    {
                        // Create a new WebSocket instance for reconnection
                        _webSocket?.Dispose();
                        _webSocket = new ClientWebSocket();

                        await ConnectInternalAsync();
                        break; // Exit the reconnection loop if connection succeeds
                    }
                }
                catch (OperationCanceledException)
                {
                    // Expected when cancellation is requested
                    break;
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Reconnection attempt failed: {ex.Message}");
                }
            }
        });
    }

    public async Task DisconnectAsync()
    {
        _shouldReconnect = false; // Stop reconnection attempts

        try
        {
            if (_webSocket.State == WebSocketState.Open || _webSocket.State == WebSocketState.CloseReceived)
            {
                await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
            }
            else if (_webSocket.State == WebSocketState.Connecting)
            {
                _webSocket.Abort();
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error during WebSocket disconnect: {ex.Message}");
            try
            {
                _webSocket?.Dispose();
            }
            catch {}
        }

        // Wait for reconnection task to complete if it's running
        if (_reconnectTask != null)
        {
            try
            {
                await _reconnectTask;
            }
            catch (OperationCanceledException) {}
            catch (Exception ex)
            {
                Console.WriteLine($"Error waiting for reconnection task: {ex.Message}");
            }
        }
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _shouldReconnect = false; // Stop reconnection attempts
            _cancellationTokenSource.Cancel();

            // Wait for reconnection task to complete if it's running
            if (_reconnectTask != null)
            {
                try
                {
                    _reconnectTask.Wait(TimeSpan.FromSeconds(5)); // Wait up to 5 seconds
                }
                catch (AggregateException)
                {
                    // Expected when cancellation is requested
                }
            }

            _webSocket?.Dispose();
            _cancellationTokenSource?.Dispose();
            _messageSubject?.Dispose();
            _disposed = true;
        }
    }
}
