#!/usr/bin/env python3
"""
Build the AMO release ZIP, deterministically.

The release ZIP contains only what Firefox loads at runtime. Tests, build
tooling, icon sources and internal documentation stay in the source tree and
ship separately as the supporting-source archive.

Determinism
-----------
`zip(1)` records each file's mtime and the local system's metadata, so two
builds of identical bytes produced hashes that differed run to run. Nothing
downstream could then be checked against a published hash. This builder fixes
every field that is not file content:

  * an explicit, sorted runtime file list — no globbing, no directory order;
  * a fixed DOS timestamp (1980-01-01 00:00:00), the ZIP epoch;
  * fixed permissions (0644) and a fixed creator system (3, Unix);
  * no extra fields — `ZipInfo` written through `writestr` adds none;
  * `ZIP_STORED`, so the output does not depend on the zlib version or on
    compression-level defaults. The package is ~42 KB; the PNGs are already
    compressed and deflate saves little on them.

What this proves and what it does not: given byte-identical inputs, this script
produces a byte-identical ZIP. It does not make the *inputs* reproducible.
`icons/make-icons.py` output depends on the installed Pillow version, so
reproducing the published hash from scratch requires the same Pillow. Verify
against the checked-in PNGs, or record the Pillow version alongside the hash.
"""

import hashlib
import json
import pathlib
import subprocess
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent

# Explicit and sorted. Adding a runtime file means adding it here.
RUNTIME_FILES = sorted([
    "LICENSE",
    "background.js",
    "icons/icon-128.png",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "manifest.json",
    "options.html",
    "options.js",
    "parser.js",
])

ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)
FILE_MODE = 0o644
UNIX_CREATOR = 3


def run(label, argv):
    print(f"==> {label}")
    proc = subprocess.run(argv, cwd=ROOT, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stdout.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        raise SystemExit(f"{label} failed")


def validate():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    run("syntax check", ["node", "--check", "parser.js"])
    run("syntax check", ["node", "--check", "background.js"])
    run("syntax check", ["node", "--check", "options.js"])
    return manifest


def build_zip(target: pathlib.Path):
    """Write `target` with every non-content field pinned."""
    if target.exists():
        target.unlink()
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED) as zf:
        for name in RUNTIME_FILES:
            source = ROOT / name
            if not source.is_file():
                raise SystemExit(f"missing runtime file: {name}")
            info = zipfile.ZipInfo(filename=name, date_time=ZIP_EPOCH)
            info.compress_type = zipfile.ZIP_STORED
            info.create_system = UNIX_CREATOR
            info.external_attr = FILE_MODE << 16
            info.internal_attr = 0
            info.create_version = 20
            info.extract_version = 20
            info.flag_bits = 0
            zf.writestr(info, source.read_bytes())


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    manifest = validate()
    version = manifest["version"]
    zip_name = f"unread-badge-for-gmail-{version}.zip"
    target = ROOT / zip_name

    run("unit tests", ["node", "--test", *sorted(str(p.relative_to(ROOT))
                                                 for p in (ROOT / "tests").glob("*.test.js"))])

    print(f"==> packaging {zip_name}")
    build_zip(target)

    # Two builds, compared. A determinism claim that is never checked is just a
    # comment, and this one is load-bearing for the release checklist.
    probe = ROOT / f".{zip_name}.probe"
    build_zip(probe)
    first, second = sha256(target), sha256(probe)
    probe.unlink()
    if first != second:
        raise SystemExit(f"build is not deterministic: {first} != {second}")
    print(f"    two consecutive builds agree: {first}")

    print("==> hashes")
    lines = [f"{first}  {zip_name}"]
    for name in RUNTIME_FILES:
        lines.append(f"{sha256(ROOT / name)}  {name}")
    (ROOT / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))

    print(f"==> done: {zip_name}")
    print(f"    run 'addons-linter {zip_name}' to validate as AMO will.")


if __name__ == "__main__":
    main()
