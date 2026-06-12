from __future__ import annotations

import re
import tomllib
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
INGESTION_WORKER_PYPROJECT = REPO_ROOT / "apps/ingestion-worker/pyproject.toml"
CLI_TRIAGE_REFERENCE = REPO_ROOT / "docs/reference/ingestion-python-cli-clean-target-triage.md"
ACTIVE_REFERENCE_ROOTS = (
    REPO_ROOT / "apps",
    REPO_ROOT / "configs",
    REPO_ROOT / "docs",
    REPO_ROOT / "packages",
    REPO_ROOT / "scripts",
)
TEXT_SUFFIXES = {
    ".env",
    ".json",
    ".md",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".yaml",
    ".yml",
}
REFERENCE_ALLOWLIST = {
    CLI_TRIAGE_REFERENCE,
}

REMOVED_PUBLIC_CLI_NAMES = {
    "campus-ingestion-audit-official-web-projection-chunking",
    "campus-ingestion-compare-online-ocr",
    "campus-ingestion-backfill-official-web-history",
    "campus-ingestion-backfill-authenticated-notice-browser-urls",
    "campus-ingestion-audit-authenticated-notice-browser-url-bundles",
    "campus-ingestion-select-authenticated-notice-bundle",
    "campus-ingestion-smoke-structured-projection-postgres",
    "campus-ingestion-collection-rename-registry-backfill",
    "campus-ingestion-check-authenticated-notice-reference-only-attachments",
    "campus-ingestion-create-authenticated-notice-smoke-replay-run",
    "campus-ingestion-smoke-authenticated-notice-ingest-queue-e2e",
    "campus-ingestion-official-web-handoff-dev",
    "campus-ingestion-probe-regulation-rag-release-runtime",
    "campus-ingestion-repair-rag-release-metadata",
    "campus-ingestion-generate-regulation-rag-release-selected-replay",
    "campus-ingestion-backfill-collected-notice-regulation-canonical",
    "campus-ingestion-backfill-missing-canonical-markdown",
    "campus-ingestion-audit-historical-regulation-denominator-expansion",
    "campus-ingestion-audit-historical-regulation-school-level-inventory",
    "campus-ingestion-audit-historical-regulation-school-level-owner-recovery",
    "campus-ingestion-backfill-historical-regulation-denominator-expansion",
    "campus-ingestion-plan-historical-regulation-chunk-backfill",
    "campus-ingestion-prepare-historical-regulation-chunk-backfill",
    "campus-ingestion-audit-internal-notice-regulation-selected-cohort",
    "campus-ingestion-project-wechat-public-notices-from-capture-run",
    "campus-ingestion-smoke-wechat-public-notice-phase5",
    "campus-ingestion-smoke-wechat-public-notice-runtime",
    "campus-ingestion-purge-wechat-public-notices",
    "campus-ingestion-reset-wechat-public-notice-downstream-state",
    "campus-ingestion-repair-internal-notice-read-model-consistency",
    "campus-ingestion-preview-collected-notice-media-extraction-closeout",
    "campus-ingestion-schedule-router-dry-run",
    "campus-ingestion-schedule-batch-preview-gate",
    "campus-ingestion-schedule-transport-preview-gate",
    "campus-ingestion-smoke-internal-notice-consumption-runtime",
    "campus-ingestion-evaluate-internal-notice-multimodal-decisions",
}


def load_triaged_public_cli_names() -> set[str]:
    text = CLI_TRIAGE_REFERENCE.read_text(encoding="utf-8")
    return set(re.findall(r"`(campus-ingestion-[a-z0-9-]+)`", text))


class IngestionWorkerCliCleanTargetTest(unittest.TestCase):
    def test_ingestion_worker_does_not_publish_python_console_scripts(self) -> None:
        pyproject = tomllib.loads(INGESTION_WORKER_PYPROJECT.read_text(encoding="utf-8"))

        self.assertNotIn(
            "scripts",
            pyproject["project"],
            "apps/ingestion-worker must not publish Python console scripts; "
            "use ingestion-control tasks, TS/Rust rebuilds, or private python -m adapters",
        )

    def test_delete_and_archive_triage_clis_are_not_public_console_scripts(self) -> None:
        pyproject = tomllib.loads(INGESTION_WORKER_PYPROJECT.read_text(encoding="utf-8"))
        scripts = set(pyproject["project"].get("scripts", {}))

        self.assertFalse(
            REMOVED_PUBLIC_CLI_NAMES & scripts,
            "delete/archive triage CLIs must not remain public console scripts",
        )

    def test_triaged_python_clis_are_not_active_references(self) -> None:
        triaged_cli_names = load_triaged_public_cli_names()
        references: list[str] = []
        for root in ACTIVE_REFERENCE_ROOTS:
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                    continue
                if path in REFERENCE_ALLOWLIST:
                    continue
                if "archive" in path.relative_to(REPO_ROOT).parts:
                    continue
                text = path.read_text(encoding="utf-8")
                for cli_name in sorted(triaged_cli_names):
                    if cli_name in text:
                        references.append(f"{path.relative_to(REPO_ROOT)}: {cli_name}")

        self.assertFalse(
            references,
            "triaged Python CLI names must not remain in active references:\n"
            + "\n".join(references),
        )


if __name__ == "__main__":
    unittest.main()
