# Publishes one package: validates files, bumps the manifest, commits, pushes.
param(
  [Parameter(Mandatory = $true)][string]$Id,
  [Parameter(Mandatory = $true)][int]$Version
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$PkgDir = Join-Path $Root "packages/$Id"
$ManifestPath = Join-Path $Root "packages/manifest.json"
$Limit = 80MB

if (-not (Test-Path $PkgDir)) { throw "Package dir missing: $PkgDir" }
if (-not (Test-Path (Join-Path $PkgDir "entry.json"))) { throw "entry.json missing in $PkgDir" }
$Slug = (Get-Content (Join-Path $PkgDir "entry.json") -Raw | ConvertFrom-Json).slug
if (-not $Slug) { throw "entry.json has no slug." }

# No single file may pass the git cap. Every file rides git as a plain file.
$oversized = Get-ChildItem $PkgDir -Recurse -File | Where-Object { $_.Length -gt $Limit }
if ($oversized) {
  $oversized | ForEach-Object { Write-Host "OVER LIMIT: $($_.FullName) ($([math]::Round($_.Length / 1MB, 1)) MB)" }
  throw "A file above 80 MB cannot be published. Split it first."
}

# Record the entry in the manifest.
$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$entry = $manifest.entries | Where-Object { $_.id -eq $Id }
if (-not $entry) {
  $entry = [pscustomobject]@{ id = $Id }
  $manifest.entries += $entry
}
$entry | Add-Member -NotePropertyName slug -NotePropertyValue $Slug -Force
$entry | Add-Member -NotePropertyName version -NotePropertyValue $Version -Force
$entry | Add-Member -NotePropertyName date -NotePropertyValue (Get-Date -Format o) -Force
$entry | Add-Member -NotePropertyName path -NotePropertyValue "packages/$Id" -Force
# Git is the only store, so a Release tag and asset URLs have no place here.
$entry.PSObject.Properties.Remove("release")
$entry.PSObject.Properties.Remove("assets")
$manifest.version += 1
$manifest.updated = Get-Date -Format o
$manifest | ConvertTo-Json -Depth 10 | Set-Content $ManifestPath -Encoding utf8

# Every git step runs against $Root, never the caller's working directory,
# and every step must succeed. A silent git failure would leave the commit
# half-written.
git -C $Root add ($PkgDir -replace "\\", "/") "packages/manifest.json"
if ($LASTEXITCODE -ne 0) { throw "git add failed ($LASTEXITCODE)." }
git -C $Root commit -m "Publish $Slug v$Version" -m @"
Record $Slug at version $Version in packages/manifest.json.

What changed: the manifest entry for package $Id now carries slug $Slug,
version $Version, and path packages/$Id. The global manifest version was bumped.

Why: the capture for $Slug is published as version $Version, so the entry
version must move and the manifest must record the new state. Other clones
detect the change by comparing the manifest.

Files in this commit: packages/$Id and packages/manifest.json.

Verification: the push succeeds and the origin manifest lists version $Version.
"@
if ($LASTEXITCODE -ne 0) { throw "git commit failed ($LASTEXITCODE)." }
git -C $Root push origin main
if ($LASTEXITCODE -ne 0) { throw "git push failed ($LASTEXITCODE)." }
Write-Host "Published $Slug v$Version."
