# Rebuilds cache/<slug>.wacz from packages/<slug>/wacz/ plus fresh datapackage files.
# WARC and CDX entries must be STORED (not deflated) for range requests to work.
param(
  [Parameter(Mandatory = $true)][string]$Slug,
  [string]$Root = $(if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path })
)

$ErrorActionPreference = "Stop"
$Src = Join-Path $Root "packages/$Slug/wacz"
$CacheDir = Join-Path $Root "cache"
$Out = Join-Path $CacheDir "$Slug.wacz"
if (-not (Test-Path $Src)) { throw "Nothing to rebuild: $Src missing." }
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null

python -c @"
import datetime, hashlib, json, os, zipfile
src = r'$Src'
out = r'$Out'
store_ext = ('.warc.gz', '.cdx.gz')
names = []
for base, _, files in os.walk(src):
    for f in sorted(files):
        names.append(os.path.relpath(os.path.join(base, f), src).replace(os.sep, '/'))
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in names:
        full = os.path.join(src, *name.split('/'))
        compress = zipfile.ZIP_STORED if name.endswith(store_ext) else zipfile.ZIP_DEFLATED
        z.write(full, name, compress_type=compress)
with zipfile.ZipFile(out, 'a', zipfile.ZIP_DEFLATED) as z:
    resources = []
    for name in z.namelist():
        with z.open(name, 'r') as stream:
            h = hashlib.sha256(); size = 0
            for chunk in iter(lambda: stream.read(65536), b''):
                h.update(chunk); size += len(chunk)
        resources.append({'name': os.path.basename(name).lower(), 'path': name,
                          'hash': 'sha256:' + h.hexdigest(), 'bytes': size})
    package = {'profile': 'data-package', 'resources': resources,
               'created': datetime.datetime.now(datetime.UTC).strftime('%Y-%m-%dT%H:%M:%SZ'),
               'wacz_version': '1.1.1', 'software': 'lookout rebuild-wacz.ps1'}
    blob = json.dumps(package, indent=2).encode('utf-8')
    z.writestr('datapackage.json', blob)
    z.writestr('datapackage-digest.json', json.dumps(
        {'path': 'datapackage.json', 'hash': 'sha256:' + hashlib.sha256(blob).hexdigest()}, indent=2))
print('rebuilt ' + out)
"@
