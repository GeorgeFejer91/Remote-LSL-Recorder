[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$Sha256
)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') {
    throw 'This install/launch/uninstall check is restricted to disposable GitHub Actions hosts.'
}
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
if ((Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash -ne $Sha256) {
    throw 'Installer SHA256 mismatch.'
}
$install = Start-Process -FilePath $installerPath -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
if ($install.ExitCode -ne 0) { throw "Installer exit code: $($install.ExitCode)" }
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Remote LSL Recorder'
$entry = Get-ItemProperty -LiteralPath $key
if ($entry.DisplayVersion -ne '0.1.7') { throw 'Unexpected installed version.' }
$location = $entry.InstallLocation.Trim('"')
$executable = Join-Path $location $entry.MainBinaryName
foreach ($relative in @('remote-lsl-recorder.exe', 'labrecorder\LabRecorderCLI.exe', 'labrecorder\lsl.dll', 'labrecorder\LICENSE', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'uninstall.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $location $relative) -PathType Leaf)) {
        throw "Installed resource missing: $relative"
    }
}
$app = Start-Process -FilePath $executable -WindowStyle Hidden -PassThru
try {
    $hasWindow = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        $app.Refresh()
        if ($app.HasExited) { throw "Installed app exited: $($app.ExitCode)" }
        if ($app.MainWindowHandle -ne 0) { $hasWindow = $true; break }
    }
    if (-not $hasWindow) { throw 'Installed app did not create a native window.' }
    if (Get-CimInstance Win32_Process -Filter "Name='LabRecorderCLI.exe'") {
        throw 'Unexpected recording process before recording was requested.'
    }
    $app.CloseMainWindow() | Out-Null
    if (-not $app.WaitForExit(15000)) { throw 'Installed app did not close cleanly.' }
} finally {
    $app.Refresh()
    if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force }
}
$uninstall = Start-Process -FilePath (Join-Path $location 'uninstall.exe') -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exit code: $($uninstall.ExitCode)" }
for ($attempt = 0; $attempt -lt 15 -and (Test-Path -LiteralPath $executable); $attempt++) { Start-Sleep -Seconds 1 }
if ((Test-Path -LiteralPath $key) -or (Test-Path -LiteralPath $executable)) {
    throw 'Uninstall left the product registration or executable behind.'
}
Write-Output "VERIFIED: exact SHA256 installer, registration/resources, native window, idle recording, clean exit, silent uninstall."
Write-Output 'NOT TESTED: physical phone, rendered controls, hardware streams, upgrade/downgrade, offline WebView2 installation on a runtime-free host.'
