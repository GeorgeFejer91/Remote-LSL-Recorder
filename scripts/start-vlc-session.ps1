[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$VideoPath,
    [ValidateRange(1024,65535)][int]$Port = 42123
)
$ErrorActionPreference = 'Stop'
$video = (Resolve-Path -LiteralPath $VideoPath).Path
if (-not (Test-Path -LiteralPath $video -PathType Leaf)) { throw 'Select a local video file.' }
$registration = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{F836C1D9-43B0-4A71-95D7-2854030B68AE}_is1'
$player = Join-Path $registration.InstallLocation 'vlc.exe'
if (-not (Test-Path -LiteralPath $player -PathType Leaf)) { throw 'Install VLC+ first.' }
$probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
try { $probe.Start() } finally { $probe.Stop() }
$arguments = @('--no-one-instance','--language=en','--extraintf=rc',"--rc-host=127.0.0.1:$Port",'--rc-quiet','--start-paused',('"' + $video + '"'))
$process = Start-Process -FilePath $player -ArgumentList $arguments -WindowStyle Hidden -PassThru
Write-Output "VLC+ process $($process.Id), local control port $Port. Select vlc-flubber-$($process.Id)-affect and its matching markers in Recorder."
