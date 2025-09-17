using System.Windows;

namespace DrumStreamOverlays;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        try
        {
            Console.WriteLine("[App] Application starting up...");

            // Set global exception handlers FIRST
            AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
            Current.DispatcherUnhandledException += OnDispatcherUnhandledException;

            Console.WriteLine("[App] Exception handlers registered");

            base.OnStartup(e);
            Console.WriteLine("[App] Application startup complete");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[App] Startup error: {ex.Message}");
            MessageBox.Show($"Startup error: {ex.Message}\n\nStack: {ex.StackTrace}",
                           "Startup Error", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    private void OnUnhandledException(object sender, UnhandledExceptionEventArgs e)
    {
        try
        {
            var exception = e.ExceptionObject as Exception;
            MessageBox.Show($"Unhandled exception: {exception?.Message}\n\nStack: {exception?.StackTrace}",
                           "Fatal Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        catch
        {
            // Last resort
            MessageBox.Show("A fatal error occurred and could not be displayed properly.",
                           "Fatal Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void OnDispatcherUnhandledException(object sender, System.Windows.Threading.DispatcherUnhandledExceptionEventArgs e)
    {
        try
        {
            MessageBox.Show($"Dispatcher exception: {e.Exception.Message}\n\nInner: {e.Exception.InnerException?.Message}\n\nStack: {e.Exception.StackTrace}",
                           "UI Error", MessageBoxButton.OK, MessageBoxImage.Error);
            e.Handled = true;
        }
        catch
        {
            e.Handled = false; // Let it crash if we can't even show the error
        }
    }
}
