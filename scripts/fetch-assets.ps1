# Fetches Package chunks that are missing from this checkout, then rebuilds the
# local .wacz. Chunks normally ride in git; a Package Release is the overflow
# copy for anything that exceeded the git size cap. Either way the manifest
# lists the asset URLs, so a clone that is missing a chunk can self-heal.
# Idempotent: a chunk already on disk is skipped, never re-downloaded.
param(
  [string]$Id,
  [string]$Slug,
  [string]$Root = $(if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }),
  [switch]$SkipWacz
)

$ErrorActionPreference = "Stop"
$Manifest = Join-Path $Root "packages/manifest.json"
if (-not (Test-Path $Manifest)) { throw "Manifest missing: $Manifest" }
$doc = Get-Content -Raw -LiteralPath $Manifest | ConvertFrom-Json

$targets = @($doc.entries | Where-Object {
    if ($Id) { return $_.id -eq $Id }
    if ($Slug) { return $_.slug -eq $Slug }
    return $true
  })
if (-not $targets.Count) { throw "No manifest entry matches Id='$Id' Slug='$Slug'." }

$rebuilt = @()
foreach ($e in $targets) {
  $pkg = Join-Path $Root $e.path
  if (-not (Test-Path $pkg)) {
    Write-Host "skip    $($e.id)  ($($e.path) is not in this checkout)"
    continue
  }
  foreach ($url in @($e.assets)) {
    if (-not $url) { continue }
    $name = Split-Path $url -Leaf
    $existing = Get-ChildItem -LiteralPath $pkg -Recurse -File -Filter $name -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($existing) {
      Write-Host "present $name  ($($existing.Length) bytes)"
      continue
    }
    if ($name -like "*.warc.gz") { $destDir = Join-Path $pkg "wacz/archive" }
    elseif ($name -like "*.cdx.gz" -or $name -like "*.idx") { $destDir = Join-Path $pkg "wacz/indexes" }
    else { $destDir = Join-Path $pkg "wacz" }
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    $dest = Join-Path $destDir $name
    Write-Host "fetch   $name"
    Write-Host "        <- $url"
    Invoke-WebRequest -Uri $url -OutFile $dest
    Write-Host "wrote   $dest  ($((Get-Item $dest).Length) bytes)"
  }
  if (-not $SkipWacz) { $rebuilt += $e.id }
}

foreach ($rid in $rebuilt) { & (Join-Path $PSScriptRoot "rebuild-wacz.ps1") -Id $rid -Root $Root }

Write-Host ""
Write-Host "Done. $($targets.Count) package(s) checked, $($rebuilt.Count) .wacz rebuilt."
