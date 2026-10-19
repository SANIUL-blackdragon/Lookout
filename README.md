<!-- Logo + Badges -->
<p align="center">
  <img src="assets/logo/logo.svg" alt="Lookout" width="160" />
</p>

<p align="center">
  <a href="https://github.com/SANIUL-blackdragon/Lookout"><img src="https://img.shields.io/github/stars/SANIUL-blackdragon/Lookout?style=for-the-badge" alt="GitHub stars" /></a>
  <a href="https://github.com/SANIUL-blackdragon/Lookout/network/members"><img src="https://img.shields.io/github/forks/SANIUL-blackdragon/Lookout?style=for-the-badge" alt="Forks" /></a>
  <a href="https://github.com/SANIUL-blackdragon/Lookout/issues"><img src="https://img.shields.io/github/issues/SANIUL-blackdragon/Lookout?style=for-the-badge" alt="Issues" /></a>
  <a href="https://github.com/SANIUL-blackdragon/Lookout/graphs/contributors"><img src="https://img.shields.io/github/contributors/SANIUL-blackdragon/Lookout?style=for-the-badge" alt="Contributors" /></a>
  <a href="https://github.com/SANIUL-blackdragon/Lookout/blob/main/LICENSE"><img src="https://img.shields.io/github/license/SANIUL-blackdragon/Lookout?style=for-the-badge" alt="License" /></a>
</p>

# Lookout

A collection of remarkable corners of the web. At least visually.

Lookout is a local archive and library for visually striking websites. The repository is structured around a small Node-based server, a package manifest, and capture tooling intended to preserve and replay beautiful web experiences for study and inspiration.

This repo is not just a landing page. It is the project skeleton for a visual archive system: metadata, package imports, local replay, and publish/update workflow are all part of the design.

---

## What is in this repo

- `server.js` — the local library server and JSON API
- `docs/spec.md` — architecture and capture pipeline for the archive
- `packages/` — package manifest and per-entry package data
- `scripts/` — database rebuild, WACZ rebuild, and publish utilities
- `assets/logo/` — brand/logo assets
- `LOCALHOST.md` — explanation of how localhost/server behavior works
- `AGENTS.md` — operating contract and session rules

---

## Current status

This repository is a working archive framework, not a fully populated public gallery yet. The core logic and project structure are in place, and the library is intended to grow via archived package entries and package metadata rather than a prebuilt static list of examples.

---

## Project structure

```text
Lookout/
├── AGENTS.md
├── CONTEXT.md
├── LOCALHOST.md
├── LICENSE
├── README.md
├── .gitattributes
├── .gitignore
├── server.js
├── assets/
│   └── logo/
│       └── logo.svg
├── docs/
│   └── spec.md
├── packages/
│   └── manifest.json
├── scripts/
│   ├── build-db.ps1
│   ├── publish.ps1
│   └── rebuild-wacz.ps1
├── data/                  # generated locally, gitignored
└── cache/                 # generated locally, gitignored
```

---

## Local setup

Requirements:
- Node.js 22+
- Git available if you want update/publish commands

Run the library locally:

```bash
node server.js
```

Then open:

```text
http://127.0.0.1:3000
```

The server binds to `127.0.0.1:3000` and exposes the library API and static file serving from the repo root.

---

## Archive model

The design in `docs/spec.md` describes the library as a package-based archive:

- each entry is stored as a package under `packages/<slug>/`
- metadata is stored in `entry.json`
- capture files include single-file HTML, screenshots, and WACZ content
- the server rebuilds a SQLite database from package data on startup if needed
- release assets can be separated from git-managed source files for size control

This is a deliberate architecture for large archived website captures without bloating the repo with binary payloads.

---

## Scripts

Useful repository scripts live in `scripts/`:

- `build-db.ps1` — rebuild the local database from packages
- `fetch-assets.ps1` — download package chunks missing from this checkout, then rebuild the local `.wacz`
- `publish.ps1` — validate and publish package updates
- `rebuild-wacz.ps1` — rebuild WACZ artifacts from archive data

---

## Contributing

The repo is designed around package-based entries and local archive generation. If you are adding a new entry or improving the library:

1. review the architecture in `docs/spec.md`
2. add or update package metadata under `packages/`
3. keep the capture structure consistent with the archive spec
4. validate the local server with `node server.js`

---

## License

This project is licensed under the MIT License. See `LICENSE` for details.
