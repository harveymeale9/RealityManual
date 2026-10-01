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
    public string WatchFolder { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyVideos), "Reality Manual");
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
    private FileSystemWatcher? watcher;
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
        if (string.IsNullOrWhiteSpace(config.Token)) ShowSetup();
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
        Directory.CreateDirectory(config.WatchFolder);
        ConfigureObsProfile(config.WatchFolder);
        using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
            key.SetValue("Reality Manual Uploader", '"' + Program.InstalledExe + '"');
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.Token);
        watcher?.Dispose();
        watcher = new FileSystemWatcher(config.WatchFolder) { IncludeSubdirectories = false, EnableRaisingEvents = true };
        watcher.Created += (_, _) => BeginScanSoon();
        watcher.Changed += (_, _) => BeginScanSoon();
        scanTimer.Start();
        status = "Watching " + config.WatchFolder;
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
            foreach (var path in Directory.EnumerateFiles(config.WatchFolder).Where(p => extensions.Contains(Path.GetExtension(p))))
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
        scanTimer.Stop(); watcher?.Dispose(); tray.Dispose(); shutdownWindow.Dispose(); http.Dispose();
        base.ExitThreadCore();
    }

    private static void ConfigureObsProfile(string outputFolder)
    {
        try
        {
            var profilesRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "obs-studio", "basic", "profiles");
            if (!Directory.Exists(profilesRoot)) return;
            var target = Path.Combine(profilesRoot, "Reality Manual");
            if (!Directory.Exists(target))
            {
                var obsRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "obs-studio");
                var globalText = File.Exists(Path.Combine(obsRoot, "global.ini")) ? File.ReadAllText(Path.Combine(obsRoot, "global.ini")) : "";
                var activeProfileDir = Ini.Get(globalText, "Basic", "ProfileDir");
                var source = !string.IsNullOrWhiteSpace(activeProfileDir) && Directory.Exists(Path.Combine(profilesRoot, activeProfileDir))
                    ? Path.Combine(profilesRoot, activeProfileDir)
                    : Directory.EnumerateDirectories(profilesRoot).FirstOrDefault();
                Directory.CreateDirectory(target);
                if (source != null) foreach (var file in Directory.EnumerateFiles(source)) File.Copy(file, Path.Combine(target, Path.GetFileName(file)), true);
            }
            var ini = Path.Combine(target, "basic.ini");
            var text = File.Exists(ini) ? File.ReadAllText(ini) : "";
            text = Ini.Set(text, "General", "Name", "Reality Manual");
            text = Ini.Set(text, "SimpleOutput", "FilePath", outputFolder.Replace("\\", "/"));
            text = Ini.Set(text, "AdvOut", "RecFilePath", outputFolder.Replace("\\", "/"));
            File.WriteAllText(ini, text);
        }
        catch { }
    }
}

internal sealed class SetupForm : Form
{
    private readonly AppConfig config;
    private readonly TextBox folder = new() { Dock = DockStyle.Fill };
    private readonly TextBox code = new() { Dock = DockStyle.Fill, CharacterCasing = CharacterCasing.Upper, MaxLength = 12 };
    private readonly Label message = new() { AutoSize = true, ForeColor = Color.DimGray };
    private readonly Button pair = new() { Text = "Pair and start", AutoSize = true };

    public SetupForm(AppConfig config)
    {
        this.config = config;
        Text = "Reality Manual Uploader"; Width = 610; Height = 310; StartPosition = FormStartPosition.CenterScreen; MaximizeBox = false;
        folder.Text = config.WatchFolder;
        var browse = new Button { Text = "Browse…", AutoSize = true };
        browse.Click += (_, _) => { using var dialog = new FolderBrowserDialog { InitialDirectory = folder.Text }; if (dialog.ShowDialog() == DialogResult.OK) folder.Text = dialog.SelectedPath; };
        pair.Click += async (_, _) => await Pair();
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(20), ColumnCount = 2, RowCount = 7 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var heading = new Label { Text = "Automatic OBS upload", Font = new Font(Font, FontStyle.Bold), AutoSize = true };
        var info = new Label { Text = "This creates an OBS profile named Reality Manual, points it at the folder below, and uploads completed recordings into Editor. Close and reopen OBS once after setup.", AutoSize = true, MaximumSize = new Size(540, 0) };
        layout.Controls.Add(heading, 0, 0); layout.SetColumnSpan(heading, 2);
        layout.Controls.Add(info, 0, 1); layout.SetColumnSpan(info, 2);
        layout.Controls.Add(new Label { Text = "Recording folder", AutoSize = true }, 0, 2); layout.SetColumnSpan(layout.GetControlFromPosition(0, 2), 2);
        layout.Controls.Add(folder, 0, 3); layout.Controls.Add(browse, 1, 3);
        layout.Controls.Add(new Label { Text = "One-time code from Content Settings", AutoSize = true }, 0, 4); layout.SetColumnSpan(layout.GetControlFromPosition(0, 4), 2);
        layout.Controls.Add(code, 0, 5); layout.Controls.Add(pair, 1, 5);
        layout.Controls.Add(message, 0, 6); layout.SetColumnSpan(message, 2);
        Controls.Add(layout);
    }

    private async Task Pair()
    {
        if (string.IsNullOrWhiteSpace(folder.Text) || string.IsNullOrWhiteSpace(code.Text)) { message.Text = "Choose a folder and enter the pairing code."; return; }
        pair.Enabled = false; message.Text = "Pairing…";
        try
        {
            using var client = new HttpClient { BaseAddress = new Uri(Program.BaseUrl), Timeout = TimeSpan.FromSeconds(30) };
            using var response = await client.PostAsJsonAsync("/api/desktop-uploader/pair", new { code = code.Text, deviceName = Environment.MachineName });
            if (!response.IsSuccessStatusCode) throw new InvalidOperationException("The code is invalid or expired. Generate a new one in Content Settings.");
            var result = await response.Content.ReadFromJsonAsync<PairResponse>(Program.JsonOptions) ?? throw new InvalidOperationException("Pairing returned no device token.");
            config.Token = result.Token; config.WatchFolder = folder.Text.Trim(); config.Save();
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

internal static class Ini
{
    public static string Get(string text, string section, string key)
    {
        var lines = text.Replace("\r\n", "\n").Split('\n');
        var inside = false;
        foreach (var raw in lines)
        {
            var line = raw.Trim();
            if (line.StartsWith("[") && line.EndsWith("]")) { inside = string.Equals(line, "[" + section + "]", StringComparison.OrdinalIgnoreCase); continue; }
            if (inside && line.StartsWith(key + "=", StringComparison.OrdinalIgnoreCase)) return line[(key.Length + 1)..].Trim();
        }
        return "";
    }

    public static string Set(string text, string section, string key, string value)
    {
        var lines = text.Replace("\r\n", "\n").Split('\n').ToList();
        var header = "[" + section + "]";
        var start = lines.FindIndex(x => string.Equals(x.Trim(), header, StringComparison.OrdinalIgnoreCase));
        if (start < 0) { if (lines.Count > 0 && lines[^1] != "") lines.Add(""); lines.Add(header); lines.Add(key + "=" + value); return string.Join("\r\n", lines); }
        var end = lines.FindIndex(start + 1, x => x.TrimStart().StartsWith("["));
        if (end < 0) end = lines.Count;
        for (var i = start + 1; i < end; i++)
            if (lines[i].StartsWith(key + "=", StringComparison.OrdinalIgnoreCase)) { lines[i] = key + "=" + value; return string.Join("\r\n", lines); }
        lines.Insert(end, key + "=" + value);
        return string.Join("\r\n", lines);
    }
}
