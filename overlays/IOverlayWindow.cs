namespace DrumStreamOverlays;

public interface IOverlayWindow
{
    string WindowKey { get; }
    void HandleWebSocketMessage(object message);
}
