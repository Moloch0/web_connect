param(
  [string]$Message = "",
  [string]$Repository = "Moloch0/web_connect"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & git @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed."
  }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git was not found. Install Git before publishing."
}

$package = Get-Content -Raw -LiteralPath "package.json" | ConvertFrom-Json
$source = Get-Content -Raw -LiteralPath "web-connect.user.js"
$metadataVersion = [regex]::Match($source, '(?m)^// @version\s+([^\s]+)\r?$').Groups[1].Value
$runtimeVersion = [regex]::Match($source, 'const VERSION = "([^"]+)";').Groups[1].Value
$version = [string]$package.version

if (-not $metadataVersion -or -not $runtimeVersion) {
  throw "Unable to read version numbers from web-connect.user.js."
}
if ($version -ne $metadataVersion -or $version -ne $runtimeVersion) {
  throw "Version mismatch: package.json=$version, metadata=$metadataVersion, runtime=$runtimeVersion."
}
if (-not (Select-String -LiteralPath "CHANGELOG.md" -SimpleMatch "## $version" -Quiet)) {
  throw "CHANGELOG.md does not contain version $version."
}

if (-not (Test-Path ".git")) {
  Invoke-Git init
  Invoke-Git branch -M main
}

$remoteNames = @(& git remote)
$hasOrigin = $remoteNames -contains "origin"
if (-not $hasOrigin) {
  if (Get-Command gh -ErrorAction SilentlyContinue) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & gh repo view $Repository *> $null
    $repositoryExists = $LASTEXITCODE -eq 0
    $ErrorActionPreference = $previousErrorActionPreference
    if (-not $repositoryExists) {
      & gh repo create $Repository --public --source . --remote origin
      if ($LASTEXITCODE -ne 0) { throw "Failed to create the GitHub repository." }
    } else {
      Invoke-Git remote add origin "https://github.com/$Repository.git"
    }
  } else {
    throw "The origin remote is missing and GitHub CLI was not found. Create the repository, then run: git remote add origin https://github.com/$Repository.git"
  }
}

Invoke-Git add --all
& git diff --cached --quiet
$hasChanges = $LASTEXITCODE -ne 0
if ($hasChanges) {
  if (-not $Message) { $Message = "Release v$version" }
  Invoke-Git commit -m $Message
} else {
  Write-Host "No changed files to commit. Continuing with the push."
}

Invoke-Git branch -M main
Invoke-Git push -u origin main

Write-Host ""
Write-Host "Web Connect v$version was pushed successfully."
Write-Host "Install URL: https://raw.githubusercontent.com/$Repository/refs/heads/main/web-connect.user.js"
