#!/usr/bin/env python3
"""
Build the supporting-source archive, deterministically.

Why this exists
---------------
Reviewer pass 7 observed that documentation must not describe source packaging
as independently reproducible unless the construction procedure is actually
included or documented. Through pass 6 it was neither: `build.py` builds the
release ZIP only, and the source archive was produced by hand. This script
closes that gap, so the claim can be made and checked rather than asserted.

It pins exactly what `build.py` pins, for the same reasons:

  * a fixed, reviewed source-file allowlist, lexicographically sorted — no tree
    scan, no directory order, no glob ordering;
  * a fixed DOS timestamp (1980-01-01 00:00:00), the ZIP epoch;
  * fixed permissions (0644) and a fixed creator system (3, Unix);
  * no extra fields and no directory entries;
  * `ZIP_STORED`, so output does not depend on the zlib version.

The allowlist replaces a `rglob("*")` tree scan, which reviewer pass 8 showed
was wrong in three separate ways: it packaged any visible file that happened to
be present, tracked or not — a stray `PRIVATE-NOTE.txt` in the working tree was
demonstrably shipped; it skipped every hidden path whether or not it belonged;
and it was documented as sorting path bytes while actually sorting Python
strings. What ships is now decided by review, not by the state of a directory.

Verified: run against an unmodified pass-6 tree, this reproduces the pass-6
source archive
`ad4c07a24cd2e0271e4f5cd09270e5ed0f2c783e9bc7a5a8cc4e80d9feeb9399`
byte for byte:

    python3 build-src.py --root <pass6-tree> --allow-missing build-src.py \
        --out /tmp/check.zip

`build-src.py` itself did not exist in the pass-6 tree, so that one omission
has to be stated on the command line. It is the sole permitted exception, it is
never implicit, and any other missing file is a hard error — a current build
quietly short a listed file is a defect, not a convenience.

Scope of the claim, stated as narrowly as build.py states its own: given
byte-identical inputs, this produces a byte-identical archive. It does not make
the inputs reproducible — see the Pillow note in `build.py`.
"""

import argparse
import hashlib
import json
import pathlib
import zipfile

ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)
FILE_MODE = 0o644
UNIX_CREATOR = 3

# Explicit and sorted, exactly as RUNTIME_FILES is in build.py. Adding a file
# to the source archive means adding it here; putting a file in the tree does
# not put it in the archive.
#
# The release ZIP is deliberately absent: it is distributed separately, which is
# why `sha256sum -c SHA256SUMS.txt` on a freshly extracted source tree reports
# one missing file. Any previously built source archive is likewise absent, so
# the builder never packages its own output.
SOURCE_FILES = sorted([
    "LICENSE",
    "LISTING.md",
    "MOZILLA-QUESTION.md",
    "PRIVACY.md",
    "PUBLISHING.md",
    "README.md",
    "SHA256SUMS.txt",
    "TEST-MATRIX.md",
    "background.js",
    "build-src.py",
    "build.py",
    "icons/icon-128.png",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon.svg",
    "icons/make-icons.py",
    "manifest.json",
    "options.html",
    "options.js",
    "parser.js",
    "tests/accounts.test.js",
    "tests/background.test.js",
    "tests/mock-browser.js",
    "tests/release.test.js",
    "tests/scanner.test.js",
    "tests/stream.test.js",
])

# The sole historical exception, and the only value `--allow-missing` accepts.
HISTORICAL_OMISSIONS = frozenset({"build-src.py"})


def source_files(root: pathlib.Path, allow_missing=frozenset()):
    """The allowlist, minus any permitted omission. Deterministic by construction."""
    missing = [name for name in SOURCE_FILES if not (root / name).is_file()]
    unexpected = [name for name in missing if name not in allow_missing]
    if unexpected:
        raise SystemExit("missing source files:\n  " + "\n  ".join(unexpected))
    skip = set(missing)
    return [name for name in SOURCE_FILES if name not in skip]


def build(root: pathlib.Path, target: pathlib.Path, prefix: str, names):
    if target.exists():
        target.unlink()
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED) as zf:
        for name in names:
            info = zipfile.ZipInfo(filename=f"{prefix}/{name}",
                                   date_time=ZIP_EPOCH)
            info.compress_type = zipfile.ZIP_STORED
            info.create_system = UNIX_CREATOR
            info.external_attr = FILE_MODE << 16
            info.internal_attr = 0
            info.create_version = 20
            info.extract_version = 20
            info.flag_bits = 0
            zf.writestr(info, (root / name).read_bytes())


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=pathlib.Path,
                    default=pathlib.Path(__file__).resolve().parent,
                    help="tree to package (default: this script's directory)")
    ap.add_argument("--out", type=pathlib.Path, default=None,
                    help="output path (default: <root>/<prefix>.zip)")
    ap.add_argument("--allow-missing", action="append", default=[],
                    metavar="PATH",
                    help="omit a listed file that a historical tree predates; "
                         "only " + ", ".join(sorted(HISTORICAL_OMISSIONS))
                         + " is accepted")
    args = ap.parse_args()

    allow_missing = frozenset(args.allow_missing)
    invalid = allow_missing - HISTORICAL_OMISSIONS
    if invalid:
        raise SystemExit("--allow-missing does not accept:\n  "
                         + "\n  ".join(sorted(invalid)))

    root = args.root.resolve()
    version = json.loads((root / "manifest.json").read_text())["version"]
    prefix = f"unread-badge-for-gmail-{version}-src"
    target = (args.out or (root / f"{prefix}.zip")).resolve()

    names = source_files(root, allow_missing)
    print(f"==> packaging {target.name} from {root} ({len(names)} files)")
    for name in names:
        print(f"    {name}")
    for name in sorted(set(SOURCE_FILES) - set(names)):
        print(f"    [omitted by --allow-missing] {name}")

    build(root, target, prefix, names)

    # Same discipline as build.py: a determinism claim that is never checked is
    # just a comment.
    probe = target.with_suffix(".probe")
    build(root, probe, prefix, names)
    first, second = sha256(target), sha256(probe)
    probe.unlink()
    if first != second:
        raise SystemExit(f"source build is not deterministic: {first} != {second}")

    print("==> two consecutive builds agree")
    print(f"{first}  {target.name}")


if __name__ == "__main__":
    main()
