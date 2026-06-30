from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKER_MODULE_ROOT = REPO_ROOT / "apps/ingestion-worker/src/campus_ingestion_worker"
INGESTION_CORE_MODULE_ROOT = REPO_ROOT / "packages/ingestion-core/src/campus_ingestion_core"

ALLOWED_ACTIVE_MODULE_REFS = {
    "campus_ingestion_worker.env_bootstrap",
    "campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment",
}

ACTIVE_SCAN_ROOTS = (
    REPO_ROOT / "apps",
    REPO_ROOT / "configs",
    REPO_ROOT / "docs",
    REPO_ROOT / "infra",
    REPO_ROOT / "packages",
    REPO_ROOT / "scripts",
    REPO_ROOT / "tests",
)

TEXT_SUFFIXES = {
    ".go",
    ".json",
    ".md",
    ".mjs",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".yaml",
    ".yml",
}

ALLOWLISTED_PATHS = {
    Path("tests/infra/test_ingestion_python_clean_target_residue.py"),
    Path("tests/ingestion/test_ingestion_clean_target_boundary.py"),
}

ALLOWLISTED_PREFIXES = (
    ("docs", "reference", "archive"),
    ("docs", "runbooks", "archive"),
)

WORKER_REF_PATTERN = re.compile(r"campus_ingestion_worker\.[a-zA-Z0-9_]+")

REMOVED_INGESTION_CORE_MODULES = {
    "official_web_chunking_audit",
    "official_web_regulation_materialization",
    "raw_ingestion",
    "raw_ingestion_source_truth_execution",
}

REMOVED_SCRIPT_FILES = {
    "academic_calendar_selected_write_runtime_smoke.py",
    "official_web_service_guide_no_promotion_helpers.py",
    "official_web_live_seam_report.py",
    "official_web_source_pack_report.py",
    "prefetch_tokenizer.py",
    "publish_academic_calendar_projection.py",
    "service_guide_selected_write_runtime_smoke.py",
}

REMOVED_TEXT_TOKENS = {
    "academic_calendar_selected_write_runtime_smoke",
    "official_web_service_guide_no_promotion_helpers",
    "official_web_live_seam_report",
    "official_web_source_pack_report",
    "prefetch_tokenizer",
    "process_raw_ingestion_job",
    "publish_academic_calendar_projection",
    "scripts.service_guide_selected_write_runtime_smoke",
}

REMOVED_MODULE_REF_PATTERNS = (
    re.compile(r"campus_ingestion_core\.official_web_chunking_audit(?!_)"),
    re.compile(r"campus_ingestion_core\.official_web_regulation_materialization(?!_)"),
    re.compile(r"campus_ingestion_core\.raw_ingestion(?!_)"),
    re.compile(r"campus_ingestion_core\.raw_ingestion_source_truth_execution(?!_)"),
)

TS_ONLY_PYTHON_WORKSPACE_RESIDUE = {
    Path("apps/authenticated-notice-collector/pyproject.toml"),
    Path("apps/official-web-collector/pyproject.toml"),
    Path("packages/official-web-core/pyproject.toml"),
    Path("packages/wechat-official-account-core/pyproject.toml"),
}


def _is_allowlisted(path: Path) -> bool:
    relative = path.relative_to(REPO_ROOT)
    if relative in ALLOWLISTED_PATHS:
        return True
    return any(relative.parts[: len(prefix)] == prefix for prefix in ALLOWLISTED_PREFIXES)


class IngestionPythonCleanTargetResidueTest(unittest.TestCase):
    def test_removed_worker_modules_are_not_present(self) -> None:
        offenders = [
            str(path.relative_to(REPO_ROOT))
            for path in WORKER_MODULE_ROOT.glob("*.py")
            if path.name
            not in {
                "__init__.py",
                "env_bootstrap.py",
                "normalize_authenticated_notice_legacy_office_attachment.py",
            }
        ]

        self.assertFalse(
            offenders,
            "old ingestion Python worker modules must be deleted:\n" + "\n".join(offenders),
        )

    def test_active_surfaces_do_not_reference_removed_worker_modules(self) -> None:
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
                for module_ref in sorted(set(WORKER_REF_PATTERN.findall(text))):
                    if module_ref not in ALLOWED_ACTIVE_MODULE_REFS:
                        offenders.append(f"{path.relative_to(REPO_ROOT)}: {module_ref}")

        self.assertFalse(
            sorted(offenders),
            "active surfaces must not reference removed ingestion Python worker modules:\n"
            + "\n".join(sorted(offenders)),
        )

    def test_removed_ingestion_core_lifecycle_modules_are_not_present(self) -> None:
        offenders = [
            str((INGESTION_CORE_MODULE_ROOT / f"{module_name}.py").relative_to(REPO_ROOT))
            for module_name in sorted(REMOVED_INGESTION_CORE_MODULES)
            if (INGESTION_CORE_MODULE_ROOT / f"{module_name}.py").exists()
        ]

        self.assertFalse(
            offenders,
            "old ingestion-core lifecycle modules must be deleted:\n" + "\n".join(offenders),
        )

    def test_removed_active_python_ingestion_scripts_are_not_present(self) -> None:
        offenders = [
            str((REPO_ROOT / "scripts" / file_name).relative_to(REPO_ROOT))
            for file_name in sorted(REMOVED_SCRIPT_FILES)
            if (REPO_ROOT / "scripts" / file_name).exists()
        ]

        self.assertFalse(
            offenders,
            "old active Python ingestion scripts must be deleted:\n" + "\n".join(offenders),
        )

    def test_ts_only_collector_packages_do_not_reenter_uv_workspace(self) -> None:
        offenders = [
            str(path)
            for path in sorted(TS_ONLY_PYTHON_WORKSPACE_RESIDUE)
            if (REPO_ROOT / path).exists()
        ]

        self.assertFalse(
            offenders,
            "TS-owned collector/core packages must not carry pyproject.toml workspace shells:\n"
            + "\n".join(offenders),
        )

    def test_active_surfaces_do_not_reference_removed_core_lifecycle_tokens(self) -> None:
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
                for token in sorted(REMOVED_TEXT_TOKENS):
                    if token in text:
                        offenders.append(f"{path.relative_to(REPO_ROOT)}: {token}")
                for pattern in REMOVED_MODULE_REF_PATTERNS:
                    if pattern.search(text):
                        offenders.append(f"{path.relative_to(REPO_ROOT)}: {pattern.pattern}")

        self.assertFalse(
            sorted(offenders),
            "active surfaces must not reference removed ingestion lifecycle tokens:\n"
            + "\n".join(sorted(offenders)),
        )


if __name__ == "__main__":
    unittest.main()
