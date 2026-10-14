# Reality Manual Windows uploader

Self-contained Windows tray app for the OBS-to-Editor intake path.

- First launch copies the executable to `%LOCALAPPDATA%\RealityManualUploader` and starts it with Windows.
- Setup asks for separate Vertical and Horizontal recording folders and watches both simultaneously.
- The uploader does not alter OBS. Point each of Harvey's two OBS profiles at its corresponding chosen folder; Editor detects the actual orientation from the recording itself.
- Completed recordings are detected after two unchanged observations at least one second apart and only when the file can be opened exclusively, preventing uploads while OBS is still writing while normally beginning transfer about 1.5 seconds after OBS closes the file.
- Uploads use the Editor's resumable 16 MB chunk API. Queue/session state is persisted after every acknowledged chunk, so app, network, or laptop restarts resume safely.
- A missing queued source is discarded safely and each watch folder is scanned independently, so one stale file or inaccessible folder cannot block the other recording folder. Detailed failures are written to `%LOCALAPPDATA%\RealityManualUploader\uploader.log` and surfaced in Content Settings.
- The laptop source is never deleted automatically.
- A hidden native window rejects normal Windows shutdown while a chunk upload is active and supplies Windows with a human-readable blocking reason. Forced shutdown can still override any application, so the durable queue remains the ultimate safeguard.
- The device credential is scoped to upload/resume/cancel and heartbeat routes. It cannot read Editor projects or any other Content Studio data.

Build from Linux with a .NET 8 SDK:

```sh
dotnet publish RealityManualUploader.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

The release executable is kept in the persistent ops-service data volume at `downloads/RealityManualUploader.exe`, rather than committed to Git.
