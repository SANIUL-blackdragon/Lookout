#!/usr/bin/env python3
"""Keep unpacked WARCs as plain text by moving binary bodies to sidecar files.

The package keeps wacz/archive/clean.warc as ASCII: every binary response body
is replaced by a same-length run of spaces, and the real bytes live in loose
sidecar files. wacz/container.json records each replaced region. pack() puts
the bytes back, gzips the result, and rebuilds the .wacz.

Subcommands:
  split     unpack .warc.gz / .cdx.gz, cut binary bodies to sidecars
  assemble  write the original clean.warc to a file
  pack      assemble, gzip, and build the .wacz into the cache
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import sys
import zipfile
from pathlib import Path

FILL = b" "
FORMAT = "lookout-sidecar/1"

TEXT_TYPES = {
    "application/json",
    "application/ld+json",
    "application/javascript",
    "application/x-javascript",
    "application/ecmascript",
    "application/xml",
    "application/xhtml+xml",
    "application/rss+xml",
    "application/atom+xml",
    "image/svg+xml",
}

EXT_BY_TYPE = {
    "font/woff2": ".woff2",
    "font/woff": ".woff",
    "font/ttf": ".ttf",
    "font/otf": ".otf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/avif": ".avif",
    "application/pdf": ".pdf",
}


def wacz_dir(package: Path) -> Path:
    d = package / "wacz"
    if not d.is_dir():
        raise SystemExit(f"no wacz/ under {package}")
    return d


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def is_text(ctype: str) -> bool:
    base = ctype.split(";")[0].strip().lower()
    if not base:
        return True
    if base.startswith("text/"):
        return True
    if base in TEXT_TYPES:
        return True
    return base.endswith("+json") or base.endswith("+xml")


def ext_for(ctype: str) -> str:
    base = ctype.split(";")[0].strip().lower()
    return EXT_BY_TYPE.get(base, ".bin")


def parse_records(data: bytes):
    """Yield (headers, payload_start, payload_length) for each WARC record."""
    pos = 0
    total = len(data)
    while pos < total:
        while pos < total and data[pos] in (10, 13):
            pos += 1
        if pos >= total:
            return
        if data[pos:pos + 5] != b"WARC/":
            raise SystemExit(f"bad WARC magic at offset {pos}")
        header_end = data.index(b"\r\n\r\n", pos)
        headers = {}
        for line in data[pos:header_end].split(b"\r\n")[1:]:
            if b":" not in line:
                continue
            key, value = line.split(b":", 1)
            headers[key.strip().lower().decode("latin-1")] = value.strip().decode("latin-1")
        length = int(headers["content-length"])
        start = header_end + 4
        yield headers, start, length
        pos = start + length


def http_body(data: bytes, start: int, length: int):
    """Return (body_start, body_length) inside an HTTP payload, or None."""
    end = start + length
    split = data.find(b"\r\n\r\n", start, end)
    if split < 0:
        return None
    return split + 4, end - (split + 4)


def http_content_type(data: bytes, start: int, split: int) -> str:
    for line in data[start:split].split(b"\r\n"):
        if line.lower().startswith(b"content-type:"):
            return line.split(b":", 1)[1].strip().decode("latin-1")
    return ""


def find_plain(wacz: Path, prefer_gzip: bool) -> tuple[bytes, Path, bool]:
    gz = sorted((wacz / "archive").glob("*.warc.gz"))
    plain = sorted((wacz / "archive").glob("*.warc"))
    if prefer_gzip and gz:
        return gzip.open(gz[0], "rb").read(), gz[0], True
    if plain:
        return plain[0].read_bytes(), plain[0], False
    if gz:
        return gzip.open(gz[0], "rb").read(), gz[0], True
    raise SystemExit("no .warc or .warc.gz under wacz/archive")


def load_container(wacz: Path) -> dict:
    path = wacz / "container.json"
    if not path.exists():
        raise SystemExit(f"missing {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def assemble_bytes(package: Path) -> bytes:
    wacz = wacz_dir(package)
    container = load_container(wacz)
    warc_rel = container["warc"]
    data = bytearray((wacz / warc_rel).read_bytes())
    used = []
    for region in container["regions"]:
        offset = int(region["offset"])
        length = int(region["length"])
        for start, end in used:
            if offset < end and start < offset + length:
                raise SystemExit(f"overlapping regions at {offset}")
        used.append((offset, offset + length))
        blob = (wacz / region["file"]).read_bytes()
        if len(blob) != length:
            raise SystemExit(f"{region['file']}: {len(blob)} bytes, want {length}")
        if sha256(blob) != region["sha256"]:
            raise SystemExit(f"{region['file']}: sha256 mismatch")
        data[offset:offset + length] = blob
    return bytes(data)


def cmd_split(args) -> int:
    package = Path(args.package).resolve()
    wacz = wacz_dir(package)
    if (wacz / "container.json").exists() and not args.force:
        print(f"already split: {wacz / 'container.json'}")
        return 0

    data, source, was_gzip = find_plain(wacz, prefer_gzip=True)
    buf = bytearray(data)
    files = {}
    regions = []

    for headers, start, length in parse_records(data):
        warc_type = headers.get("warc-type", "")
        if warc_type == "response":
            body = http_body(data, start, length)
            if body is None:
                continue
            body_start, body_length = body
            split = body_start - 4
            ctype = http_content_type(data, start, split)
        elif warc_type == "resource":
            body_start, body_length = start, length
            ctype = headers.get("content-type", "")
        else:
            continue
        if body_length <= 0 or is_text(ctype):
            continue

        blob = data[body_start:body_start + body_length]
        digest = sha256(blob)
        rel = f"binaries/{digest}{ext_for(ctype)}"
        files[rel] = {"sha256": digest, "bytes": len(blob), "contentType": ctype}
        regions.append({
            "offset": body_start,
            "length": body_length,
            "file": rel,
            "sha256": digest,
            "contentType": ctype,
            "url": headers.get("warc-target-uri", ""),
        })
        buf[body_start:body_start + body_length] = FILL * body_length

    (wacz / "binaries").mkdir(exist_ok=True)
    for rel, meta in files.items():
        blob = next(
            data[r["offset"]:r["offset"] + r["length"]] for r in regions if r["file"] == rel
        )
        (wacz / rel).write_bytes(blob)
        assert sha256(blob) == meta["sha256"]

    warc_name = source.name[:-3] if was_gzip else source.name
    warc_rel = f"archive/{warc_name}"
    (wacz / warc_rel).write_bytes(bytes(buf))

    container = {
        "format": FORMAT,
        "warc": warc_rel,
        "fill": "space",
        "files": files,
        "regions": regions,
    }
    (wacz / "container.json").write_text(
        json.dumps(container, indent=2) + "\n", encoding="utf-8", newline="\n"
    )

    cdx_gz = sorted((wacz / "indexes").glob("*.cdx.gz"))
    for old in cdx_gz:
        plain = old.with_suffix("")
        plain.write_bytes(gzip.open(old, "rb").read())
        print(f"unpacked {old.name} -> {plain.name}")

    print(f"split {warc_rel}: {len(regions)} regions, {len(files)} sidecar files")
    return 0


def cmd_assemble(args) -> int:
    package = Path(args.package).resolve()
    data = assemble_bytes(package)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    print(f"{out} {len(data)} bytes sha256={sha256(data)}")
    return 0


def gzip_bytes(data: bytes) -> bytes:
    bio = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=bio, mtime=0) as handle:
        handle.write(data)
    return bio.getvalue()


def build_index_idx(cdx_text: str, cdx_gz: bytes) -> bytes:
    first = ""
    for line in cdx_text.splitlines():
        line = line.strip()
        if line and not line.startswith("!meta"):
            first = line
            break
    if not first:
        raise SystemExit("index.cdx has no records")
    key, timestamp, _ = first.split(" ", 2)
    meta = {"format": "cdxj-gzip-1.0", "filename": "index.cdx.gz"}
    entry = {"offset": 0, "length": len(cdx_gz), "digest": "sha256:" + sha256(cdx_gz)}
    return (
        "!meta 0 " + json.dumps(meta) + "\r\n"
        + key + " " + timestamp + " " + json.dumps(entry) + "\r\n"
    ).encode("utf-8")


def cmd_pack(args) -> int:
    package = Path(args.package).resolve()
    wacz = wacz_dir(package)
    container = load_container(wacz)
    warc = assemble_bytes(package)

    warc_gz = gzip_bytes(warc)
    cdx_plain = (wacz / "indexes" / "index.cdx").read_bytes()
    cdx_gz = gzip_bytes(cdx_plain)
    idx = build_index_idx(cdx_plain.decode("utf-8"), cdx_gz)
    pages = (wacz / "pages" / "pages.jsonl").read_bytes()

    items = [
        ("archive/" + Path(container["warc"]).name + ".gz", warc_gz, zipfile.ZIP_STORED),
        ("indexes/index.cdx.gz", cdx_gz, zipfile.ZIP_STORED),
        ("indexes/index.idx", idx, zipfile.ZIP_DEFLATED),
        ("pages/pages.jsonl", pages, zipfile.ZIP_DEFLATED),
    ]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w") as archive:
        for name, blob, compress in items:
            archive.writestr(name, blob, compress_type=compress)
        resources = [
            {
                "name": Path(name).name.lower(),
                "path": name,
                "hash": "sha256:" + sha256(blob),
                "bytes": len(blob),
            }
            for name, blob, _ in items
        ]
        package_json = {
            "profile": "data-package",
            "resources": resources,
            "created": __import__("datetime").datetime.now(
                __import__("datetime").timezone.utc
            ).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "wacz_version": "1.1.1",
            "software": "lookout rebuild-wacz.ps1",
        }
        blob = json.dumps(package_json, indent=2).encode("utf-8")
        archive.writestr("datapackage.json", blob, compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr(
            "datapackage-digest.json",
            json.dumps(
                {"path": "datapackage.json", "hash": "sha256:" + sha256(blob)},
                indent=2,
            ),
            compress_type=zipfile.ZIP_DEFLATED,
        )

    print(f"packed {out} {out.stat().st_size} bytes; warc sha256={sha256(warc)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    split = sub.add_parser("split", help="unpack WARC/CDX and cut binary bodies to sidecars")
    split.add_argument("--package", required=True)
    split.add_argument("--force", action="store_true")
    split.set_defaults(func=cmd_split)

    assemble = sub.add_parser("assemble", help="write the original clean.warc")
    assemble.add_argument("--package", required=True)
    assemble.add_argument("--out", required=True)
    assemble.set_defaults(func=cmd_assemble)

    pack = sub.add_parser("pack", help="assemble, gzip, and build the .wacz")
    pack.add_argument("--package", required=True)
    pack.add_argument("--out", required=True)
    pack.set_defaults(func=cmd_pack)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
