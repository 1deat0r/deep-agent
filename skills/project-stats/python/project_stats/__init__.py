"""Workspace statistics for the project-stats skill."""

from __future__ import annotations

from pathlib import Path


def _files() -> list[Path]:
    return [p for p in Path(".").rglob("*") if p.is_file() and ".git" not in p.parts]


def file_counts() -> dict[str, int]:
    """Count files by extension (no dot in the keys)."""
    counts: dict[str, int] = {}
    for path in _files():
        ext = path.suffix.lstrip(".") or "(none)"
        counts[ext] = counts.get(ext, 0) + 1
    return dict(sorted(counts.items()))


def lines_of_code(*extensions: str) -> int:
    """Total lines across files whose extension matches (no extension filter = all files)."""
    wanted = {ext.lstrip(".") for ext in extensions}
    total = 0
    for path in _files():
        if wanted and path.suffix.lstrip(".") not in wanted:
            continue
        try:
            total += sum(1 for _ in path.open(encoding="utf-8", errors="ignore"))
        except OSError:
            continue
    return total


def largest_files(n: int = 5) -> list[tuple[str, int]]:
    """The n largest files as (relative_path, size_in_bytes)."""
    sized = [(str(p), p.stat().st_size) for p in _files()]
    return sorted(sized, key=lambda pair: pair[1], reverse=True)[:n]
