# Rebuilds cache/<id>.wacz from packages/<id>/wacz/.
# The package stores clean.warc as space-filled ASCII plus binary sidecars;
# wacz-sidecars.py restores the bytes, gzips the WARC and CDX, and rebuilds
# datapackage.json. WARC and CDX entries stay STORED so range requests work.
param(
  [Parameter(Mandatory = $true)][string]$Id,
  [string]$Root = $(if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path })
)

$ErrorActionPreference = "Stop"
$Package = Join-Path $Root "packages/$Id"
$Src = Join-Path $Package "wacz"
$CacheDir = Join-Path $Root "cache"
$Out = Join-Path $CacheDir "$Id.wacz"
$Tool = Join-Path $Root "scripts/wacz-sidecars.py"
if (-not (Test-Path $Src)) { throw "Nothing to rebuild: $Src missing." }
if (-not (Test-Path $Tool)) { throw "Missing packer: $Tool missing." }
if (-not (Test-Path (Join-Path $Src "container.json"))) {
  throw "Missing container.json under $Src; run wacz-sidecars.py split first."
}
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null

python $Tool pack --package $Package --out $Out
if ($LASTEXITCODE -ne 0) { throw "wacz-sidecars.py pack failed with exit code $LASTEXITCODE." }
