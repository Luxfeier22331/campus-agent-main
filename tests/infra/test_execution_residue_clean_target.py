from __future__ import annotations

import tomllib
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ROOT_PYPROJECT = REPO_ROOT / "pyproject.toml"
RETIRED_WORKER_PATH = "apps/" + "super" + "visor-agent-worker"
RETIRED_TEST_PATH = "tests/" + "super" + "visor"
RETIRED_ENV_PREFIX = "SUPER" + "VISOR_"
RETIRED_PACKAGE_UNDERSCORE = "campus_" + "super" + "visor_agent_worker"
RETIRED_PACKAGE_DASH = "campus-" + "super" + "visor-agent-worker"
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
    REPO_ROOT / "AGENTS.md",
    REPO_ROOT / "README.md",
    REPO_ROOT / ".env.example",
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
    Path("apps/execution-control/internal/config/retired_settings.go"),
    Path("apps/execution-control/internal/config/config.go"),
    Path("apps/execution-control/internal/config/config_test.go"),
    Path("configs/runtime/env-surface-policy.v1.json"),
    Path("tests/infra/test_execution_control_architecture_residue.py"),
    Path("tests/infra/test_execution_residue_clean_target.py"),
}
ACTIVE_RETIRED_OWNER_FORBIDDEN_SNIPPETS = {
    "- `apps/ingestion-worker`: ingestion runtime 壳；承接摄入任务，不负责在线回答编排",
    "- `packages/knowledge-capability`: knowledge-family / RAG capability",
    "- `packages/retrieval-core`: retrieval abstraction、evidence 获取与回链路径",
    "它顺序启动 `" + "super" + "visor-agent-worker`、`execution-control`",
    "packages/ingestion-core packages/retrieval-core packages/navigation-capability packages/contracts",
    "返回 ingestion-worker 可消费的 deterministic `releaseId`",
    "Python `" + "super" + "visor-agent-worker` 不再参与 online answer path；它只保留 offline /",
    "`" + RETIRED_WORKER_PATH + "` 是 private semantic worker",
    "Python `" + RETIRED_WORKER_PATH + "` 继续保留 semantic orchestration",
    " `packages/knowledge-capability` 负责 retrieval strategy selection",
    " `packages/retrieval-core` 负责 query preprocessing",
}


def _is_allowlisted(path: Path) -> bool:
    relative = path.relative_to(REPO_ROOT)
    if relative in ALLOWLISTED_FILES:
        return True
    parts = relative.parts
    return any(parts[: len(prefix)] == prefix for prefix in ALLOWLISTED_PATH_PARTS)


class ExecutionResidueCleanTargetTest(unittest.TestCase):
    def test_retired_python_worker_package_is_removed_from_active_workspace(self) -> None:
        pyproject = tomllib.loads(ROOT_PYPROJECT.read_text(encoding="utf-8"))
        members = set(pyproject["tool"]["uv"]["workspace"]["members"])

        self.assertNotIn(RETIRED_WORKER_PATH, members)
        self.assertFalse((REPO_ROOT / RETIRED_WORKER_PATH).exists())
        self.assertFalse((REPO_ROOT / RETIRED_TEST_PATH).exists())

    def test_active_code_does_not_import_retired_python_worker(self) -> None:
        offenders = self._find_active_references(
            (
                RETIRED_PACKAGE_UNDERSCORE,
                RETIRED_PACKAGE_DASH,
                RETIRED_PACKAGE_DASH + "-dev",
            )
        )

        self.assertFalse(
            offenders,
            "retired Python worker package must not be imported or executed:\n"
            + "\n".join(offenders),
        )

    def test_active_runtime_does_not_reintroduce_retired_python_surface(self) -> None:
        offenders = self._find_active_references(
            (
                "/internal/bridge/" + "super" + "visor/answer",
                RETIRED_ENV_PREFIX + "AGENTS_SDK_RUNTIME_ENABLED",
                RETIRED_ENV_PREFIX + "AGENT_WORKER_",
                RETIRED_ENV_PREFIX + "PROMPT_MODEL",
                "super" + "visor_runtime_process_smoke",
            )
        )

        self.assertFalse(
            offenders,
            "active runtime must not reference the retired Python bridge:\n" + "\n".join(offenders),
        )

    def test_active_truth_does_not_describe_retired_python_packages_as_current_owners(
        self,
    ) -> None:
        offenders = self._find_active_references(tuple(ACTIVE_RETIRED_OWNER_FORBIDDEN_SNIPPETS))

        self.assertFalse(
            offenders,
            "active truth must not describe retired Python worker/retrieval packages as current owners:\n"
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
