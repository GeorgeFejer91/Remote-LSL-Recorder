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
Write-Output 'Installing the exact verified installer.'
$install = Start-Process -FilePath $installerPath -ArgumentList '/S' -WindowStyle Hidden -PassThru
if (-not $install.WaitForExit(180000)) { throw 'Initial installer did not exit within three minutes.' }
if ($install.ExitCode -ne 0) { throw "Installer exit code: $($install.ExitCode)" }
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Remote LSL Recorder'
$entry = Get-ItemProperty -LiteralPath $key
if ($entry.DisplayVersion -ne '0.1.7') { throw 'Unexpected installed version.' }
$location = $entry.InstallLocation.Trim('"')
$executable = Join-Path $location $entry.MainBinaryName
$uninstallerCopy = Join-Path $env:RUNNER_TEMP 'recorder-uninstall-smoke.exe'
foreach ($relative in @('remote-lsl-recorder.exe', 'labrecorder\LabRecorderCLI.exe', 'labrecorder\lsl.dll', 'labrecorder\LICENSE', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'uninstall.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $location $relative) -PathType Leaf)) {
        throw "Installed resource missing: $relative"
    }
}
# This is the GUI under test on a disposable runner, not a background helper.
$app = Start-Process -FilePath $executable -PassThru
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
    $installedHash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash
    Write-Output 'Checking silent running-app refusal.'
    $blockedInstall = Start-Process -FilePath $installerPath -ArgumentList '/S', '/NS' -WindowStyle Hidden -PassThru
    if (-not $blockedInstall.WaitForExit(30000)) { throw 'Silent refusal did not exit within thirty seconds.' }
    if ($blockedInstall.ExitCode -eq 0) { throw 'Installer accepted a running Recorder.' }
    $app.Refresh()
    if ($app.HasExited) { throw 'Maintenance installation terminated the running Recorder.' }
    Write-Output 'Checking passive running-app refusal and dismissing its owned error page.'
    $blockedPassive = Start-Process -FilePath $installerPath -ArgumentList '/P', '/NS' -PassThru
    if (-not $blockedPassive.WaitForExit(5000)) {
        # Passive NSIS errors leave a Close page. Dismiss only this owned
        # installer window; the Recorder must remain alive throughout.
        if (-not $blockedPassive.CloseMainWindow()) { throw 'Could not dismiss the passive installer error page.' }
        if (-not $blockedPassive.WaitForExit(15000)) { throw 'Passive error-page dismissal did not complete.' }
    }
    if ($blockedPassive.ExitCode -ne 2) { throw "Expected passive refusal exit code 2, got $($blockedPassive.ExitCode)." }
    $app.Refresh()
    if ($app.HasExited) { throw 'Passive installation terminated the running Recorder.' }
    Write-Output 'Checking running-app uninstallation refusal.'
    # A temporary copy plus final _?= waits for the actual NSIS worker,
    # rather than the installed uninstaller's copy/relaunch stub.
    Copy-Item -LiteralPath (Join-Path $location 'uninstall.exe') -Destination $uninstallerCopy -Force
    $blockedUninstall = Start-Process -FilePath $uninstallerCopy -ArgumentList '/S', "_?=$location" -WindowStyle Hidden -PassThru
    if (-not $blockedUninstall.WaitForExit(30000)) { throw 'Uninstall refusal did not exit within thirty seconds.' }
    if ($blockedUninstall.ExitCode -eq 0) { throw 'Uninstaller accepted a running Recorder.' }
    $app.Refresh()
    if ($app.HasExited) { throw 'Maintenance uninstallation terminated the running Recorder.' }
    if ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -ne $installedHash) {
        throw 'Refused maintenance changed the installed executable.'
    }
    $app.CloseMainWindow() | Out-Null
    if (-not $app.WaitForExit(15000)) { throw 'Installed app did not close cleanly.' }
    if ($app.ExitCode -ne 0) { throw "Installed app exit code: $($app.ExitCode)" }
} finally {
    $app.Refresh()
    if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force }
}
$legacyMarker = Join-Path $env:RUNNER_TEMP 'unexpected-legacy-uninstaller.txt'
Set-ItemProperty -LiteralPath $key -Name UninstallString -Value ('cmd.exe /c echo legacy-uninstaller > "{0}"' -f $legacyMarker)
Write-Output 'Checking successful closed-app passive reinstall without legacy uninstaller execution.'
$reinstall = Start-Process -FilePath $installerPath -ArgumentList '/P', '/NS' -WindowStyle Hidden -PassThru
if (-not $reinstall.WaitForExit(60000)) { throw 'Closed-app reinstall did not exit within one minute.' }
if ($reinstall.ExitCode -ne 0) { throw "Closed-app reinstall exit code: $($reinstall.ExitCode)" }
if (Test-Path -LiteralPath $legacyMarker) { throw 'Installer executed a previous uninstaller.' }
Write-Output 'Checking final silent uninstallation.'
Copy-Item -LiteralPath (Join-Path $location 'uninstall.exe') -Destination $uninstallerCopy -Force
$uninstall = Start-Process -FilePath $uninstallerCopy -ArgumentList '/S', "_?=$location" -WindowStyle Hidden -PassThru
if (-not $uninstall.WaitForExit(60000)) { throw 'Final uninstaller did not exit within one minute.' }
if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exit code: $($uninstall.ExitCode)" }
for ($attempt = 0; $attempt -lt 15 -and (Test-Path -LiteralPath $executable); $attempt++) { Start-Sleep -Seconds 1 }
if ((Test-Path -LiteralPath $key) -or (Test-Path -LiteralPath $executable)) {
    throw 'Uninstall left the product registration or executable behind.'
}
Write-Output "VERIFIED: exact SHA256 installer, registration/resources, native window, idle recording, running-app install/uninstall refusal without termination, clean exit, silent uninstall."
Write-Output 'NOT TESTED: physical phone, rendered controls, hardware streams, upgrade/downgrade, offline WebView2 installation on a runtime-free host.'
