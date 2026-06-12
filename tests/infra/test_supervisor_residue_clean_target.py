from __future__ import annotations

import tomllib
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ROOT_PYPROJECT = REPO_ROOT / "pyproject.toml"
ACTIVE_SCAN_ROOTS = (
    REPO_ROOT / "apps",
    REPO_ROOT / "configs",
    REPO_ROOT / "docs",
    REPO_ROOT / "env",
    REPO_ROOT / "infra",
    REPO_ROOT / "packages",
    REPO_ROOT / "scripts",
    REPO_ROOT / "tests",
)
ACTIVE_SCAN_FILES = (
    REPO_ROOT / ".env.example",
    REPO_ROOT / ".env.staging.local.example",
)
TEXT_SUFFIXES = {
    ".example",
    ".go",
    ".json",
    ".md",
    ".mjs",
    ".ps1",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".yaml",
    ".yml",
}
ALLOWLISTED_PATH_PARTS = {
    ("docs", "decisions"),
    ("docs", "reference", "archive"),
    ("docs", "runbooks", "archive"),
}
ALLOWLISTED_FILES = {
    Path("apps/execution-control/internal/config/config.go"),
    Path("apps/execution-control/internal/config/config_test.go"),
    Path("tests/infra/test_execution_control_architecture_residue.py"),
    Path("tests/infra/test_supervisor_residue_clean_target.py"),
}


def _is_allowlisted(path: Path) -> bool:
    relative = path.relative_to(REPO_ROOT)
    if relative in ALLOWLISTED_FILES:
        return True
    parts = relative.parts
    return any(parts[: len(prefix)] == prefix for prefix in ALLOWLISTED_PATH_PARTS)


class SupervisorResidueCleanTargetTest(unittest.TestCase):
    def test_supervisor_agent_worker_package_is_removed_from_active_workspace(self) -> None:
        pyproject = tomllib.loads(ROOT_PYPROJECT.read_text(encoding="utf-8"))
        members = set(pyproject["tool"]["uv"]["workspace"]["members"])

        self.assertNotIn("apps/supervisor-agent-worker", members)
        self.assertFalse((REPO_ROOT / "apps/supervisor-agent-worker").exists())
        self.assertFalse((REPO_ROOT / "tests/supervisor").exists())

    def test_active_code_does_not_import_retired_supervisor_worker(self) -> None:
        offenders = self._find_active_references(
            (
                "campus_supervisor_agent_worker",
                "campus-supervisor-agent-worker",
                "campus-supervisor-agent-worker-dev",
            )
        )

        self.assertFalse(
            offenders,
            "retired supervisor worker package must not be imported or executed:\n"
            + "\n".join(offenders),
        )

    def test_active_runtime_does_not_reintroduce_supervisor_bridge_surface(self) -> None:
        offenders = self._find_active_references(
            (
                "/internal/bridge/supervisor/answer",
                "SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED",
                "SUPERVISOR_AGENT_WORKER_",
                "SUPERVISOR_PROMPT_MODEL",
                "supervisor_runtime_process_smoke",
            )
        )

        self.assertFalse(
            offenders,
            "active runtime must not reference the retired Python supervisor bridge:\n"
            + "\n".join(offenders),
        )

    def _find_active_references(self, needles: tuple[str, ...]) -> list[str]:
        offenders: list[str] = []
        for root in ACTIVE_SCAN_ROOTS:
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                    continue
                if _is_allowlisted(path):
                    continue
                text = path.read_text(encoding="utf-8")
                for needle in needles:
                    if needle in text:
                        offenders.append(f"{path.relative_to(REPO_ROOT)}: {needle}")
        for path in ACTIVE_SCAN_FILES:
            if not path.exists() or _is_allowlisted(path):
                continue
            text = path.read_text(encoding="utf-8")
            for needle in needles:
                if needle in text:
                    offenders.append(f"{path.relative_to(REPO_ROOT)}: {needle}")
        return sorted(offenders)


if __name__ == "__main__":
    unittest.main()
