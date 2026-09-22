[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$version = "1.18.0"
$asset = "LabRecorder-$version-Win_amd64.zip"
$expectedSha256 = "A78F9682F8ACA77503B8589A14A169341B6BB7BC03FC094801457102D9F0F455"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$downloadRoot = Join-Path $projectRoot ".for-ai-local\downloads"
$archive = Join-Path $downloadRoot $asset
$stage = Join-Path $downloadRoot "LabRecorder-$version-extracted"
$source = Join-Path $stage "LabRecorder-$version-Win_amd64"
$destination = Join-Path $projectRoot "vendor\labrecorder-win"

New-Item -ItemType Directory -Force -Path $downloadRoot, $stage, $destination | Out-Null

if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/labstreaminglayer/App-LabRecorder/releases/download/v$version/$asset" -OutFile $archive
}

$actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash
if ($actualSha256 -ne $expectedSha256) {
    throw "LabRecorder archive hash mismatch. Expected $expectedSha256 but got $actualSha256."
}

Expand-Archive -LiteralPath $archive -DestinationPath $stage -Force
foreach ($name in @("LabRecorderCLI.exe", "lsl.dll", "LICENSE", "README.md")) {
    $input = Join-Path $source $name
    if (-not (Test-Path -LiteralPath $input -PathType Leaf)) {
        throw "Pinned LabRecorder archive is missing $name."
    }
    Copy-Item -LiteralPath $input -Destination (Join-Path $destination $name) -Force
}

Write-Output "Prepared LabRecorder $version at $destination"
Write-Output "SHA256 $actualSha256"
