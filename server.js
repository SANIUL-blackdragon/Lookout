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

// A publish writes git history, so only one may run at a time.
let publishing = false;
// A sync reworks the same package files a publish stages, so the two share
// the busy gate below and never run at the same time.
let syncing = false;

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
  // The entries table gained colors_json and fonts_json columns. It rebuilds
  // from disk, so drop the stale table instead of migrating its rows.
  if (cols.length && !cols.some((c) => c.name === "colors_json")) {
    db.exec("DROP TABLE IF EXISTS entries");
  }
  // A recapture keeps the slug and takes a new id, so captures key on the entry
  // id. The slug also loses its UNIQUE constraint, because two recaptures of one
  // site share a slug. Both tables rebuild from disk, so drop them together.
  const captureCols = db.prepare("PRAGMA table_info(captures)").all();
  if (captureCols.length && !captureCols.some((c) => c.name === "entry_id")) {
    db.exec("DROP TABLE IF EXISTS captures; DROP TABLE IF EXISTS entries;");
  }
  // The packages table gained a source_url column. It rebuilds from disk, so
  // drop the stale table instead of migrating its rows.
  const pkgCols = db.prepare("PRAGMA table_info(packages)").all();
  if (pkgCols.length && !pkgCols.some((c) => c.name === "source_url")) {
    db.exec("DROP TABLE packages");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY, slug TEXT, title TEXT, source_url TEXT,
      credits_json TEXT, review TEXT, category TEXT,
      colors_json TEXT, fonts_json TEXT,
      stack TEXT, date_archived TEXT, version INTEGER
    );
    CREATE TABLE IF NOT EXISTS captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT,
      type TEXT, path TEXT, size_bytes INTEGER, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS packages (
      id TEXT PRIMARY KEY, slug TEXT, source_url TEXT,
      manifest_version INTEGER, imported_at TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT
    );
  `);
  return db;
}

// Settings are owner choices, not content, so a database rebuild leaves them
// alone. The rebuild clears entries, captures, and packages only.
function readSettings(db) {
  const out = { autoUpdate: false };
  for (const row of db.prepare("SELECT key, value FROM settings").all()) {
    if (row.key === "auto_update") out.autoUpdate = row.value === "1";
  }
  return out;
}

function writeSettings(db, settings) {
  const set = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  if (typeof settings.autoUpdate === "boolean") {
    set.run("auto_update", settings.autoUpdate ? "1" : "0");
  }
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
  try {
    // The rebuild mirrors the packages on disk, so start from empty. Without
    // this, a package deleted from packages/ leaves a ghost row behind.
    db.exec("DELETE FROM entries; DELETE FROM captures; DELETE FROM packages;");
    const insertEntry = db.prepare(`INSERT INTO entries
      (id, slug, title, source_url, credits_json, review, category, stack, date_archived, version,
       colors_json, fonts_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const clearCaptures = db.prepare("DELETE FROM captures WHERE entry_id = ?");
    const insertCapture = db.prepare(`INSERT INTO captures
      (entry_id, type, path, size_bytes, notes) VALUES (?, ?, ?, ?, ?)`);
    const insertPackage = db.prepare(`INSERT OR REPLACE INTO packages
      (id, slug, source_url, manifest_version, imported_at) VALUES (?, ?, ?, ?, ?)`);

    let count = 0;
    for (const dirent of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const id = dirent.name;
      if (!validId(id)) continue;
      const entryPath = path.join(PACKAGES_DIR, id, "entry.json");
      if (!fs.existsSync(entryPath)) continue;
      // Name the package in the error, so a bad entry.json points at its
      // folder instead of surfacing as a bare SQLite binding message.
      try {
        const e = JSON.parse(fs.readFileSync(entryPath, "utf8"));
        const slug = e.slug;
        if (!validSlug(slug)) continue;
        const manifestEntry = manifest.entries.find((x) => x.id === id)
          || manifest.entries.find((x) => x.slug === slug) || {};
        insertEntry.run(
          id, slug, e.title || slug, e.sourceUrl || null,
          JSON.stringify(e.credits || {}), e.review || null,
          e.category || null, e.stack || null, e.dateArchived || null,
          manifestEntry.version || 1,
          JSON.stringify(e.colors || []), JSON.stringify(e.fonts || [])
        );
        clearCaptures.run(id);
        for (const c of e.captures || []) {
          let size = null;
          try {
            size = fs.statSync(path.join(PACKAGES_DIR, id, c.path)).size;
          } catch { /* listed but not downloaded yet */ }
          insertCapture.run(id, c.type || null, c.path || null, size, c.notes || null);
        }
        insertPackage.run(id, slug, e.sourceUrl || null, manifestEntry.version || 1, new Date().toISOString());
      } catch (err) {
        throw new Error(`${id}: ${err.message}`);
      }
      count++;
    }
    return { entries: count };
  } finally {
    db.close();
  }
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

// Unpacks packages/<id>.zip into packages/<id>/ and removes the ZIP. The id is
// validated before this runs, so neither path can escape PACKAGES_DIR.
function unpackPackage(id) {
  const zip = path.join(PACKAGES_DIR, id + ".zip");
  const dir = path.join(PACKAGES_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("powershell", [
    "-NoProfile", "-Command",
    `Expand-Archive -Path '${zip}' -DestinationPath '${dir}' -Force`,
  ]);
  fs.unlinkSync(zip);
  return dir;
}

function importPackage(id) {
  const dir = path.join(PACKAGES_DIR, id);
  const entryPath = path.join(dir, "entry.json");
  if (!fs.existsSync(entryPath)) return { ok: false, error: "entry.json missing" };
  // A bad entry.json makes the rebuild throw. Report it as a rejected import
  // with the package named, instead of letting it fall through to a 500.
  try {
    buildDatabase();
  } catch (e) {
    return { ok: false, error: `could not build the database: ${e.message}` };
  }
  return { ok: true, id };
}

// Runs scripts/publish.ps1 for one package. The script validates the files,
// bumps the manifest, commits, and pushes, so it stays the only writer of a
// publish. It runs as a child process, which keeps the event loop free for the
// busy check while the push is in flight.
function runPublish(id, version) {
  return new Promise((resolve) => {
    const child = spawn("pwsh", [
      "-NoProfile", "-File", path.join(ROOT, "scripts", "publish.ps1"),
      "-Id", id, "-Version", String(version),
    ], { cwd: ROOT });
    let output = "";
    const keep = (chunk) => {
      output = (output + chunk.toString()).slice(-4000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, code: "timeout", output });
    }, 120000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, code: "spawn", output: e.message });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      if (status === 0) return resolve({ ok: true, output });
      resolve({ ok: false, code: "exit", status, output });
    });
  });
}

// Runs scripts/sync-package.ps1 for one package. The script pulls missing
// files from origin, restores drifted sidecars, and repacks the WACZ, all
// locally and without pushing. Same child-process shape as runPublish so a
// hung script cannot hold the event loop or the sync gate.
function runSync(id) {
  return new Promise((resolve) => {
    const child = spawn("pwsh", [
      "-NoProfile", "-File", path.join(ROOT, "scripts", "sync-package.ps1"),
      "-Id", id,
    ], { cwd: ROOT });
    let output = "";
    const keep = (chunk) => {
      output = (output + chunk.toString()).slice(-4000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, code: "timeout", output });
    }, 120000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, code: "spawn", output: e.message });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      if (status === 0) return resolve({ ok: true, output });
      resolve({ ok: false, code: "exit", status, output });
    });
  });
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
        ? db.prepare("SELECT * FROM captures WHERE entry_id = ?").all(entry.id)
        : [];
      db.close();
      if (!entry) return sendJson(res, 404, { error: "unknown entry", id: parts[2] });
      return sendJson(res, 200, { entry, captures });
    }

    if (req.method === "GET" && url.pathname === "/api/manifest") {
      return sendJson(res, 200, readManifest());
    }

    if (req.method === "GET" && url.pathname === "/api/settings") {
      const db = openDb();
      const settings = readSettings(db);
      db.close();
      return sendJson(res, 200, settings);
    }

    if (req.method === "POST" && url.pathname === "/api/settings") {
      const type = (req.headers["content-type"] || "").split(";")[0].trim();
      if (type !== "application/json") {
        return sendJson(res, 415, { error: "send a JSON body with Content-Type: application/json" });
      }
      let raw;
      try {
        raw = await readBody(req, 4096);
      } catch {
        return sendJson(res, 413, { error: "body above 4 KB" });
      }
      let patch;
      try {
        patch = JSON.parse(raw.toString());
      } catch {
        return sendJson(res, 400, { error: "body is not valid JSON" });
      }
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        return sendJson(res, 400, { error: "send a JSON object" });
      }
      const known = ["autoUpdate"];
      const unknown = Object.keys(patch).filter((key) => !known.includes(key));
      if (unknown.length) {
        return sendJson(res, 400, { error: "unknown setting: " + unknown.join(", "), known });
      }
      if (typeof patch.autoUpdate !== "boolean") {
        return sendJson(res, 400, { error: "autoUpdate must be true or false" });
      }
      const db = openDb();
      writeSettings(db, patch);
      const settings = readSettings(db);
      db.close();
      return sendJson(res, 200, settings);
    }

    if (req.method === "POST" && url.pathname === "/api/publish") {
      const id = url.searchParams.get("id");
      if (!validId(id)) return sendJson(res, 400, { error: "bad id, want YYYYMMDDHHMMSS" });
      const rawVersion = url.searchParams.get("version");
      let version;
      if (rawVersion === null) {
        const known = (readManifest().entries || []).find((e) => e.id === id);
        const current = known && Number.isInteger(known.version) ? known.version : 0;
        version = current + 1;
      } else {
        // Version 0 would never look newer than nothing, so it is refused.
        if (!/^\d+$/.test(rawVersion) || Number(rawVersion) < 1) {
          return sendJson(res, 400, { error: "version must be a whole number above zero" });
        }
        version = Number(rawVersion);
      }
      if (!fs.existsSync(path.join(PACKAGES_DIR, id))) {
        return sendJson(res, 404, { error: "no such package", id });
      }
      if (publishing) {
        return sendJson(res, 409, { error: "a publish is already running" });
      }
      if (syncing) {
        return sendJson(res, 409, { error: "a sync is already running" });
      }
      publishing = true;
      let result;
      try {
        result = await runPublish(id, version);
      } finally {
        publishing = false;
      }
      if (result.code === "timeout") {
        return sendJson(res, 504, { error: "publish timed out after 120s" });
      }
      if (result.code === "spawn") {
        return sendJson(res, 500, { error: "could not start the publish script: " + result.output });
      }
      if (!result.ok) {
        const tail = result.output.trimEnd().split(/\r?\n/).slice(-20).join("\n");
        return sendJson(res, 500, { error: "publish failed", exit: result.status, output: tail });
      }
      // The push already landed, so the read model has to catch up with it.
      let rebuilt = true;
      let warning;
      try {
        buildDatabase();
      } catch (e) {
        rebuilt = false;
        warning = "published, but the local database did not rebuild: " + e.message;
      }
      const published = (readManifest().entries || []).find((e) => e.id === id);
      const body = { ok: true, id, slug: published ? published.slug || null : null, version, rebuilt };
      if (warning) return sendJson(res, 200, { ...body, warning });
      return sendJson(res, 200, body);
    }

    // One sync per request. With an id the call syncs that local package;
    // without one it sweeps every local package. Failures are reported per
    // package, so one bad package never hides the results of the rest.
    if (req.method === "POST" && url.pathname === "/api/sync") {
      const id = url.searchParams.get("id");
      let ids;
      if (id === null) {
        ids = fs.readdirSync(PACKAGES_DIR)
          .filter((name) => fs.existsSync(path.join(PACKAGES_DIR, name, "wacz", "container.json")));
        if (ids.length === 0) {
          return sendJson(res, 404, { error: "no local packages to sync" });
        }
      } else {
        if (!validId(id)) return sendJson(res, 400, { error: "bad id, want YYYYMMDDHHMMSS" });
        if (!fs.existsSync(path.join(PACKAGES_DIR, id, "wacz", "container.json"))) {
          return sendJson(res, 404, { error: "no such local package", id });
        }
        ids = [id];
      }
      if (publishing) {
        return sendJson(res, 409, { error: "a publish is already running" });
      }
      if (syncing) {
        return sendJson(res, 409, { error: "a sync is already running" });
      }
      syncing = true;
      let results;
      try {
        results = [];
        for (const one of ids) {
          const result = await runSync(one);
          if (result.ok) {
            const tail = result.output.trimEnd().split(/\r?\n/).slice(-20).join("\n");
            results.push({ id: one, ok: true, output: tail });
            continue;
          }
          if (result.code === "timeout") {
            results.push({ id: one, ok: false, error: "sync timed out after 120s" });
            continue;
          }
          if (result.code === "spawn") {
            results.push({
              id: one, ok: false,
              error: "could not start the sync script: " + result.output,
            });
            continue;
          }
          const tail = result.output.trimEnd().split(/\r?\n/).slice(-20).join("\n");
          results.push({ id: one, ok: false, error: "sync failed", exit: result.status, output: tail });
        }
      } finally {
        syncing = false;
      }
      // A call with an explicit id answers one object for that package.
      // A sweep always answers the results envelope, even when there is
      // exactly one local package, so callers can read the shape without
      // knowing how many packages the local store holds.
      if (id !== null) {
        const one = results[0];
        return sendJson(res, one.ok ? 200 : 500, one);
      }
      return sendJson(res, 200, { ok: results.every((r) => r.ok), results });
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
      const dir = path.join(PACKAGES_DIR, id);
      if (fs.existsSync(dir)) {
        return sendJson(res, 409, { error: "package already exists", id });
      }
      fs.mkdirSync(PACKAGES_DIR, { recursive: true });
      fs.writeFileSync(path.join(PACKAGES_DIR, id + ".zip"), body);
      let result;
      try {
        unpackPackage(id);
        result = importPackage(id);
      } catch (e) {
        result = { ok: false, error: e.message };
      }
      if (!result.ok) {
        // The directory did not exist before this request, so removing it
        // cannot destroy anything the operator already had on disk.
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(path.join(PACKAGES_DIR, id + ".zip"), { force: true });
        return sendJson(res, 422, result);
      }
      return sendJson(res, 200, { ok: true, id, bytes: body.length });
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "packages" && parts[3] === "import") {
      const id = parts[2];
      if (!validId(id)) return sendJson(res, 400, { error: "bad id, want YYYYMMDDHHMMSS" });
      if (fs.existsSync(path.join(PACKAGES_DIR, id + ".zip"))) unpackPackage(id);
      const dir = path.join(PACKAGES_DIR, id);
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
    // Log first, so the reason survives for the console even when the client
    // only sees the generic body.
    console.error(`request failed: ${req.method} ${req.url}:`, e);
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
