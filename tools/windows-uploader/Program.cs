using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Win32;

namespace RealityManualUploader;

internal static class Program
{
    internal const string BaseUrl = "https://ops.realitymanual.com";
    internal static readonly string AppDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RealityManualUploader");
    internal static readonly string InstalledExe = Path.Combine(AppDir, "RealityManualUploader.exe");
    internal static readonly string ConfigPath = Path.Combine(AppDir, "config.json");
    internal static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true, WriteIndented = true };

    [STAThread]
    private static void Main(string[] args)
    {
        Directory.CreateDirectory(AppDir);
        if (!args.Contains("--installed") && !PathsEqual(Environment.ProcessPath, InstalledExe))
        {
            try
            {
                File.Copy(Environment.ProcessPath!, InstalledExe, true);
                Process.Start(new ProcessStartInfo(InstalledExe, "--installed") { UseShellExecute = true });
                return;
            }
            catch (Exception error)
            {
                MessageBox.Show("The uploader could not install itself:\n\n" + error.Message, "Reality Manual Uploader", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
        }

        using var mutex = new Mutex(true, "Local\\RealityManualUploader", out var firstInstance);
        if (!firstInstance) return;
        ApplicationConfiguration.Initialize();
        Application.Run(new UploaderContext());
    }

    private static bool PathsEqual(string? a, string? b) => string.Equals(Path.GetFullPath(a ?? ""), Path.GetFullPath(b ?? ""), StringComparison.OrdinalIgnoreCase);
}

internal sealed class AppConfig
{
    public string Token { get; set; } = "";
    // Retained for backwards-compatible deserialization of v1 config files.
    public string WatchFolder { get; set; } = "";
    public string VerticalFolder { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyVideos), "Reality Manual", "Vertical");
    public string HorizontalFolder { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyVideos), "Reality Manual", "Horizontal");
    public int FolderConfigurationVersion { get; set; }
    public List<UploadItem> Items { get; set; } = new();

    public static AppConfig Load()
    {
        try { return JsonSerializer.Deserialize<AppConfig>(File.ReadAllText(Program.ConfigPath), Program.JsonOptions) ?? new(); }
        catch { return new(); }
    }

    public void Save()
    {
        Directory.CreateDirectory(Program.AppDir);
        var temp = Program.ConfigPath + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(this, Program.JsonOptions));
        File.Move(temp, Program.ConfigPath, true);
    }

    public IEnumerable<string> WatchFolders() => new[] { VerticalFolder, HorizontalFolder }
        .Where(x => !string.IsNullOrWhiteSpace(x))
        .Select(Path.GetFullPath)
        .Distinct(StringComparer.OrdinalIgnoreCase);
}

internal sealed class UploadItem
{
    public string Path { get; set; } = "";
    public long Size { get; set; }
    public long LastWriteUtcTicks { get; set; }
    public string UploadId { get; set; } = "";
    public long ReceivedBytes { get; set; }
    public bool Complete { get; set; }
}

internal sealed class PairResponse
{
    public string Token { get; set; } = "";
}

internal sealed class UploadSession
{
    public string Id { get; set; } = "";
    public int ChunkSize { get; set; } = 16 * 1024 * 1024;
    public long ReceivedBytes { get; set; }
    public int NextChunkIndex { get; set; }
}

internal sealed class UploaderContext : ApplicationContext
{
    private readonly AppConfig config = AppConfig.Load();
    private readonly HttpClient http = new() { BaseAddress = new Uri(Program.BaseUrl), Timeout = TimeSpan.FromMinutes(20) };
    private readonly NotifyIcon tray;
    private readonly ShutdownWindow shutdownWindow;
    private readonly System.Windows.Forms.Timer scanTimer;
    private readonly Dictionary<string, (long Size, DateTime Seen)> stability = new(StringComparer.OrdinalIgnoreCase);
    private readonly SynchronizationContext uiContext;
    private readonly List<FileSystemWatcher> watchers = new();
    private bool processing;
    private bool uploadActive;
    private string status = "Starting…";

    public UploaderContext()
    {
        uiContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        shutdownWindow = new ShutdownWindow(() => uploadActive);
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open Editor", null, (_, _) => OpenEditor());
        menu.Items.Add("Settings", null, (_, _) => ShowSetup());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitRequested());
        tray = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "Reality Manual Uploader",
            Visible = true,
            ContextMenuStrip = menu
        };
        tray.DoubleClick += (_, _) => OpenEditor();
        scanTimer = new System.Windows.Forms.Timer { Interval = 10_000 };
        scanTimer.Tick += async (_, _) => await ScanAndProcess();
        if (string.IsNullOrWhiteSpace(config.Token) || config.FolderConfigurationVersion < 2) ShowSetup();
        else StartWatching();
    }

    private void ShowSetup()
    {
        using var form = new SetupForm(config);
        if (form.ShowDialog() == DialogResult.OK) StartWatching();
        else if (string.IsNullOrWhiteSpace(config.Token)) ExitThread();
    }

    private void StartWatching()
    {
        var folders = config.WatchFolders().ToList();
        foreach (var folder in folders) Directory.CreateDirectory(folder);
        using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
            key.SetValue("Reality Manual Uploader", '"' + Program.InstalledExe + '"');
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.Token);
        watchers.ForEach(x => x.Dispose());
        watchers.Clear();
        foreach (var folder in folders)
        {
            var watcher = new FileSystemWatcher(folder) { IncludeSubdirectories = false, EnableRaisingEvents = true };
            watcher.Created += (_, _) => BeginScanSoon();
            watcher.Changed += (_, _) => BeginScanSoon();
            watchers.Add(watcher);
        }
        scanTimer.Start();
        status = "Watching vertical + horizontal";
        UpdateTray();
        _ = ScanAndProcess();
    }

    private void BeginScanSoon()
    {
        uiContext.Post(_ => { if (scanTimer.Enabled) { scanTimer.Stop(); scanTimer.Interval = 3000; scanTimer.Start(); } }, null);
    }

    private async Task ScanAndProcess()
    {
        if (processing || string.IsNullOrWhiteSpace(config.Token)) return;
        processing = true;
        try
        {
            var extensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".mp4", ".mkv", ".mov", ".m4v", ".webm", ".avi" };
            var recordingPaths = config.WatchFolders()
                .SelectMany(folder => Directory.EnumerateFiles(folder))
                .Where(p => extensions.Contains(Path.GetExtension(p)))
                .Distinct(StringComparer.OrdinalIgnoreCase);
            foreach (var path in recordingPaths)
            {
                FileInfo info;
                try { info = new FileInfo(path); } catch { continue; }
                var existing = config.Items.FirstOrDefault(x => string.Equals(x.Path, path, StringComparison.OrdinalIgnoreCase) && x.Size == info.Length && x.LastWriteUtcTicks == info.LastWriteTimeUtc.Ticks);
                if (existing != null) continue;
                if (!stability.TryGetValue(path, out var observed) || observed.Size != info.Length)
                {
                    stability[path] = (info.Length, DateTime.UtcNow);
                    continue;
                }
                if (DateTime.UtcNow - observed.Seen < TimeSpan.FromSeconds(12) || !CanOpenExclusively(path)) continue;
                config.Items.RemoveAll(x => string.Equals(x.Path, path, StringComparison.OrdinalIgnoreCase) && !x.Complete);
                config.Items.Add(new UploadItem { Path = path, Size = info.Length, LastWriteUtcTicks = info.LastWriteTimeUtc.Ticks });
                config.Save();
            }

            foreach (var item in config.Items.Where(x => !x.Complete).ToList())
            {
                if (!File.Exists(item.Path)) continue;
                await Upload(item);
            }
            status = "Watching · " + config.Items.Count(x => !x.Complete) + " queued";
            await Heartbeat("watching", "", 0);
        }
        catch (Exception error)
        {
            status = "Waiting to retry · " + error.Message;
            await Heartbeat("error", "", 0);
        }
        finally
        {
            processing = false;
            scanTimer.Interval = 10_000;
            UpdateTray();
        }
    }

    private async Task Upload(UploadItem item)
    {
        uploadActive = true;
        shutdownWindow.SetBlocking(true);
        NativeMethods.SetThreadExecutionState(NativeMethods.ES_CONTINUOUS | NativeMethods.ES_SYSTEM_REQUIRED);
        try
        {
            UploadSession? session = null;
            if (!string.IsNullOrWhiteSpace(item.UploadId))
            {
                using var check = await http.GetAsync("/api/editor/uploads/" + Uri.EscapeDataString(item.UploadId));
                if (check.IsSuccessStatusCode) session = await check.Content.ReadFromJsonAsync<UploadSession>(Program.JsonOptions);
                else if (check.StatusCode == HttpStatusCode.Unauthorized) throw new InvalidOperationException("Laptop pairing was revoked. Open Settings and pair again.");
                else { item.UploadId = ""; item.ReceivedBytes = 0; config.Save(); }
            }
            if (session == null)
            {
                var body = new { fileName = Path.GetFileName(item.Path), mimeType = MimeFor(item.Path), sizeBytes = item.Size, name = Path.GetFileNameWithoutExtension(item.Path) };
                using var response = await http.PostAsJsonAsync("/api/editor/uploads", body);
                await EnsureSuccess(response);
                session = await response.Content.ReadFromJsonAsync<UploadSession>(Program.JsonOptions) ?? throw new InvalidOperationException("Upload did not start.");
                item.UploadId = session.Id;
                item.ReceivedBytes = session.ReceivedBytes;
                config.Save();
            }
            item.ReceivedBytes = session.ReceivedBytes;
            var chunkSize = session.ChunkSize > 0 ? session.ChunkSize : 16 * 1024 * 1024;
            await using var stream = new FileStream(item.Path, FileMode.Open, FileAccess.Read, FileShare.Read, chunkSize, FileOptions.Asynchronous | FileOptions.SequentialScan);
            stream.Position = item.ReceivedBytes;
            while (item.ReceivedBytes < item.Size)
            {
                var length = (int)Math.Min(chunkSize, item.Size - item.ReceivedBytes);
                var bytes = new byte[length];
                var total = 0;
                while (total < length)
                {
                    var read = await stream.ReadAsync(bytes.AsMemory(total, length - total));
                    if (read == 0) throw new EndOfStreamException("The recording changed before upload completed.");
                    total += read;
                }
                var chunkIndex = (int)(item.ReceivedBytes / chunkSize);
                using var content = new ByteArrayContent(bytes);
                content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
                content.Headers.Add("X-Upload-Offset", item.ReceivedBytes.ToString());
                status = "Uploading " + Path.GetFileName(item.Path) + " · " + Math.Round(item.ReceivedBytes * 100d / item.Size) + "%";
                UpdateTray();
                await Heartbeat("uploading", Path.GetFileName(item.Path), item.ReceivedBytes * 100d / item.Size);
                using var response = await http.PostAsync($"/api/editor/uploads/{Uri.EscapeDataString(item.UploadId)}/chunks/{chunkIndex}", content);
                await EnsureSuccess(response);
                var progress = await response.Content.ReadFromJsonAsync<UploadSession>(Program.JsonOptions);
                item.ReceivedBytes = progress?.ReceivedBytes ?? item.ReceivedBytes + length;
                config.Save();
            }
            using (var complete = await http.PostAsJsonAsync("/api/editor/uploads/" + Uri.EscapeDataString(item.UploadId) + "/complete", new { }))
            {
                if (complete.StatusCode != HttpStatusCode.Conflict) await EnsureSuccess(complete);
            }
            item.Complete = true;
            config.Save();
            await Heartbeat("watching", "", 100);
        }
        catch (HttpRequestException) { throw; }
        finally
        {
            uploadActive = false;
            shutdownWindow.SetBlocking(false);
            NativeMethods.SetThreadExecutionState(NativeMethods.ES_CONTINUOUS);
        }
    }

    private async Task Heartbeat(string state, string file, double progress)
    {
        try
        {
            using var response = await http.PostAsJsonAsync("/api/desktop-uploader/heartbeat", new { status = state, currentFileName = file, uploadProgress = progress, queuedCount = config.Items.Count(x => !x.Complete) });
            if (response.StatusCode == HttpStatusCode.Unauthorized) throw new InvalidOperationException("Laptop pairing was revoked.");
        }
        catch { }
    }

    private static async Task EnsureSuccess(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode) return;
        var text = await response.Content.ReadAsStringAsync();
        throw new HttpRequestException($"Server returned {(int)response.StatusCode}: {text}", null, response.StatusCode);
    }

    private static bool CanOpenExclusively(string path)
    {
        try { using var _ = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None); return true; }
        catch { return false; }
    }

    private static string MimeFor(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".mov" => "video/quicktime", ".mkv" => "video/x-matroska", ".webm" => "video/webm", ".avi" => "video/x-msvideo", _ => "video/mp4"
    };

    private void UpdateTray()
    {
        var text = "Reality Manual · " + status;
        tray.Text = text.Length > 63 ? text[..63] : text;
    }

    private static void OpenEditor() => Process.Start(new ProcessStartInfo(Program.BaseUrl + "/#editor") { UseShellExecute = true });

    private void ExitRequested()
    {
        if (uploadActive && MessageBox.Show("A recording is still uploading. Exiting now will pause it until the uploader starts again. Exit anyway?", "Upload in progress", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
        tray.Visible = false;
        ExitThread();
    }

    protected override void ExitThreadCore()
    {
        scanTimer.Stop(); watchers.ForEach(x => x.Dispose()); watchers.Clear(); tray.Dispose(); shutdownWindow.Dispose(); http.Dispose();
        base.ExitThreadCore();
    }
}

internal sealed class SetupForm : Form
{
    private readonly AppConfig config;
    private readonly TextBox verticalFolder = new() { Dock = DockStyle.Fill };
    private readonly TextBox horizontalFolder = new() { Dock = DockStyle.Fill };
    private readonly TextBox code = new() { Dock = DockStyle.Fill, CharacterCasing = CharacterCasing.Upper, MaxLength = 12 };
    private readonly Label message = new() { AutoSize = true, ForeColor = Color.DimGray };
    private readonly Button pair = new() { Text = "Pair and start", AutoSize = true };

    public SetupForm(AppConfig config)
    {
        this.config = config;
        Text = "Reality Manual Uploader"; Width = 660; Height = 405; StartPosition = FormStartPosition.CenterScreen; MaximizeBox = false;
        verticalFolder.Text = config.VerticalFolder;
        horizontalFolder.Text = config.HorizontalFolder;
        var browseVertical = new Button { Text = "Browse…", AutoSize = true };
        browseVertical.Click += (_, _) => ChooseFolder(verticalFolder);
        var browseHorizontal = new Button { Text = "Browse…", AutoSize = true };
        browseHorizontal.Click += (_, _) => ChooseFolder(horizontalFolder);
        if (!string.IsNullOrWhiteSpace(config.Token)) pair.Text = "Save and start";
        pair.Click += async (_, _) => await Pair();
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(20), ColumnCount = 2, RowCount = 11 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var heading = new Label { Text = "Automatic OBS upload", Font = new Font(Font, FontStyle.Bold), AutoSize = true };
        var info = new Label { Text = "Choose the two folders used by your Vertical and Horizontal OBS profiles. The uploader watches both and sends every completed recording into Editor; it does not alter your OBS profiles.", AutoSize = true, MaximumSize = new Size(590, 0) };
        var verticalLabel = new Label { Text = "Vertical recordings folder", AutoSize = true };
        var horizontalLabel = new Label { Text = "Horizontal recordings folder", AutoSize = true };
        var codeLabel = new Label { Text = string.IsNullOrWhiteSpace(config.Token) ? "One-time code from Content Settings" : "New pairing code (leave blank to keep this laptop paired)", AutoSize = true };
        layout.Controls.Add(heading, 0, 0); layout.SetColumnSpan(heading, 2);
        layout.Controls.Add(info, 0, 1); layout.SetColumnSpan(info, 2);
        layout.Controls.Add(verticalLabel, 0, 2); layout.SetColumnSpan(verticalLabel, 2);
        layout.Controls.Add(verticalFolder, 0, 3); layout.Controls.Add(browseVertical, 1, 3);
        layout.Controls.Add(horizontalLabel, 0, 4); layout.SetColumnSpan(horizontalLabel, 2);
        layout.Controls.Add(horizontalFolder, 0, 5); layout.Controls.Add(browseHorizontal, 1, 5);
        layout.Controls.Add(codeLabel, 0, 6); layout.SetColumnSpan(codeLabel, 2);
        layout.Controls.Add(code, 0, 7); layout.Controls.Add(pair, 1, 7);
        layout.Controls.Add(message, 0, 8); layout.SetColumnSpan(message, 2);
        Controls.Add(layout);
    }

    private static void ChooseFolder(TextBox target)
    {
        using var dialog = new FolderBrowserDialog { InitialDirectory = target.Text };
        if (dialog.ShowDialog() == DialogResult.OK) target.Text = dialog.SelectedPath;
    }

    private async Task Pair()
    {
        if (string.IsNullOrWhiteSpace(verticalFolder.Text) || string.IsNullOrWhiteSpace(horizontalFolder.Text)) { message.Text = "Choose both recording folders."; return; }
        if (string.IsNullOrWhiteSpace(config.Token) && string.IsNullOrWhiteSpace(code.Text)) { message.Text = "Enter the pairing code from Content Settings."; return; }
        pair.Enabled = false; message.Text = string.IsNullOrWhiteSpace(code.Text) ? "Saving…" : "Pairing…";
        try
        {
            var vertical = Path.GetFullPath(verticalFolder.Text.Trim());
            var horizontal = Path.GetFullPath(horizontalFolder.Text.Trim());
            if (string.Equals(vertical, horizontal, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Choose a different folder for each OBS profile.");
            if (!string.IsNullOrWhiteSpace(code.Text))
            {
                using var client = new HttpClient { BaseAddress = new Uri(Program.BaseUrl), Timeout = TimeSpan.FromSeconds(30) };
                using var response = await client.PostAsJsonAsync("/api/desktop-uploader/pair", new { code = code.Text, deviceName = Environment.MachineName });
                if (!response.IsSuccessStatusCode) throw new InvalidOperationException("The code is invalid or expired. Generate a new one in Content Settings.");
                var result = await response.Content.ReadFromJsonAsync<PairResponse>(Program.JsonOptions) ?? throw new InvalidOperationException("Pairing returned no device token.");
                config.Token = result.Token;
            }
            config.VerticalFolder = vertical;
            config.HorizontalFolder = horizontal;
            config.FolderConfigurationVersion = 2;
            config.Save();
            DialogResult = DialogResult.OK; Close();
        }
        catch (Exception error) { message.Text = error.Message; pair.Enabled = true; }
    }
}

internal sealed class ShutdownWindow : NativeWindow, IDisposable
{
    private readonly Func<bool> isUploading;
    public ShutdownWindow(Func<bool> isUploading) { this.isUploading = isUploading; CreateHandle(new CreateParams { Caption = "Reality Manual Uploader" }); }
    public void SetBlocking(bool block)
    {
        if (Handle == IntPtr.Zero) return;
        if (block) NativeMethods.ShutdownBlockReasonCreate(Handle, "A Reality Manual video is still uploading. Please wait for it to finish.");
        else NativeMethods.ShutdownBlockReasonDestroy(Handle);
    }
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x0011 && isUploading()) { SetBlocking(true); m.Result = IntPtr.Zero; return; }
        base.WndProc(ref m);
    }
    public void Dispose() { SetBlocking(false); DestroyHandle(); }
}

internal static class NativeMethods
{
    internal const uint ES_SYSTEM_REQUIRED = 0x00000001;
    internal const uint ES_CONTINUOUS = 0x80000000;
    [DllImport("kernel32.dll")] internal static extern uint SetThreadExecutionState(uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool ShutdownBlockReasonCreate(IntPtr hwnd, string reason);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool ShutdownBlockReasonDestroy(IntPtr hwnd);
}
