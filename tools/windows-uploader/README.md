# Reality Manual Windows uploader

Self-contained Windows tray app for the OBS-to-Editor intake path.

- First launch copies the executable to `%LOCALAPPDATA%\RealityManualUploader` and starts it with Windows.
- Setup clones the currently selected OBS profile as `Reality Manual` and changes only its recording directory to `%USERPROFILE%\Videos\Reality Manual` (or the folder chosen in setup).
- Completed recordings are detected only after their byte size is stable and the file can be opened exclusively, preventing uploads while OBS is still writing.
- Uploads use the Editor's resumable 16 MB chunk API. Queue/session state is persisted after every acknowledged chunk, so app, network, or laptop restarts resume safely.
- The laptop source is never deleted automatically.
- A hidden native window rejects normal Windows shutdown while a chunk upload is active and supplies Windows with a human-readable blocking reason. Forced shutdown can still override any application, so the durable queue remains the ultimate safeguard.
- The device credential is scoped to upload/resume/cancel and heartbeat routes. It cannot read Editor projects or any other Content Studio data.

Build from Linux with a .NET 8 SDK:

```sh
dotnet publish RealityManualUploader.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

The release executable is kept in the persistent ops-service data volume at `downloads/RealityManualUploader.exe`, rather than committed to Git.
