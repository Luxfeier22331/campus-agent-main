from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths

PUBLIC_ASSET_PATTERNS = (
    "apps/campus-web/public/assets/dining/reviews/**",
    "apps/campus-web/public/map-assets/**",
    "apps/campus-web/test/fixtures/**",
)
TEXT_SUFFIXES = frozenset({".geojson", ".json", ".ts"})
FORBIDDEN_SOURCE_TOKENS = (
    "OpenStreetMap",
    "Open Database License",
    "ODbL",
    "muc.edu.cn",
    "中央民族大学",
    "849087992",
    "548820883",
    "365025448",
    "116.108483",
    "116.10859555",
    "116.3211",
    "116.3222",
)


@dataclass(frozen=True, slots=True)
class PublicAssetSourceCleanFailure:
    path: Path
    line_number: int
    token: str

    def render(self) -> str:
        if self.line_number == 0:
            return f"{self.path}: forbidden public asset {self.token!r}"
        return f"{self.path}: line {self.line_number}: forbidden source token {self.token!r}"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def public_asset_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths(*PUBLIC_ASSET_PATTERNS, root=base)
        if path.is_file() and _is_relevant_public_asset(path.relative_to(base).as_posix(), path)
    )


def scan_public_asset_source_tokens(
    *,
    root: Path | None = None,
) -> tuple[PublicAssetSourceCleanFailure, ...]:
    base = root or repo_root()
    failures: list[PublicAssetSourceCleanFailure] = []
    for path in public_asset_files(root=base):
        relative_path = path.relative_to(base)
        relative_text = relative_path.as_posix()
        if relative_text.startswith("apps/campus-web/public/assets/dining/reviews/"):
            failures.append(
                PublicAssetSourceCleanFailure(
                    path=relative_path,
                    line_number=0,
                    token="repo_public_dining_review_media",
                )
            )
            continue
        if relative_text.startswith("apps/campus-web/public/map-assets/"):
            failures.append(
                PublicAssetSourceCleanFailure(
                    path=relative_path,
                    line_number=0,
                    token="repo_public_map_asset",
                )
            )
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            for token in FORBIDDEN_SOURCE_TOKENS:
                if token in line:
                    failures.append(
                        PublicAssetSourceCleanFailure(
                            path=relative_path,
                            line_number=line_number,
                            token=token,
                        )
                    )
    return tuple(failures)


def _is_relevant_public_asset(relative_path: str, path: Path) -> bool:
    return relative_path.startswith(
        (
            "apps/campus-web/public/assets/dining/reviews/",
            "apps/campus-web/public/map-assets/",
        )
    ) or (
        relative_path.startswith("apps/campus-web/test/fixtures/")
        and path.suffix.lower() in TEXT_SUFFIXES
    )


def main() -> int:
    failures = scan_public_asset_source_tokens()
    if failures:
        print("Public asset source-clean check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure.render()}", file=sys.stderr)
        return 1
    print(f"Validated {len(public_asset_files())} public asset files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
