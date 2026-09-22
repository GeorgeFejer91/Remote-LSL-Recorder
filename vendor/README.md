# Runtime dependencies

Run `scripts/fetch-labrecorder.ps1` to download and verify the official
LabRecorder 1.18.0 Windows release. Only `LabRecorderCLI.exe`, `lsl.dll`, its
MIT license, and upstream README are staged in the ignored
`vendor/labrecorder-win/` directory.

The pinned archive SHA-256 is recorded in the script. Generated binaries are
not stored in Git.
