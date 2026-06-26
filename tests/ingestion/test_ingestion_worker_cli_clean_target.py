from __future__ import annotations

import tomllib
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
INGESTION_WORKER_PYPROJECT = REPO_ROOT / "apps/ingestion-worker/pyproject.toml"
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

REMOVED_PUBLIC_CLI_NAMES = {
    "campus-ingestion-admit-official-web-release-gate",
    "campus-ingestion-admit-regulation-rag-release",
    "campus-ingestion-admit-reviewed-attachment-ocr-results",
    "campus-ingestion-admit-schedule-image-ocr-results",
    "campus-ingestion-audit-authenticated-notice-browser-url-bundles",
    "campus-ingestion-audit-authenticated-notice-closeout-operations-retention",
    "campus-ingestion-audit-authenticated-notice-object-locators",
    "campus-ingestion-audit-authenticated-notice-source-attachment-keys",
    "campus-ingestion-audit-authenticated-notice-source-run-retention",
    "campus-ingestion-audit-collection-runtime-state",
    "campus-ingestion-audit-historical-regulation-denominator-expansion",
    "campus-ingestion-audit-historical-regulation-school-level-inventory",
    "campus-ingestion-audit-historical-regulation-school-level-owner-recovery",
    "campus-ingestion-audit-internal-notice-regulation-selected-cohort",
    "campus-ingestion-audit-official-web-projection-chunking",
    "campus-ingestion-audit-qdrant-backup-retention",
    "campus-ingestion-audit-wechat-public-notice-state",
    "campus-ingestion-backfill-authenticated-notice-browser-urls",
    "campus-ingestion-backfill-collected-notice-regulation-canonical",
    "campus-ingestion-backfill-historical-regulation-denominator-expansion",
    "campus-ingestion-backfill-missing-canonical-markdown",
    "campus-ingestion-backfill-official-web-history",
    "campus-ingestion-build-authenticated-notice-attachment-fetch-request-manifest",
    "campus-ingestion-build-internal-notice-regulation-owner-recovery",
    "campus-ingestion-build-service-guide-projection",
    "campus-ingestion-build-service-status-projection",
    "campus-ingestion-build-transport-schedule-projection",
    "campus-ingestion-check-authenticated-notice-attachment-fetch-status",
    "campus-ingestion-check-authenticated-notice-reference-only-attachments",
    "campus-ingestion-check-internal-notice-processing-gaps",
    "campus-ingestion-check-internal-notice-read-model-consistency",
    "campus-ingestion-cleanup-authenticated-notice-closeout-operations",
    "campus-ingestion-cleanup-authenticated-notice-source-attachment-keys",
    "campus-ingestion-cleanup-authenticated-notice-source-runs",
    "campus-ingestion-cleanup-derived-bucket-unexpected-keys",
    "campus-ingestion-collection-rename-registry-backfill",
    "campus-ingestion-compare-online-ocr",
    "campus-ingestion-consume-authenticated-notice-ingest-queue",
    "campus-ingestion-consume-official-web-handoffs",
    "campus-ingestion-consume-source-handoff-executions",
    "campus-ingestion-create-authenticated-notice-smoke-replay-run",
    "campus-ingestion-drain-internal-notice-pending-multimodal",
    "campus-ingestion-drain-wechat-public-notice-pending-multimodal",
    "campus-ingestion-enqueue-authenticated-notice-collector-run",
    "campus-ingestion-enqueue-regulation-rag-release-candidates",
    "campus-ingestion-enqueue-verified-authenticated-notice-runs",
    "campus-ingestion-evaluate-internal-notice-multimodal-decisions",
    "campus-ingestion-export-serving-seed",
    "campus-ingestion-generate-regulation-rag-release-selected-replay",
    "campus-ingestion-import-authenticated-common-download-export",
    "campus-ingestion-import-authenticated-notice-export",
    "campus-ingestion-import-authenticated-notice-file-release-export",
    "campus-ingestion-import-official-web-projection",
    "campus-ingestion-list-internal-notice-consumption-admissions",
    "campus-ingestion-list-internal-notice-service-status-candidates",
    "campus-ingestion-manage-structured-projection-release",
    "campus-ingestion-materialize-curriculum-program-semester-facts",
    "campus-ingestion-normalize-authenticated-notice-legacy-office-attachment",
    "campus-ingestion-official-web-handoff-dev",
    "campus-ingestion-plan-historical-regulation-chunk-backfill",
    "campus-ingestion-preflight",
    "campus-ingestion-prepare-historical-regulation-chunk-backfill",
    "campus-ingestion-preview-collected-notice-media-extraction-closeout",
    "campus-ingestion-probe-regulation-rag-release-runtime",
    "campus-ingestion-process-internal-notice-multimodal",
    "campus-ingestion-process-regulation-rag-release-candidates",
    "campus-ingestion-project-wechat-public-notices",
    "campus-ingestion-project-wechat-public-notices-from-capture-run",
    "campus-ingestion-promote-collected-notice-regulation-manual-review-batch",
    "campus-ingestion-prune-reports",
    "campus-ingestion-publish-document-reader-assets",
    "campus-ingestion-purge-wechat-public-notices",
    "campus-ingestion-qdrant-backup-cleanup",
    "campus-ingestion-qdrant-filesystem-backup-create",
    "campus-ingestion-qdrant-gc-check",
    "campus-ingestion-qdrant-gc-delete",
    "campus-ingestion-re-audit-regulation-rag-release",
    "campus-ingestion-rebuild-internal-notice-consumption-projection",
    "campus-ingestion-rebuild-internal-notice-read-model",
    "campus-ingestion-reconstruct-rag-release-manifests",
    "campus-ingestion-record-authenticated-notice-attachment-fetch-status",
    "campus-ingestion-release-official-web-selected-write",
    "campus-ingestion-release-official-web-target",
    "campus-ingestion-release-registry-scope",
    "campus-ingestion-repair-internal-notice-read-model-consistency",
    "campus-ingestion-repair-rag-release-metadata",
    "campus-ingestion-reset-authenticated-common-download-downstream-state",
    "campus-ingestion-reset-wechat-public-notice-downstream-state",
    "campus-ingestion-restore-serving-seed",
    "campus-ingestion-run-control-task-once",
    "campus-ingestion-run-official-web-release-task",
    "campus-ingestion-run-official-web-university-collection",
    "campus-ingestion-run-on-demand-batch",
    "campus-ingestion-schedule-batch-preview-gate",
    "campus-ingestion-schedule-image-ocr-dry-run",
    "campus-ingestion-schedule-router-dry-run",
    "campus-ingestion-schedule-transport-preview-gate",
    "campus-ingestion-scope-alias",
    "campus-ingestion-select-authenticated-notice-bundle",
    "campus-ingestion-show-authenticated-document-holding-status",
    "campus-ingestion-show-authenticated-notice-attachment-fetch-status",
    "campus-ingestion-show-internal-notice-consumption-projection-status",
    "campus-ingestion-show-source-handoff-executions",
    "campus-ingestion-smoke-authenticated-notice-ingest-queue-e2e",
    "campus-ingestion-smoke-internal-notice-consumption-runtime",
    "campus-ingestion-smoke-structured-projection-postgres",
    "campus-ingestion-smoke-wechat-public-notice-phase5",
    "campus-ingestion-smoke-wechat-public-notice-runtime",
    "campus-ingestion-validate-internal-notice-chunking",
    "campus-ingestion-verify-serving-seed",
}


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
        references: list[str] = []
        for root in ACTIVE_REFERENCE_ROOTS:
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                    continue
                if "archive" in path.relative_to(REPO_ROOT).parts:
                    continue
                text = path.read_text(encoding="utf-8")
                for cli_name in sorted(REMOVED_PUBLIC_CLI_NAMES):
                    if cli_name in text:
                        references.append(f"{path.relative_to(REPO_ROOT)}: {cli_name}")

        self.assertFalse(
            references,
            "triaged Python CLI names must not remain in active references:\n"
            + "\n".join(references),
        )


if __name__ == "__main__":
    unittest.main()
