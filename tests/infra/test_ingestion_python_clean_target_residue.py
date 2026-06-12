from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

REMOVED_ACTIVE_MODULES = (
    "campus_ingestion_worker.audit_historical_regulation_denominator_expansion",
    "campus_ingestion_worker.audit_historical_regulation_school_level_inventory",
    "campus_ingestion_worker.audit_historical_regulation_school_level_owner_recovery",
    "campus_ingestion_worker.audit_authenticated_notice_browser_url_bundles",
    "campus_ingestion_worker.audit_internal_notice_regulation_selected_cohort",
    "campus_ingestion_worker.backfill_authenticated_notice_browser_urls",
    "campus_ingestion_worker.backfill_collected_notice_regulation_canonical",
    "campus_ingestion_worker.backfill_historical_regulation_denominator_expansion",
    "campus_ingestion_worker.backfill_missing_canonical_markdown_from_document_units",
    "campus_ingestion_worker.create_authenticated_notice_smoke_replay_run",
    "campus_ingestion_worker.generate_regulation_rag_release_selected_replay",
    "campus_ingestion_worker.official_web_historical_backfill",
    "campus_ingestion_worker.plan_historical_regulation_chunk_backfill",
    "campus_ingestion_worker.prepare_historical_regulation_chunk_backfill",
    "campus_ingestion_worker.purge_wechat_public_notices",
    "campus_ingestion_worker.repair_internal_notice_read_model_consistency",
    "campus_ingestion_worker.repair_rag_release_metadata",
    "campus_ingestion_worker.reset_collected_notice_consumption_state",
    "campus_ingestion_worker.reset_authenticated_common_download_downstream_state",
    "campus_ingestion_worker.reset_wechat_public_notice_downstream_state",
    "campus_ingestion_worker.select_authenticated_notice_bundle",
    "campus_ingestion_worker.smoke_authenticated_notice_bootstrap",
    "campus_ingestion_worker.smoke_authenticated_notice_bootstrap_local",
    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e",
    "campus_ingestion_worker.smoke_structured_projection_postgres",
    "campus_ingestion_worker.smoke_wechat_public_notice_phase5",
    "campus_ingestion_worker.smoke_wechat_public_notice_runtime",
    "campus_ingestion_worker.closeout_authenticated_notice_historical_backfill",
)

REMOVED_CORE_MODULES = ("campus_ingestion_core.collected_notice_consumption_reset",)

REMOVED_MODULE_FILES = (
    *(
        REPO_ROOT / "apps" / "ingestion-worker" / "src" / Path(module.replace(".", "/") + ".py")
        for module in REMOVED_ACTIVE_MODULES
    ),
    *(
        REPO_ROOT / "packages" / "ingestion-core" / "src" / Path(module.replace(".", "/") + ".py")
        for module in REMOVED_CORE_MODULES
    ),
)
REMOVED_SCAN_NEEDLES = REMOVED_ACTIVE_MODULES + REMOVED_CORE_MODULES

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
    Path("docs/reference/ingestion-python-cli-clean-target-triage.md"),
    Path("tests/infra/test_ingestion_python_clean_target_residue.py"),
}

ALLOWLISTED_PREFIXES = (
    ("docs", "reference", "archive"),
    ("docs", "runbooks", "archive"),
)


def _is_allowlisted(path: Path) -> bool:
    relative = path.relative_to(REPO_ROOT)
    if relative in ALLOWLISTED_PATHS:
        return True
    return any(relative.parts[: len(prefix)] == prefix for prefix in ALLOWLISTED_PREFIXES)


class IngestionPythonCleanTargetResidueTest(unittest.TestCase):
    def test_removed_clean_target_worker_modules_are_not_present(self) -> None:
        offenders = [
            str(path.relative_to(REPO_ROOT)) for path in REMOVED_MODULE_FILES if path.exists()
        ]

        self.assertFalse(
            offenders,
            "old ingestion Python clean-target modules must be deleted:\n" + "\n".join(offenders),
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
                for module in REMOVED_SCAN_NEEDLES:
                    if module in text:
                        offenders.append(f"{path.relative_to(REPO_ROOT)}: {module}")

        self.assertFalse(
            sorted(offenders),
            "active surfaces must not reference removed ingestion Python clean-target modules:\n"
            + "\n".join(sorted(offenders)),
        )


if __name__ == "__main__":
    unittest.main()
