# Cuts one video into HLS for a Package: video/hls/playlist.m3u8 plus .ts
# segments, which is what a Video Capture plays back.
# The source video is scratch input and stays outside the package; only the
# playlist and its segments land under video/hls/. Idempotent: a package that
# already has playlist.m3u8 is skipped unless -Force is passed.
param(
  [Parameter(Mandatory = $true)][string]$Id,
  [Parameter(Mandatory = $true)][string]$Video,
  [string]$Root = $(if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }),
  [int]$SegmentSeconds = 6,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

if ($Id -notmatch '^\d{14}$') { throw "Id must be a 14 digit timestamp, got '$Id'." }
if ($SegmentSeconds -lt 1) { throw "SegmentSeconds must be at least 1, got $SegmentSeconds." }

$Package = Join-Path $Root "packages/$Id"
if (-not (Test-Path $Package)) { throw "No such package: $Package" }

$Source = (Resolve-Path -LiteralPath $Video -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "No such video: $Source" }

$Ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $Ffmpeg) { throw "ffmpeg is not on PATH. Install it before packaging video." }

$OutDir = Join-Path $Package "video/hls"
$Playlist = Join-Path $OutDir "playlist.m3u8"
if ((Test-Path $Playlist) -and -not $Force) {
  Write-Host "present $Id  ($OutDir already holds a playlist)"
  exit 0
}

if (Test-Path $OutDir) { Remove-Item -LiteralPath $OutDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$SegmentName = Join-Path $OutDir "segment_%03d.ts"
& $Ffmpeg.Source -hide_banner -loglevel error -y `
  -i $Source `
  -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -sc_threshold 0 `
  -force_key_frames "expr:gte(t,n_forced*$SegmentSeconds)" `
  -c:a aac -b:a 128k `
  -hls_time $SegmentSeconds -hls_playlist_type vod -hls_flags independent_segments `
  -hls_segment_filename $SegmentName `
  $Playlist
if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed with exit code $LASTEXITCODE." }

if (-not (Test-Path $Playlist)) { throw "ffmpeg reported success but wrote no playlist at $Playlist." }
$Segments = @(Get-ChildItem -LiteralPath $OutDir -Filter "*.ts")
if (-not $Segments.Count) { throw "ffmpeg reported success but wrote no .ts segments in $OutDir." }

$Total = (Get-ChildItem -LiteralPath $OutDir -File | Measure-Object -Property Length -Sum).Sum
Write-Host "wrote  $($Segments.Count) segment(s) plus playlist.m3u8  ($([math]::Round($Total / 1MB, 2)) MB)"
Write-Host "out    $OutDir"
