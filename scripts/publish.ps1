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
$Repo = "SANIUL-blackdragon/Lookout"

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
$existing = gh release view $Tag -R $Repo --json assets --jq ".assets[].name" 2>$null
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1) { throw "gh release view failed ($LASTEXITCODE). Check auth with 'gh auth status'." }
if (-not $existing) {
  gh release create $Tag -R $Repo --title "$Slug v$Version" --notes "Capture binaries for $Slug."
  if ($LASTEXITCODE -ne 0) { throw "gh release create failed ($LASTEXITCODE)." }
}
if ($binaries) {
  gh release upload $Tag $binaries.FullName -R $Repo --clobber
  if ($LASTEXITCODE -ne 0) { throw "gh release upload failed ($LASTEXITCODE)." }
}

# Record the entry and its release URLs in the manifest.
$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$urls = $binaries | ForEach-Object { "https://github.com/$Repo/releases/download/$Tag/$($_.Name)" }
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

# Every git step runs against $Root, never the caller's working directory,
# and every step must succeed. A silent git failure would leave the release
# published while the manifest never reached the remote.
git -C $Root add ($PkgDir -replace "\\", "/") "packages/manifest.json"
if ($LASTEXITCODE -ne 0) { throw "git add failed ($LASTEXITCODE)." }
git -C $Root commit -m "Publish $Slug v$Version" -m @"
Record $Slug at version $Version in packages/manifest.json.

What changed: the manifest entry for package $Id now carries slug $Slug,
version $Version, path packages/$Id, and release $Tag. The global manifest
version was bumped.

Why: the capture for $Slug was published to $Tag, so the update channel in
packages/manifest.json must point at that release and the entry version must
move so other clones see the change.

Files in this commit: packages/manifest.json. The capture binaries
(clean.warc.gz, index.cdx.gz) never enter git; they ride $Tag.

Verification: gh release view $Tag -R $Repo --json assets.
"@
if ($LASTEXITCODE -ne 0) { throw "git commit failed ($LASTEXITCODE)." }
git -C $Root push origin main
if ($LASTEXITCODE -ne 0) { throw "git push failed ($LASTEXITCODE)." }
Write-Host "Published $Slug v$Version under $Tag."
