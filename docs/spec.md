# Spec: Visual Beauty Archive Library

## 1. Goal

Build a locally hosted library of visually striking websites.
Each Entry links to the live site and replays a full interactive copy.
Each Entry carries a review, credits, and design metadata for UI and UX study.

Functionality comes first. Visual design of the Library itself comes second.

## 2. Non-goals for v1

- No public write access. Only the repo owner publishes.
- No paid storage or services. Total spend is zero. Release assets are free and never touch LFS quota.
- No Git LFS. Binaries ship through GitHub Releases instead.
- No admin styling pass. The Admin UI must work, not shine.

## 3. Terms

See `CONTEXT.md`. Four words matter: Library, Entry, Capture, Package.

## 4. Package unit

One Entry ships as one ZIP with this layout:

```text
<slug>.zip
  entry.json
  singlefile/<slug>.html
  shots/shot-viewport.png
  shots/shot-full.png
  wacz/ (unpacked WACZ contents: archive/*.warc.gz, indexes/, pages.jsonl, datapackage.json)
  video/hls/ (optional: playlist.m3u8 plus .ts segments)
```

`entry.json` holds: slug, title, source URL, credits (designer, studio, year),
review text, category, colors, fonts, stack, date archived, crawl scope
(seed URLs, depth, page count, tool versions), the Capture list with paths,
and a rights block (signals found, date checked, basis for archiving).

No single file in git may pass 80 MB. Files above the rule never enter git.
WACZ chunks and video upload to a GitHub Release instead. The manifest records
their URLs. The Admin UI rejects Packages that break this split.

## 5. Capture pipeline

An agent captures each Entry. The agent picks tools per site and records the picks in `entry.json`.

Tool ladder, best fidelity first:

1. Browsertrix Crawler to WACZ for the full dynamic copy. Set `--rolloverSize 83886080` so each WARC chunk stays under the file cap. Keep `--generateWACZ` output as a local build artifact only. Commit the unpacked contents.
2. SingleFile CLI for the one-file fallback. Mandatory for every Entry.
   If the CLI fails on a site (known CloseEvent crash on new Chrome as of
   2026-10), record the capture as missing in entry.json and ship WACZ plus
   PNGs. Retry when the tool is fixed.
3. Playwright screenshots (viewport plus full page). Mandatory for every Entry.
4. Headless video only for motion-driven sites. Ship as HLS segments, not one MP4.

Crawl scope is per site. The agent decides depth and page count each time and writes them down. No global defaults.

## 6. Storage layout

```text
packages/<slug>/        small files, committed to git
packages/manifest.json  slug, title, version, date, paths, release URLs
data/library.db         SQLite database, built locally, never committed
```

Committed per Entry: `entry.json`, `singlefile/`, `shots/`, and the full
unpacked WACZ contents (`wacz/archive/*.warc.gz`, `wacz/indexes/`,
`wacz/pages.jsonl`, `wacz/datapackage.json`). The crawler splits WARC output
with `--rolloverSize 83886080`, so every chunk stays under the 80 MB git rule.
A script rebuilds the `.wacz` from these files into the gitignored cache
before viewing. WARC chunks and video go to GitHub Releases only as overflow,
if the repo ever nears the hosting size guidance.

Binaries (WACZ chunks, video segments) live as Release assets under per-package
tags like `pkg-<slug>-v<n>`. They never enter git history. Clones stay small forever.

The database file never enters git either. It is a build output. The committed
sources of truth are the `entry.json` files plus the manifest. First run builds
the database from them, so a fresh clone works with zero manual steps.

`manifest.json` is the update channel. The Library compares the local manifest
against the repo origin to find new or changed Entries.

Why unpacked: a WACZ is a ZIP. Its bulk is the WARC files inside.
Split WARC chunks plus small files ride in git or Releases with no LFS
and no custom archive format of our own.

## 7. Replay

- WACZ Captures replay through an embedded ReplayWeb.page viewer.
- A setup script fetches the Entry chunks (from git or its Release) and rebuilds a local `.wacz` into a gitignored cache dir. The viewer loads the cached file. Rebuild once, not on every view.
- Video Captures play through the HLS playlist with hls.js. Segments stay small and the viewer never knows.
- SingleFile HTML and PNGs serve as plain static files and as fallbacks when replay fails.

## 8. Database

SQLite via built-in `node:sqlite`. File: `data/library.db`, gitignored.

Tables:

- `entries`: slug (key), title, source URL, credits, review, category, stack, date archived, version.
- `captures`: id (key), entry slug, type, path, size, notes.
- `packages`: slug (key), manifest version, import date.

The database is the read source for the Library UI and API.
`entry.json` files plus the manifest are the import source of truth.
`server.js` builds the database from them on first start when the file is
missing. `scripts/build-db.ps1` does the same standalone. Reimport rebuilds rows.

## 9. server.js API

Node 22, localhost only, no auth. Every UI action has a JSON twin.

Read endpoints:

- `GET /` Library home.
- `GET /entry/<slug>` Entry page with replay viewer.
- `GET /api/entries` Entry list as JSON.
- `GET /api/entries/<slug>` One Entry with Captures as JSON.
- `GET /api/manifest` Manifest as JSON for update checks.

Admin endpoints (local machine only):

- `POST /api/packages?slug=<slug>` Upload a Package ZIP as the raw request body (`Content-Type: application/zip`), unpack, validate, register. Raw bytes instead of multipart: agents upload with plain HTTP and the Admin page sends it with a few lines of fetch.
- `POST /api/packages/<slug>/import` Import unpacked files into the database.
- `GET /api/update/check` Compare local manifest with origin.
- `POST /api/update/apply` Fetch new assets and import new Packages.

## 10. Admin UI and agent contract

The Admin UI supports upload, register, update check, and update apply.
Agents must drive it two ways: through the pages with agent-browser, and
through the JSON endpoints with plain HTTP.

Contract rules:

- Every control carries a stable `data-testid`.
- Every action has a JSON endpoint twin from section 9.
- Uploads validate the 80 MB per-file rule and report failures per file.

Autonomy rule: the user only takes three actions. Add a site, press publish,
flip auto-update. Scripts own everything behind the curtain: chunk naming,
WACZ rebuild, HLS packaging, manifest bump, release upload, asset download,
database build, cache rebuild, database import. Each script is re-runnable and skips work
already done. Nothing asks the user how it works.

## 11. Publish and auto-update

- A PowerShell script (`scripts/publish.ps1`) validates the Package, uploads binaries with `gh release upload` under the per-package tag, bumps the manifest, commits the small files, then pushes. It runs only where the owner credentials exist. Other machines are read-only. It never commits the database file.
- Auto-update is a toggle in the Library UI. When on and network exists, the Library checks the origin manifest on start. New or changed Entries download their assets only, then import. Users see what changed before it applies.

## 12. License and rights

- Own code and metadata: MIT. Holder name pending, see section 13.
- Third-party Captures keep their original rights. MIT never covers them.
- No Entry is captured without a license and ToS check. Unclear means stop and ask.

## 13. Open items

1. MIT holder name and year for the LICENSE file.
2. First 2 to 3 pilot sites to archive.
3. Confirm Docker, ffmpeg, Playwright browsers, and the `gh` CLI exist on the capture machine.
