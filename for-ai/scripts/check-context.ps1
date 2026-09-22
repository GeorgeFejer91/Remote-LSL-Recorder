[CmdletBinding()]
param(
    [string]$ProjectRoot = ".",
    [switch]$RequireRemote
)

$ErrorActionPreference = "Stop"
$errors = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

function Add-Error([string]$Message) { $errors.Add($Message) }
function Add-Warning([string]$Message) { $warnings.Add($Message) }

try {
    $root = (Resolve-Path -LiteralPath $ProjectRoot).Path
} catch {
    throw "Project root does not exist: $ProjectRoot"
}

$required = @(
    "AGENTS.md",
    "README.md",
    ".gitignore",
    ".gitattributes",
    "for-ai/README.md",
    "for-ai/PROJECT.md",
    "for-ai/SKILLS.md",
    "for-ai/VERIFICATION.md",
    "for-ai/WORKFLOW.md",
    "for-ai/DECISIONS.md",
    "for-ai/scripts/check-context.ps1"
)

foreach ($relative in $required) {
    $path = Join-Path $root ($relative -replace "/", [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Add-Error "Missing required file: $relative"
    }
}

$agentsPath = Join-Path $root "AGENTS.md"
if (Test-Path -LiteralPath $agentsPath) {
    $agents = Get-Content -Raw -LiteralPath $agentsPath
    if ($agents -notmatch "(?i)for-ai/README\.md") {
        Add-Error "AGENTS.md does not route to for-ai/README.md."
    }
    if (($agents -split "`n").Count -gt 100) {
        Add-Warning "AGENTS.md exceeds 100 lines; keep it as a map rather than a manual."
    }
}

$forAiRoot = Join-Path $root "for-ai"
if (Test-Path -LiteralPath $forAiRoot) {
    $textFiles = @(Get-ChildItem -LiteralPath $forAiRoot -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in @(".md", ".ps1", ".json", ".yaml", ".yml", ".toml") })
    foreach ($file in $textFiles) {
        $content = Get-Content -Raw -LiteralPath $file.FullName
        if ($content -match "\{\{[A-Z0-9_]+\}\}") {
            Add-Error "Unresolved template token in $($file.FullName.Substring($root.Length + 1))."
        }
        if ($file.Extension -eq ".md" -and ($content -split "`n").Count -gt 500) {
            Add-Warning "$($file.FullName.Substring($root.Length + 1)) exceeds 500 lines; consider task-routed references or consolidation."
        }
    }
}

& git -C $root rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) {
    Add-Error "Project root is not a Git worktree."
} else {
    $branch = (& git -C $root branch --show-current 2>$null).Trim()
    if ($branch -ne "main") {
        Add-Warning "Current branch is '$branch', not the bootstrap default 'main'."
    }

    $trackedForAi = @(& git -C $root ls-files -- "for-ai" 2>$null)
    $binaryPattern = "(?i)\.(apk|dll|docx|dylib|exe|jar|jpg|jpeg|mp4|pdf|png|so|wav|xdf|zip)$"
    foreach ($relative in $trackedForAi) {
        if ($relative -match $binaryPattern) {
            Add-Warning "Tracked binary/reference artifact in the control plane: $relative"
        }
    }

    $sensitiveNames = @(& git -C $root ls-files 2>$null | Where-Object {
        $_ -match "(?i)(^|/)(\.env($|\.)|id_rsa|id_ed25519|.*\.pem$|.*\.p12$|.*\.pfx$)"
    })
    foreach ($relative in $sensitiveNames) {
        Add-Error "Potential secret-bearing tracked filename: $relative"
    }

    $secretPattern = "AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN ([A-Z ]+ )?PRIVATE KEY-----"
    $secretFiles = @(& git -C $root grep -I -l -E $secretPattern -- . 2>$null)
    foreach ($relative in $secretFiles) {
        Add-Error "High-confidence secret pattern found in tracked file: $relative"
    }

    $status = @(& git -C $root status --porcelain 2>$null)
    if ($status.Count -gt 0) {
        Add-Warning "Working tree is not clean."
    }

    $remotes = @(& git -C $root remote 2>$null)
    $origin = $null
    if ($remotes -contains "origin") {
        $origin = (& git -C $root remote get-url origin 2>$null)
    }
    if ([string]::IsNullOrWhiteSpace($origin)) {
        if ($RequireRemote) {
            Add-Error "Required origin remote is missing."
        } else {
            Add-Warning "No origin remote is configured."
        }
    } elseif ($RequireRemote) {
        $head = (& git -C $root rev-parse HEAD 2>$null).Trim()
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $remoteLine = (& git -C $root ls-remote origin refs/heads/main 2>$null | Select-Object -First 1)
        $remoteExit = $LASTEXITCODE
        $ErrorActionPreference = $previousPreference
        if ($remoteExit -ne 0 -or [string]::IsNullOrWhiteSpace($remoteLine)) {
            Add-Error "origin/main could not be resolved."
        } else {
            $remoteHead = ($remoteLine -split "\s+")[0]
            if ($head -ne $remoteHead) {
                Add-Error "Local HEAD does not match origin/main."
            }
        }
    }
}

Write-Host "For-AI context check: $root"
if ($warnings.Count -gt 0) {
    Write-Host "Warnings:"
    $warnings | ForEach-Object { Write-Host "  - $_" }
}
if ($errors.Count -gt 0) {
    Write-Host "Errors:"
    $errors | ForEach-Object { Write-Host "  - $_" }
    exit 1
}

Write-Host "PASS: required structure and safety checks succeeded."
exit 0
