param(
  [string]$Message = "",
  [ValidateSet("patch", "minor", "major")]
  [string]$Bump = "patch",
  [string]$Repository = "Moloch0/web_connect",
  [string]$ReleaseNote = "Publish local changes and refresh the userscript install entry.",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$ScriptFile = "web-connect.user.js"
$RuntimePattern = 'const VERSION\s*=\s*"([^"]+)";'

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & git @Arguments
  if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed." }
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot $Path), $Content, $encoding)
}

function Convert-ToVersion {
  param([string]$Value)
  try { return [version]$Value } catch { throw "Invalid semantic version: $Value" }
}

function Step-Version {
  param([version]$Version, [string]$Part)
  switch ($Part) {
    "major" { return "$($Version.Major + 1).0.0" }
    "minor" { return "$($Version.Major).$($Version.Minor + 1).0" }
    default { return "$($Version.Major).$($Version.Minor).$($Version.Build + 1)" }
  }
}

function Get-HeadVersion {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $content = (& git show HEAD:package.json 2>$null | Out-String).Trim()
  $ok = $LASTEXITCODE -eq 0
  $ErrorActionPreference = $previousPreference
  if (-not $ok -or -not $content) { return $null }
  try { return [string](($content | ConvertFrom-Json).version) } catch { return $null }
}

function Set-ReleaseVersion {
  param([string]$Version)
  $packageText = Get-Content -Raw -Encoding UTF8 -LiteralPath "package.json"
  $packageText = ([regex]'("version"\s*:\s*")[^"]+("\s*)').Replace($packageText, ('${1}' + $Version + '${2}'), 1)
  Write-Utf8NoBom "package.json" $packageText

  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $ScriptFile
  $source = ([regex]'(?m)^(// @version\s+)\S+(\r?)$').Replace($source, ('${1}' + $Version + '${2}'), 1)
  $source = ([regex]$RuntimePattern).Replace($source, ('const VERSION = "' + $Version + '";'), 1)
  Write-Utf8NoBom $ScriptFile $source
}

function Ensure-ChangelogEntry {
  param([string]$Version)
  $changelog = Get-Content -Raw -Encoding UTF8 -LiteralPath "CHANGELOG.md"
  if ($changelog -match ('(?m)^##\s+' + [regex]::Escape($Version) + '(?:\s|$)')) { return }
  $newline = if ($changelog.Contains("`r`n")) { "`r`n" } else { "`n" }
  $entry = "## $Version - $(Get-Date -Format 'yyyy-MM-dd')$newline$newline- $ReleaseNote$newline$newline"
  $updated = [regex]::Replace($changelog, '\A# Changelog\r?\n', { param($match) $match.Value + $newline + $entry })
  if ($updated -eq $changelog) { throw "CHANGELOG.md must start with '# Changelog'." }
  Write-Utf8NoBom "CHANGELOG.md" $updated
}

function Open-InstallPage {
  param([string]$Version)
  if ($SkipInstall) { return }
  $installUrl = "https://raw.githubusercontent.com/$Repository/refs/heads/main/$ScriptFile"
  $ready = $false
  for ($attempt = 1; $attempt -le 12; $attempt += 1) {
    try {
      $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      $response = Invoke-WebRequest -UseBasicParsing -Headers @{ "Cache-Control" = "no-cache" } -Uri "${installUrl}?version=$Version&attempt=$attempt&t=$stamp"
      if ($response.Content -match ('(?m)^// @version\s+' + [regex]::Escape($Version) + '\s*$')) {
        $ready = $true
        break
      }
    } catch {
      Write-Host "Waiting for GitHub Raw: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 3
  }
  if (-not $ready) { Write-Warning "GitHub Raw did not confirm v$Version yet; opening the install URL anyway." }
  $openStamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  Start-Process "${installUrl}?version=$Version&t=$openStamp"
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git was not found. Install Git before publishing." }

if (-not (Test-Path ".git")) {
  Invoke-Git init
  Invoke-Git branch -M main
}

$package = Get-Content -Raw -Encoding UTF8 -LiteralPath "package.json" | ConvertFrom-Json
$version = [string]$package.version
$changes = @(& git status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect local changes." }

if ($changes.Count -gt 0) {
  $headVersion = Get-HeadVersion
  if ($headVersion) {
    $current = Convert-ToVersion $version
    $previous = Convert-ToVersion $headVersion
    if ($current -lt $previous) { throw "Local version $version is older than committed version $headVersion." }
    if ($current -eq $previous) {
      $version = Step-Version $current $Bump
      Write-Host "Auto-bumped version: $headVersion -> $version"
    } else { Write-Host "Using manually selected version: $version" }
  }
  Set-ReleaseVersion $version
  Ensure-ChangelogEntry $version
} else {
  Write-Host "No local changes. Skipping commit and reopening the current install URL."
}

$source = Get-Content -Raw -Encoding UTF8 -LiteralPath $ScriptFile
$metadataVersion = [regex]::Match($source, '(?m)^// @version\s+([^\s]+)\r?$').Groups[1].Value
$runtimeVersion = [regex]::Match($source, $RuntimePattern).Groups[1].Value
$version = [string]((Get-Content -Raw -Encoding UTF8 -LiteralPath "package.json" | ConvertFrom-Json).version)
if ($version -ne $metadataVersion -or $version -ne $runtimeVersion) {
  throw "Version mismatch: package.json=$version, metadata=$metadataVersion, runtime=$runtimeVersion."
}
if (-not (Select-String -Encoding UTF8 -LiteralPath "CHANGELOG.md" -Pattern "^##\s+$([regex]::Escape($version))(?:\s|$)" -Quiet)) {
  throw "CHANGELOG.md does not contain version $version."
}

$remoteNames = @(& git remote)
if ($remoteNames -notcontains "origin") {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "The origin remote is missing. Add it with: git remote add origin https://github.com/$Repository.git"
  }
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & gh repo view $Repository *> $null
  $repositoryExists = $LASTEXITCODE -eq 0
  $ErrorActionPreference = $previousPreference
  if ($repositoryExists) { Invoke-Git remote add origin "https://github.com/$Repository.git" }
  else {
    & gh repo create $Repository --public --source . --remote origin
    if ($LASTEXITCODE -ne 0) { throw "Failed to create the GitHub repository." }
  }
}

if ($changes.Count -gt 0) {
  Invoke-Git add --all
  & git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    if (-not $Message) { $Message = "Release v$version" }
    Invoke-Git commit -m $Message
  }
  Invoke-Git branch -M main
  Invoke-Git push -u origin main
}

Write-Host ""
Write-Host "Web Connect v$version is available for local update."
Open-InstallPage $version
