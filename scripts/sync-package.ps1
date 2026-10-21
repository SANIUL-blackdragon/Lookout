# Brings one package to its published state: pulls missing package files
# from the GitHub repo, verifies sidecar sha256 values, then rebuilds
# cache/<id>.wacz through rebuild-wacz.ps1.
param(
  [Parameter(Mandatory = $true)][string]$Id,
  [string]$Root = $(if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path })
)

$ErrorActionPreference = "Stop"
$Package = Join-Path $Root "packages/$Id"
$ContainerPath = Join-Path $Package "wacz/container.json"
$Tool = Join-Path $Root "scripts/rebuild-wacz.ps1"

if ($Id -notmatch "^\d{14}$") { throw "Id must be 14 digits: $Id" }
if (-not (Test-Path $ContainerPath)) { throw "container.json missing under $Package." }
if (-not (Test-Path $Tool)) { throw "Missing rebuilder: $Tool missing." }

# The script follows the checkout's own origin, so the script stays useful
# wherever the repo is cloned.
$RemoteUrl = git -C $Root remote get-url origin
if ($LASTEXITCODE -ne 0) { throw "Cannot read the git remote. Run this inside a git checkout of the repository." }
if ($RemoteUrl -match "github\.com[/:](?<owner>[^/]+)/(?<repo>[^/]+?)(?:\.git)?$") {
  $owner = $Matches.owner
  $repo = $Matches.repo
} else {
  throw "Origin is not a GitHub remote: $RemoteUrl"
}
$raw = "https://raw.githubusercontent.com/$owner/$repo/main"

git -C $Root fetch origin main
if ($LASTEXITCODE -ne 0) { throw "git fetch failed. Check the network and try again." }

# The remote tree is the list of files the published package holds. Files
# already present stay untouched, which keeps local changes visible instead
# of silently rewritten.
$RemoteFiles = @(git -C $Root ls-tree -r --name-only origin/main -- "packages/$Id")
if ($LASTEXITCODE -ne 0) { throw "Could not list the published package files for $Id." }
if ($RemoteFiles.Count -eq 0) { throw "Package $Id is not published. Use the publish flow first." }

$Downloaded = 0
foreach ($rel in $RemoteFiles) {
  $Target = Join-Path $Root $rel
  if (Test-Path $Target) { continue }
  $dir = Split-Path -Parent $Target
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Invoke-RestMethod -Uri "$raw/$rel" -OutFile $Target
  Write-Host "PULLED: $rel"
  $Downloaded++
}
Write-Host "Package complete: $Downloaded file(s) downloaded."

# A sidecar that drifted from its recorded sha256 gets restored from the
# published bytes. The result matches the sha256 in container.json, so this
# is a restore, never an edit of the capture.
$Container = Get-Content $ContainerPath -Raw | ConvertFrom-Json
$Verified = 0
foreach ($prop in $Container.files.PSObject.Properties) {
  $rel = $prop.Name
  $Target = Join-Path (Join-Path $Package "wacz") $rel
  if (-not (Test-Path $Target)) { throw "wacz/$rel missing after download. Fetch failed halfway; run the script again." }
  if ((Get-FileHash $Target -Algorithm SHA256).Hash.ToLower() -ne $prop.Value.sha256) {
    Write-Host "RESTORED: wacz/$rel (sha256 mismatch, pulling the published bytes)"
    Invoke-RestMethod -Uri "$raw/packages/$Id/wacz/$rel" -OutFile $Target
    if ((Get-FileHash $Target -Algorithm SHA256).Hash.ToLower() -ne $prop.Value.sha256) {
      throw "Restored wacz/$rel still mismatches sha256. Stop and compare the remote file."
    }
  }
  $Verified++
}
Write-Host "Sidecars verified: $Verified/$(@($Container.files.PSObject.Properties).Count)."

& $Tool -Id $Id -Root $Root
if ($LASTEXITCODE -ne 0) { throw "Rebuild failed with exit code $LASTEXITCODE." }
