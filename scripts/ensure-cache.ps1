# Makes sure every Package in this checkout has its cache/<id>.wacz built.
# The cache is a local build product and stays out of git, so a fresh clone
# starts with none. This rebuilds the missing ones from packages/<id>/wacz/,
# which stores clean.warc as space-filled ASCII plus binary sidecars.
# Idempotent: a cache file already on disk is skipped unless -Force is passed.
param(
  [string]$Id,
  [string]$Slug,
  [string]$Root = $(if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }),
  [switch]$Force
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

$CacheDir = Join-Path $Root "cache"
$rebuilt = 0
foreach ($e in $targets) {
  $pkg = Join-Path $Root $e.path
  if (-not (Test-Path $pkg)) {
    Write-Host "skip    $($e.id)  ($($e.path) is not in this checkout)"
    continue
  }
  $cache = Join-Path $CacheDir "$($e.id).wacz"
  if ((Test-Path $cache) -and -not $Force) {
    Write-Host "present $($e.id).wacz  ($((Get-Item -LiteralPath $cache).Length) bytes)"
    continue
  }
  Write-Host "rebuild $($e.id).wacz"
  & (Join-Path $PSScriptRoot "rebuild-wacz.ps1") -Id $e.id -Root $Root
  $rebuilt++
}

Write-Host ""
Write-Host "Done. $($targets.Count) package(s) checked, $rebuilt .wacz rebuilt."
