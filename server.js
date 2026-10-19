// Lookout library server. Zero dependencies, plain Node 22.
// Serves static files, builds the SQLite database on first run,
// and exposes the JSON API from docs/spec.md section 9.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const CACHE_DIR = path.join(ROOT, "cache");
const PACKAGES_DIR = path.join(ROOT, "packages");
const DB_PATH = path.join(DATA_DIR, "library.db");
const MANIFEST_PATH = path.join(PACKAGES_DIR, "manifest.json");
const PORT = 3000;
const HOST = "127.0.0.1";
const MAX_ZIP_BYTES = 512 * 1024 * 1024;
const GIT_FILE_LIMIT = 80 * 1024 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".wacz": "application/wacz",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".cdx": "text/plain; charset=utf-8",
  ".gz": "application/gzip",
};

function validSlug(s) {
  return typeof s === "string" && /^[a-z0-9-]{1,80}$/.test(s);
}

// Package id is a UTC capture timestamp: YYYYMMDDHHMMSS.
function validId(s) {
  return typeof s === "string" && /^\d{14}$/.test(s);
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return { version: 1, updated: null, entries: [] };
  }
}

function openDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  // A pre-id database keys entries by slug. Entries rebuild from the source
  // files, so drop the stale table instead of migrating rows.
  const cols = db.prepare("PRAGMA table_info(entries)").all();
  if (cols.length && !cols.some((c) => c.name === "id")) {
    db.exec("DROP TABLE entries");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY, slug TEXT UNIQUE, title TEXT, source_url TEXT,
      credits_json TEXT, review TEXT, category TEXT,
      stack TEXT, date_archived TEXT, version INTEGER
    );
    CREATE TABLE IF NOT EXISTS captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entry_slug TEXT,
      type TEXT, path TEXT, size_bytes INTEGER, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS packages (
      id TEXT PRIMARY KEY, slug TEXT, manifest_version INTEGER, imported_at TEXT
    );
  `);
  return db;
}

// Rebuilds every row from packages/*/entry.json plus the manifest.
// The rebuild is authoritative: it clears the tables first, so the database
// always mirrors exactly the packages present on disk.
function buildDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(PACKAGES_DIR, { recursive: true });
  const manifest = readManifest();
  const db = openDb();
  // The rebuild mirrors the packages on disk, so start from empty. Without
  // this, a package deleted from packages/ leaves a ghost row behind.
  db.exec("DELETE FROM entries; DELETE FROM captures; DELETE FROM packages;");
  const insertEntry = db.prepare(`INSERT INTO entries
    (id, slug, title, source_url, credits_json, review, category, stack, date_archived, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const clearCaptures = db.prepare("DELETE FROM captures WHERE entry_slug = ?");
  const insertCapture = db.prepare(`INSERT INTO captures
    (entry_slug, type, path, size_bytes, notes) VALUES (?, ?, ?, ?, ?)`);
  const insertPackage = db.prepare(`INSERT OR REPLACE INTO packages
    (id, slug, manifest_version, imported_at) VALUES (?, ?, ?, ?)`);

  let count = 0;
  for (const dirent of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const id = dirent.name;
    if (!validId(id)) continue;
    const entryPath = path.join(PACKAGES_DIR, id, "entry.json");
    if (!fs.existsSync(entryPath)) continue;
    const e = JSON.parse(fs.readFileSync(entryPath, "utf8"));
    const slug = e.slug;
    if (!validSlug(slug)) continue;
    const manifestEntry = manifest.entries.find((x) => x.id === id)
      || manifest.entries.find((x) => x.slug === slug) || {};
    insertEntry.run(
      id, slug, e.title || slug, e.sourceUrl || null,
      JSON.stringify(e.credits || {}), e.review || null,
      e.category || null, e.stack || null, e.dateArchived || null,
      manifestEntry.version || 1
    );
    clearCaptures.run(slug);
    for (const c of e.captures || []) {
      let size = null;
      try {
        size = fs.statSync(path.join(PACKAGES_DIR, id, c.path)).size;
      } catch { /* listed but not downloaded yet */ }
      insertCapture.run(slug, c.type || null, c.path || null, size, c.notes || null);
    }
    insertPackage.run(id, slug, manifestEntry.version || 1, new Date().toISOString());
    count++;
  }
  db.close();
  return { entries: count };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function serveFile(res, filePath) {
  const type = TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": st.size });
    fs.createReadStream(filePath).pipe(res);
  });
}

// Maps a URL path to a file under ROOT. Returns null when the path escapes.
function resolveStatic(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const full = path.normalize(path.join(ROOT, decoded));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  if (full === DB_PATH || full.startsWith(DATA_DIR + path.sep)) return null;
  if (full.includes(path.sep + ".git" + path.sep) || full.endsWith(path.sep + ".git")) return null;
  return full;
}

function importPackage(id) {
  const dir = path.join(PACKAGES_DIR, id);
  const entryPath = path.join(dir, "entry.json");
  if (!fs.existsSync(entryPath)) return { ok: false, error: "entry.json missing" };
  const bad = [];
  for (const dirpath of [dir]) {
    for (const f of walkFiles(dirpath)) {
      const rel = path.relative(dir, f);
      const st = fs.statSync(f);
      const inExemptZone = rel.startsWith("wacz" + path.sep) || rel.startsWith("video" + path.sep);
      if (st.size > GIT_FILE_LIMIT && !inExemptZone) bad.push(rel);
    }
  }
  if (bad.length) return { ok: false, error: "files above 80 MB outside wacz/ or video/", files: bad };
  buildDatabase();
  return { ok: true, id };
}

function walkFiles(dir) {
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/") {
      const index = path.join(ROOT, "index.html");
      if (fs.existsSync(index)) return serveFile(res, index);
      return sendJson(res, 200, { lookout: true, message: "Library frontend is not built yet. Use /api/entries." });
    }

    if (req.method === "GET" && parts[0] === "entry" && parts[1]) {
      if (!validId(parts[1])) return sendJson(res, 400, { error: "bad id, want YYYYMMDDHHMMSS" });
      const db = openDb();
      const entry = db.prepare("SELECT slug FROM entries WHERE id = ?").get(parts[1]);
      db.close();
      if (!entry) return sendJson(res, 404, { error: "unknown entry", id: parts[1] });
      const page = path.join(ROOT, "sites", entry.slug, "index.html");
      if (fs.existsSync(page)) return serveFile(res, page);
      return sendJson(res, 404, { error: "entry page not built yet", id: parts[1] });
    }

    if (req.method === "GET" && url.pathname === "/api/entries") {
      const db = openDb();
      const rows = db.prepare("SELECT * FROM entries ORDER BY slug").all();
      db.close();
      return sendJson(res, 200, { entries: rows });
    }

    if (req.method === "GET" && parts[0] === "api" && parts[1] === "entries" && parts[2]) {
      if (!validId(parts[2])) return sendJson(res, 400, { error: "bad id, want YYYYMMDDHHMMSS" });
      const db = openDb();
      const entry = db.prepare("SELECT * FROM entries WHERE id = ?").get(parts[2]);
      const captures = entry
        ? db.prepare("SELECT * FROM captures WHERE entry_slug = ?").all(entry.slug)
        : [];
      db.close();
      if (!entry) return sendJson(res, 404, { error: "unknown entry", id: parts[2] });
      return sendJson(res, 200, { entry, captures });
    }

    if (req.method === "GET" && url.pathname === "/api/manifest") {
      return sendJson(res, 200, readManifest());
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "packages" && parts.length === 2) {
      const id = url.searchParams.get("id");
      if (!validId(id)) return sendJson(res, 400, { error: "bad id, want YYYYMMDDHHMMSS" });
      if (req.headers["content-type"] !== "application/zip") {
        return sendJson(res, 415, { error: "send the ZIP as the raw body with Content-Type: application/zip" });
      }
      let body;
      try {
        body = await readBody(req, MAX_ZIP_BYTES);
      } catch {
        return sendJson(res, 413, { error: "body above 512 MB" });
      }
      fs.writeFileSync(path.join(PACKAGES_DIR, id + ".zip"), body);
      return sendJson(res, 200, { ok: true, id, bytes: body.length });
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "packages" && parts[3] === "import") {
      const id = parts[2];
      if (!validId(id)) return sendJson(res, 400, { error: "bad id, want YYYYMMDDHHMMSS" });
      const zip = path.join(PACKAGES_DIR, id + ".zip");
      const dir = path.join(PACKAGES_DIR, id);
      if (fs.existsSync(zip)) {
        fs.mkdirSync(dir, { recursive: true });
        execFileSync("powershell", [
          "-NoProfile", "-Command",
          `Expand-Archive -Path '${zip}' -DestinationPath '${dir}' -Force`,
        ]);
        fs.unlinkSync(zip);
      }
      if (!fs.existsSync(dir)) return sendJson(res, 404, { error: "no such package", id });
      const result = importPackage(id);
      if (!result.ok) return sendJson(res, 422, result);
      return sendJson(res, 200, result);
    }

    if (req.method === "GET" && url.pathname === "/api/update/check") {
      try {
        execFileSync("git", ["fetch", "origin", "main", "--quiet"], { cwd: ROOT });
        const raw = execFileSync("git", ["show", "FETCH_HEAD:packages/manifest.json"], { cwd: ROOT });
        const remote = JSON.parse(raw.toString());
        const local = readManifest();
        const newer = (remote.entries || []).filter((r) => {
          const l = (local.entries || []).find((x) => x.id === r.id)
            || (local.entries || []).find((x) => x.slug === r.slug);
          return !l || (r.version || 0) > (l.version || 0);
        });
        return sendJson(res, 200, { upToDate: newer.length === 0, newer });
      } catch (e) {
        return sendJson(res, 503, { error: "offline or remote unreachable" });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/update/apply") {
      try {
        execFileSync("git", ["pull", "--ff-only", "origin", "main"], { cwd: ROOT });
        const built = buildDatabase();
        return sendJson(res, 200, { ok: true, ...built });
      } catch (e) {
        return sendJson(res, 409, { error: "pull failed, resolve locally first" });
      }
    }

    if (req.method === "GET") {
      const file = resolveStatic(url.pathname);
      if (!file) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("forbidden");
        return;
      }
      fs.stat(file, (err, st) => {
        if (!err && st.isDirectory()) return serveFile(res, path.join(file, "index.html"));
        return serveFile(res, file);
      });
      return;
    }

    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("method not allowed");
  } catch (e) {
    sendJson(res, 500, { error: "server error" });
  }
});

if (process.argv.includes("--build-db")) {
  const built = buildDatabase();
  console.log(`Database built at ${DB_PATH}: ${built.entries} entries.`);
  process.exit(0);
}

if (!fs.existsSync(DB_PATH)) buildDatabase();
server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
