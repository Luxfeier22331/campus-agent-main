from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

FORBIDDEN_LICENSE_TOKENS = (
    "AGPL",
    "Affero",
    "Commons Clause",
    "SSPL",
)
LOCKFILE_PATHS = (
    "pnpm-lock.yaml",
    "uv.lock",
    "apps/execution-control/go.sum",
    "Cargo.lock",
)


@dataclass(frozen=True, slots=True)
class DependencyLicensePolicyFailure:
    path: Path
    token: str

    def render(self) -> str:
        return f"{self.path}: forbidden dependency license token {self.token!r}"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def audit_dependency_license_policy(
    *,
    root: Path | None = None,
) -> tuple[DependencyLicensePolicyFailure, ...]:
    base = root or repo_root()
    failures: list[DependencyLicensePolicyFailure] = []
    for relative in LOCKFILE_PATHS:
        path = base / relative
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        for token in FORBIDDEN_LICENSE_TOKENS:
            if token in text:
                failures.append(DependencyLicensePolicyFailure(Path(relative), token))
    return tuple(failures)


def main() -> int:
    failures = audit_dependency_license_policy()
    if failures:
        print("Dependency license policy check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure.render()}", file=sys.stderr)
        return 1
    print("Validated dependency lockfiles against forbidden license tokens.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
