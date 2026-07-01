from __future__ import annotations

import json
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths

EXPECTED_LICENSE = "Apache-2.0"
ROOT_REQUIRED_PACKAGE_KEYS = ("bugs", "homepage", "repository")


@dataclass(frozen=True, slots=True)
class OpenSourceMetadataFailure:
    path: Path
    message: str

    def render(self) -> str:
        return f"{self.path}: {self.message}"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def audit_open_source_metadata(
    *,
    root: Path | None = None,
) -> tuple[OpenSourceMetadataFailure, ...]:
    base = root or repo_root()
    failures: list[OpenSourceMetadataFailure] = []
    package_paths = _metadata_files(root=base)
    for path in package_paths:
        relative_path = path.relative_to(base)
        if path.name == "package.json":
            failures.extend(_audit_package_json(path, relative_path))
        elif path.name == "pyproject.toml":
            failures.extend(_audit_pyproject(path, relative_path))
        elif path.name == "Cargo.toml":
            failures.extend(_audit_cargo(path, relative_path))
    return tuple(failures)


def _metadata_files(*, root: Path) -> tuple[Path, ...]:
    return tuple(
        path
        for path in worktree_paths(
            "package.json",
            "apps/*/package.json",
            "packages/*/package.json",
            "pyproject.toml",
            "apps/*/pyproject.toml",
            "packages/*/pyproject.toml",
            "Cargo.toml",
            "packages/*/Cargo.toml",
            root=root,
        )
        if path.is_file()
    )


def _audit_package_json(path: Path, relative_path: Path) -> tuple[OpenSourceMetadataFailure, ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    failures: list[OpenSourceMetadataFailure] = []
    if payload.get("license") != EXPECTED_LICENSE:
        failures.append(
            OpenSourceMetadataFailure(relative_path, f"license must be {EXPECTED_LICENSE}")
        )
    if relative_path.as_posix() != "package.json" and payload.get("private") is not True:
        failures.append(
            OpenSourceMetadataFailure(
                relative_path,
                "workspace package.json must remain private unless publication is explicitly designed",
            )
        )
    if relative_path.as_posix() == "package.json":
        for key in ROOT_REQUIRED_PACKAGE_KEYS:
            if key not in payload:
                failures.append(
                    OpenSourceMetadataFailure(
                        relative_path,
                        f"root package.json must define {key}",
                    )
                )
    return tuple(failures)


def _audit_pyproject(path: Path, relative_path: Path) -> tuple[OpenSourceMetadataFailure, ...]:
    payload = tomllib.loads(path.read_text(encoding="utf-8"))
    project = payload.get("project")
    if not isinstance(project, dict):
        return (OpenSourceMetadataFailure(relative_path, "missing [project] table"),)
    if project.get("license") != EXPECTED_LICENSE:
        return (OpenSourceMetadataFailure(relative_path, f"license must be {EXPECTED_LICENSE}"),)
    return ()


def _audit_cargo(path: Path, relative_path: Path) -> tuple[OpenSourceMetadataFailure, ...]:
    payload = tomllib.loads(path.read_text(encoding="utf-8"))
    package = payload.get("package")
    if package is None:
        return ()
    if not isinstance(package, dict):
        return (OpenSourceMetadataFailure(relative_path, "[package] must be a table"),)
    if package.get("license") != EXPECTED_LICENSE:
        return (OpenSourceMetadataFailure(relative_path, f"license must be {EXPECTED_LICENSE}"),)
    return ()


def main() -> int:
    failures = audit_open_source_metadata()
    if failures:
        print("Open-source metadata check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure.render()}", file=sys.stderr)
        return 1
    print("Validated open-source package metadata.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
