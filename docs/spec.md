# Spec: Visual Beauty Archive Library

## 1. Goal

Build a locally hosted library of visually striking websites.
Each Entry links to the live site and replays a full interactive copy.
Each Entry carries a review, credits, and design metadata for UI and UX study.

Functionality comes first. Visual design of the Library itself comes second.

## 2. Non-goals for v1

- No public write access. Only the repo owner publishes.
- No paid storage or services. Total spend is zero.
- No Git LFS. No second store. Binaries ride in git as plain files.
- No admin styling pass. The Admin UI must work, not shine.

## 3. Terms

See `CONTEXT.md`. Four words matter: Library, Entry, Capture, Package.

## 4. Package unit

One Entry ships as one ZIP with this layout:

```text
<id>.zip
  entry.json
  singlefile/<slug>.html
  shots/shot-viewport.png
  shots/shot-full.png
  wacz/ (unpacked WACZ: archive/clean.warc, indexes/, pages/pages.jsonl, container.json, plus loose binary sidecar files)
  video/hls/ (optional: playlist.m3u8 plus .ts segments)
```

The id is the capture timestamp in UTC, `YYYYMMDDHHMMSS`. Packages are stored
by id, never by slug. The slug stays a human label inside entry.json.

`entry.json` holds: id, slug, title, source URL, credits (designer, studio, year),
review text, category, colors, fonts, stack, date archived, crawl scope
(seed URLs, depth, page count, tool versions), the Capture list with paths,
and a rights block (signals found, date checked, basis for archiving).

No single file in git may pass 80 MB. The Admin UI and the publish script
reject any Package that breaks the rule. Every file, text or binary, rides
git as a plain file.

## 5. Capture pipeline

An agent captures each Entry. The agent picks tools per site and records the picks in `entry.json`.

Tool ladder, no Docker anywhere, best fidelity first:

1. Record with Playwright driving system Chrome, writing same-host traffic to WARC through warcio, then packing with py-wacz. No Docker, no daemon. Strip wire encoding headers at record time because body bytes are stored decoded. This is the default for single-page and small sites.
2. SingleFile CLI for the one-file fallback. Mandatory for every Entry.
   If the CLI fails on a site (known CloseEvent crash on new Chrome as of
   2026-10), record the capture as missing in entry.json and ship WACZ plus
   PNGs. Retry when the tool is fixed.
3. Playwright screenshots (viewport plus full page) in the same session. Mandatory for every Entry.
4. Headless video only for motion-driven sites. Ship as HLS segments, not one MP4.
5. Multi-hundred-page sites need explicit user permission and a dockerless plan. Pick the crawler when that case shows up, and prefer one that installs with pip or npm. Keep each WARC chunk under the 80 MB cap. Keep any WACZ output as a local build artifact only. Commit the unpacked contents.

Crawl scope is per site. The agent decides depth and page count each time and writes them down. No global defaults.

## 6. Storage layout

```text
packages/<id>/           committed package contents, keyed by timestamp id
packages/manifest.json  id, slug, title, version, date, paths
data/library.db         SQLite database, built locally, never committed
```

Committed per Entry: `entry.json`, `singlefile/`, `shots/`, and the full
unpacked WACZ contents (`wacz/archive/clean.warc`, `wacz/indexes/`,
`wacz/pages/pages.jsonl`, `wacz/container.json`, and the loose binary sidecar
files named there). The crawler splits WARC output with `--rolloverSize
83886080`, so every chunk stays under the 80 MB git rule. A script rebuilds
the `.wacz` from these files, reinjecting the sidecar binaries at their
recorded offsets, into the gitignored cache before viewing. Git is the only
store, so nothing uploads anywhere.

Binaries (font and image sidecars, video segments) ride in git as plain files
next to the metadata that describes them. No Release, no LFS, no second store.

The database file never enters git either. It is a build output. The committed
sources of truth are the `entry.json` files plus the manifest. First run builds
the database from them, so a fresh clone works with zero manual steps.

`manifest.json` is the update channel. The Library compares the local manifest
against the repo origin to find new or changed Entries.

Why unpacked: a WACZ is a ZIP. Its bulk is the WARC files inside.
Split WARC chunks plus small files ride in git with no LFS and no custom
archive format of our own.

### Sidecar container

`wacz/container.json` says where each binary body sits and which sidecar file
holds its bytes. `scripts/wacz-sidecars.py` writes it and reads it back.

| Field | Meaning |
| --- | --- |
| `format` | Literal `lookout-sidecar/1`. |
| `warc` | Path to the WARC inside the package, for example `archive/clean.warc`. |
| `fill` | Literal `space`. A replaced body region holds ASCII spaces of the same length, never a NUL byte. |
| `files` | Map keyed by sidecar path. Each value has `sha256`, `bytes`, and `contentType`. |
| `regions` | List of replaced body regions. Each entry has `offset`, `length`, `file`, `sha256`, `contentType`, and `url`. |

`offset` is the byte position of the HTTP body inside the WARC. `length` is the
body size. `file` names the sidecar that holds the real bytes. `url` is the WARC
target URI.

Only binary bodies move. Text bodies stay inline in the WARC. `split` also
unpacks `indexes/*.cdx.gz` to a plain `.cdx`. `assemble` reads each region,
checks its length and `sha256`, and writes the sidecar bytes back at `offset`,
so the result matches the original WARC.

## 7. Replay

- WACZ Captures replay through an embedded ReplayWeb.page viewer.
- A setup script fetches the Entry chunks (from git) and rebuilds a local `.wacz` into a gitignored cache dir. The viewer loads the cached file. Rebuild once, not on every view.
- Video Captures play through the HLS playlist with hls.js. Segments stay small and the viewer never knows.
- SingleFile HTML and PNGs serve as plain static files and as fallbacks when replay fails.

## 8. Database

SQLite via built-in `node:sqlite`. File: `data/library.db`, gitignored.

Tables:

- `entries`: id (key), slug (label), title, source URL, credits, review, category, stack, date archived, version.
- `captures`: id (key), entry slug, type, path, size, notes.
- `packages`: id (key), slug, manifest version, import date.

The database is the read source for the Library UI and API.
`entry.json` files plus the manifest are the import source of truth.
`server.js` builds the database from them on first start when the file is
missing. `scripts/build-db.ps1` does the same standalone. Reimport rebuilds rows.

## 9. server.js API

Node 22, localhost only, no auth. Every UI action has a JSON twin.

Read endpoints:

- `GET /` Library home.
- `GET /entry/<id>` Entry page with replay viewer.
- `GET /api/entries` Entry list as JSON.
- `GET /api/entries/<id>` One Entry with Captures as JSON.
- `GET /api/manifest` Manifest as JSON for update checks.

Admin endpoints (local machine only):

- `POST /api/packages?id=<id>` Upload a Package ZIP as the raw request body (`Content-Type: application/zip`), unpack, validate, register. Raw bytes instead of multipart: agents upload with plain HTTP and the Admin page sends it with a few lines of fetch.
- `POST /api/packages/<id>/import` Import unpacked files into the database.
- `GET /api/update/check` Compare local manifest with origin.
- `POST /api/update/apply` Fetch new Packages and import them.

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
WACZ rebuild, HLS packaging, manifest bump,
database build, cache rebuild, database import. Each script is re-runnable and skips work
already done. Nothing asks the user how it works.

## 11. Publish and auto-update

- A PowerShell script (`scripts/publish.ps1`) validates the Package against the 80 MB rule, bumps the manifest, commits the package files, then pushes. It runs only where the owner credentials exist. Other machines are read-only. It never commits the database file.
- Auto-update is a toggle in the Library UI. When on and network exists, the Library checks the origin manifest on start. New or changed Entries are pulled from git, then import. Users see what changed before it applies.

## 12. License and rights

- Own code and metadata: MIT, copyright BLACK DRAGON, 2026. See the LICENSE file.
- Third-party Captures keep their original rights. MIT never covers them.
- No Entry is captured without a license and ToS check. Unclear means stop and ask.

## 13. Open items

1. First 2 to 3 pilot sites to archive.
2. Confirm ffmpeg, Playwright browsers, and the `gh` CLI exist on the capture machine. Nothing depends on Docker.
