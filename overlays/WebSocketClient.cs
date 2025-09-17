using System.Net.WebSockets;
using System.Reactive.Subjects;
using System.Reactive.Linq;
using System.Text;
using System.Text.Json;
using DrumStreamOverlays.Messages;

namespace DrumStreamOverlays;

public class WebSocketClient : IDisposable
{
    private readonly ClientWebSocket _webSocket;
    private readonly CancellationTokenSource _cancellationTokenSource;
    private readonly Subject<object> _messageSubject;
    private readonly Uri _serverUri;
    private bool _disposed = false;

    public IObservable<object> Messages => _messageSubject.AsObservable();
    public bool IsConnected => _webSocket.State == WebSocketState.Open;

    public WebSocketClient(string serverUrl = "ws://127.0.0.1:3000")
    {
        _webSocket = new ClientWebSocket();
        _cancellationTokenSource = new CancellationTokenSource();
        _messageSubject = new Subject<object>();
        _serverUri = new Uri(serverUrl);
    }

    public async Task ConnectAsync()
    {
        try
        {
            await _webSocket.ConnectAsync(_serverUri, _cancellationTokenSource.Token);
            _ = Task.Run(ListenForMessages, _cancellationTokenSource.Token);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"WebSocket connection failed: {ex.Message}");
            throw;
        }
    }

    private async Task ListenForMessages()
    {
        var buffer = new byte[4096];

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
                    await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "", _cancellationTokenSource.Token);
                    break;
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Expected when cancellation is requested
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error listening for WebSocket messages: {ex.Message}");
            _messageSubject.OnError(ex);
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

    public async Task DisconnectAsync()
    {
        if (_webSocket.State == WebSocketState.Open)
        {
            await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "", _cancellationTokenSource.Token);
        }
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _cancellationTokenSource.Cancel();
            _webSocket?.Dispose();
            _cancellationTokenSource?.Dispose();
            _messageSubject?.Dispose();
            _disposed = true;
        }
    }
}
