namespace DrumStreamOverlays;

public class WindowDefinition
{
    public string Key { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public Type WindowType { get; set; } = typeof(BaseOverlayWindow);
    public int Width { get; set; }
    public int Height { get; set; }
    public bool DefaultIncludeInOpenAll { get; set; } = true;
    public string? Parameter { get; set; } // For windows that need special parameters like MIDI windows
}
