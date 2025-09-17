using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;

namespace DrumStreamOverlays;

public partial class ManagerWindow : Window
{
    private readonly WindowManager _windowManager;
    private readonly WebSocketClient _webSocketClient;
    private int _messageCount = 0;

    public ManagerWindow()
    {
        InitializeComponent();

        // Create WebSocket client but don't connect yet
        _webSocketClient = new WebSocketClient();

        // Create window manager
        _windowManager = new WindowManager(_webSocketClient);

        DataContext = _windowManager;

        _windowManager.WindowStateChanged += OnWindowStateChanged;
        _webSocketClient.Messages.Subscribe(OnWebSocketMessage);

        Loaded += OnLoaded;
        Closing += OnClosing;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        await ConnectWebSocket();
    }

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        _windowManager.CloseAllWindows();
        _webSocketClient.Dispose();
    }

    private async Task ConnectWebSocket()
    {
        try
        {
            StatusText.Text = "Connecting to WebSocket...";
            await _webSocketClient.ConnectAsync();

            ConnectionIndicator.Fill = Brushes.Green;
            ConnectionStatus.Text = "Connected";
            StatusText.Text = "Connected to WebSocket server";
        }
        catch (Exception ex)
        {
            ConnectionIndicator.Fill = Brushes.Red;
            ConnectionStatus.Text = "Disconnected";
            StatusText.Text = $"Failed to connect: {ex.Message}";
        }
    }

    private void OnWebSocketMessage(object message)
    {
        Dispatcher.Invoke(() =>
        {
            _messageCount++;
            MessageCountText.Text = $"Messages: {_messageCount}";
        });
    }

    private void OnWindowStateChanged(object? sender, WindowStateChangedEventArgs e)
    {
        Dispatcher.Invoke(() =>
        {
            StatusText.Text = $"Window '{e.WindowKey}' {(e.IsOpen ? "opened" : "closed")}";
        });
    }

    private void OpenAllButton_Click(object sender, RoutedEventArgs e)
    {
        _windowManager.OpenAllWindows();
    }

    private void CloseAllButton_Click(object sender, RoutedEventArgs e)
    {
        _windowManager.CloseAllWindows();
    }

    private void RestartAllButton_Click(object sender, RoutedEventArgs e)
    {
        _windowManager.RestartAllWindows();
    }

    private async void ReconnectButton_Click(object sender, RoutedEventArgs e)
    {
        await _webSocketClient.DisconnectAsync();
        await ConnectWebSocket();
    }

    private void OpenWindow_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button button && button.Tag is string windowKey)
        {
            _windowManager.OpenWindow(windowKey);
        }
    }

    private void CloseWindow_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button button && button.Tag is string windowKey)
        {
            _windowManager.CloseWindow(windowKey);
        }
    }

    private void RestartWindow_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button button && button.Tag is string windowKey)
        {
            _windowManager.RestartWindow(windowKey);
        }
    }
}

// Value converters for the UI
public class BoolToStatusConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        return (bool)value ? "Open" : "Closed";
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
    {
        throw new NotImplementedException();
    }
}

public class BoolToStatusStyleConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        var isOpen = (bool)value;
        return Application.Current.FindResource(isOpen ? "StatusOpenStyle" : "StatusClosedStyle");
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
    {
        throw new NotImplementedException();
    }
}

public class InverseBooleanConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        return !(bool)value;
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
    {
        return !(bool)value;
    }
}
