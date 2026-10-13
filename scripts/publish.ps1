# Publishes one package: validates files, uploads binaries to a GitHub Release,
# bumps the manifest, commits the small files, pushes to origin.
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
$Tag = "pkg-$Slug-v$Version"

# Files above the git cap may only live under wacz/ or video/. Everything else fails the publish.
$oversized = Get-ChildItem $PkgDir -Recurse -File | Where-Object { $_.Length -gt $Limit }
$bad = $oversized | Where-Object { $_.FullName -notmatch "\\(wacz|video)\\" }
if ($bad) {
  $bad | ForEach-Object { Write-Host "OVER LIMIT: $($_.FullName) ($([math]::Round($_.Length / 1MB, 1)) MB)" }
  throw "Files above 80 MB outside wacz/ or video/. Split them or move them."
}

# Binaries ride the release. Small files ride git.
$binaries = Get-ChildItem $PkgDir -Recurse -File -Include *.warc.gz, *.cdx.gz, *.ts, *.m3u8, *.mp4, *.webm, *.wacz
$existing = gh release view $Tag --json assets --jq ".assets[].name" 2>$null
if (-not $existing) {
  gh release create $Tag --title "$Slug v$Version" --notes "Capture binaries for $Slug."
}
if ($binaries) {
  gh release upload $Tag $binaries.FullName --clobber
}

# Record the entry and its release URLs in the manifest.
$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$urls = $binaries | ForEach-Object { "https://github.com/SANIUL-blackdragon/Lookout/releases/download/$Tag/$($_.Name)" }
$entry = $manifest.entries | Where-Object { $_.id -eq $Id }
if (-not $entry) {
  $entry = [pscustomobject]@{ id = $Id }
  $manifest.entries += $entry
}
$entry | Add-Member -NotePropertyName slug -NotePropertyValue $Slug -Force
$entry | Add-Member -NotePropertyName version -NotePropertyValue $Version -Force
$entry | Add-Member -NotePropertyName date -NotePropertyValue (Get-Date -Format o) -Force
$entry | Add-Member -NotePropertyName path -NotePropertyValue "packages/$Id" -Force
$entry | Add-Member -NotePropertyName release -NotePropertyValue $Tag -Force
$entry | Add-Member -NotePropertyName assets -NotePropertyValue @($urls) -Force
$manifest.version += 1
$manifest.updated = Get-Date -Format o
$manifest | ConvertTo-Json -Depth 10 | Set-Content $ManifestPath -Encoding utf8

git add ($PkgDir -replace "\\", "/") "packages/manifest.json"
git commit -m "Publish $Slug v$Version" -m "Binaries on release $Tag. Manifest bumped."
git push origin main
Write-Host "Published $Slug v$Version under $Tag."
