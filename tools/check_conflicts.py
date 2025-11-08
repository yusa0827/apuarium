#!/usr/bin/env python3
"""Detect unresolved Git merge conflicts in the working tree.

The script scans text files for conflict markers ("<<<<<<< ", "=======", ">>>>>>> ").
It exits with a non-zero status if any markers are found so it can be wired into
manual pre-push checks or CI to prevent accidently committing unresolved merges.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Iterable

MARKERS = ("<<<<<<< ", "=======", ">>>>>>> ")


def iter_paths(root: Path) -> Iterable[Path]:
    for path in root.rglob("*"):
        if any(part.startswith(".") and part == ".git" for part in path.parts):
            continue
        if path.is_file():
            yield path


def find_conflicts(path: Path) -> list[tuple[int, str]]:
    hits: list[tuple[int, str]] = []
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            for lineno, line in enumerate(handle, start=1):
                for marker in MARKERS:
                    if line.startswith(marker):
                        hits.append((lineno, marker.strip()))
                        break
    except (OSError, UnicodeDecodeError):
        return []
    return hits


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Scan the repository for unresolved Git merge conflicts.",
    )
    parser.add_argument(
        "path",
        nargs="?",
        default=Path.cwd(),
        type=Path,
        help="Repository root to scan (defaults to current working directory).",
    )
    args = parser.parse_args()

    root = args.path
    if not root.exists():
        parser.error(f"path does not exist: {root}")

    any_hits = False
    for file_path in iter_paths(root):
        conflicts = find_conflicts(file_path)
        if conflicts:
            any_hits = True
            for lineno, marker in conflicts:
                rel = file_path.relative_to(root)
                print(f"{rel}:{lineno}: found conflict marker '{marker}'", file=sys.stderr)

    if any_hits:
        print("Unresolved merge conflicts detected. Please resolve them before proceeding.", file=sys.stderr)
        return 1

    print("No unresolved merge conflicts detected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
