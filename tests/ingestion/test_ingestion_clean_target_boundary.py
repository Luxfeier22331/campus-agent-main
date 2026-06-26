from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKER_MODULE_ROOT = REPO_ROOT / "apps/ingestion-worker/src/campus_ingestion_worker"
INGESTION_CORE_ROOT = REPO_ROOT / "packages/ingestion-core/src/campus_ingestion_core"

ALLOWED_WORKER_MODULES = {
    "__init__.py",
    "env_bootstrap.py",
    "normalize_authenticated_notice_legacy_office_attachment.py",
}

ALLOWED_ACTIVE_MODULE_REFS = {
    "campus_ingestion_worker.env_bootstrap",
    "campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment",
}

REMOVED_INGESTION_CORE_RUNTIME_FILES = {
    "authenticated_notice_run_queue_consumer.py",
    "authenticated_notice_run_queue_consumer_models.py",
    "authenticated_notice_run_queue_consumer_projection.py",
    "authenticated_notice_run_queue_consumer_support.py",
    "collected_notice_queue_consumer.py",
    "collected_notice_classification.py",
    "collected_notice_downstream_pilot.py",
    "collected_notice_fact_readiness.py",
    "collected_notice_fact_state_contract.py",
    "collected_notice_regulation_historical_offline_admission.py",
    "collected_notice_historical_enqueue.py",
    "collected_notice_ingest_queue.py",
    "collected_notice_ingest_queue_memory.py",
    "collected_notice_ingest_queue_postgres.py",
    "collected_notice_ingest_queue_store.py",
    "collected_notice_media_closeout_state_machine_audit.py",
    "collected_notice_media_closeout_state_machine_audit_support.py",
    "collected_notice_media_extraction_attempt_ledger.py",
    "collected_notice_media_extraction_closeout.py",
    "collected_notice_media_lifecycle.py",
    "collected_notice_media_role_classifier.py",
    "collected_notice_media_source_object_verification.py",
    "collected_notice_multimodal_readiness.py",
    "collected_notice_multimodal_readiness_candidates.py",
    "collected_notice_multimodal_readiness_reports.py",
    "collected_notice_multimodal_readiness_shared.py",
    "collected_notice_regulation_admission.py",
    "collected_notice_regulation_admission_reports.py",
    "collected_notice_regulation_admission_support.py",
    "collected_notice_regulation_batch_admission_audit.py",
    "collected_notice_regulation_canonical_backfill.py",
    "collected_notice_regulation_document_units.py",
    "collected_notice_regulation_first_batch_documents.py",
    "collected_notice_regulation_first_batch_evidence.py",
    "collected_notice_regulation_first_batch_helpers.py",
    "collected_notice_regulation_first_batch_promotion.py",
    "collected_notice_regulation_first_batch_provenance.py",
    "collected_notice_regulation_manual_review_admission.py",
    "collected_notice_regulation_materialization_preview.py",
    "collected_notice_regulation_owner_text_execution.py",
    "collected_notice_regulation_owner_text_recovery.py",
    "collected_notice_regulation_owner_text_recovery_constants.py",
    "collected_notice_regulation_owner_text_recovery_models.py",
    "collected_notice_regulation_text_normalization.py",
    "collected_notice_reimport_preview.py",
    "collected_notice_reimport_preview_models.py",
    "collected_notice_reimport_preview_outputs.py",
    "collected_notice_reimport_preview_source_refs.py",
    "collected_notice_replay_closeout_acceptance.py",
    "collected_notice_schedule_image_ocr_mini_batch.py",
    "collected_notice_service_status_downstream_replay.py",
    "collected_notice_transport_baseline_policy.py",
    "historical_regulation_chunk_backfill.py",
    "historical_regulation_denominator_body_text_admission.py",
    "historical_regulation_denominator_expansion.py",
    "historical_regulation_school_level_inventory.py",
    "historical_regulation_school_level_owner_recovery.py",
    "index_release.py",
    "index_release_acceptance.py",
    "index_release_chunk_quality.py",
    "index_release_hashing.py",
    "index_release_models.py",
    "index_release_registry_restore.py",
    "index_release_validation.py",
    "local_rebuild.py",
    "local_rebuild_documents.py",
    "local_rebuild_indexing.py",
    "local_rebuild_replay.py",
    "local_rebuild_runtime.py",
    "local_rebuild_support.py",
    "official_web_release_task.py",
    "official_web_release_task_admission.py",
    "official_web_release_task_projection.py",
    "official_web_release_task_store.py",
    "official_web_release_task_store_models.py",
    "official_web_release_task_store_rows.py",
    "academic_calendar_projection.py",
    "contact_directory_projection.py",
    "service_catalog_projection.py",
    "service_guide_projection.py",
    "service_guide_projection_constants.py",
    "service_guide_projection_curated.py",
    "service_guide_projection_flow_graph.py",
    "service_guide_projection_models.py",
    "service_guide_projection_release.py",
    "service_guide_projection_support.py",
    "service_guide_projection_validation.py",
    "service_status_projection.py",
    "transport_schedule_projection.py",
    "transport_schedule_projection_routes.py",
    "transport_schedule_projection_validation.py",
    "official_web_chunking_audit.py",
    "official_web_regulation_materialization.py",
    "qdrant_backup.py",
    "qdrant_backup_cleanup.py",
    "qdrant_backup_io.py",
    "qdrant_backup_manifest_helpers.py",
    "qdrant_backup_models.py",
    "qdrant_backup_retention_audit.py",
    "qdrant_filesystem_backup.py",
    "registry_scope_chunk_preparation.py",
    "registry_scope_chunk_preparation_helpers.py",
    "registry_scope_chunk_preparation_models.py",
    "registry_scope_chunk_provenance.py",
    "registry_scope_release.py",
    "registry_scope_release_audit.py",
    "registry_scope_release_support.py",
    "regulation_rag_release_admission.py",
    "regulation_rag_release_candidate_helpers.py",
    "regulation_rag_release_lane.py",
    "regulation_rag_release_manifest_audit.py",
    "regulation_rag_release_models.py",
    "raw_ingestion.py",
    "raw_ingestion_source_truth_execution.py",
    "scope_alias.py",
    "serving_seed_package.py",
    "source_handoff_execution.py",
    "source_handoff_no_serving_gate.py",
    "source_handoff_operator_projection.py",
    "source_handoff_postgres.py",
    "source_handoff_projection.py",
    "source_handoff_state_machine.py",
    "source_handoff_store.py",
    "source_handoff_validation.py",
    "authenticated_notice_processing_projection.py",
    "authenticated_notice_processing_projection_backfill.py",
    "authenticated_notice_run_enqueue.py",
    "authenticated_notice_run_processing_projection.py",
    "authenticated_notice_run_processing_projection_backfill.py",
    "verified_authenticated_notice_run_enqueue_scan.py",
}

REMOVED_PYTHON_ONLINE_RAG_PACKAGE_ROOTS = {
    Path("packages/knowledge-capability/src/campus_knowledge_capability"),
    Path("packages/retrieval-core/src/campus_retrieval_core"),
}

REMOVED_PUBLIC_INGESTION_CORE_EXPORTS = {
    "OFFICIAL_WEB_PROJECTION_CHUNKING_AUDIT_SCHEMA_VERSION",
    "OfficialWebProjectionChunkingAuditDocumentReport",
    "OfficialWebProjectionChunkingAuditReport",
    "OfficialWebRegulationMaterializationReport",
    "OnlineOcrClient",
    "OnlineOcrProviderResult",
    "RawIngestionRequest",
    "audit_official_web_projection_chunking",
    "build_official_web_regulation_candidate_documents",
    "materialize_official_web_regulation_candidates",
    "process_raw_ingestion_job",
}

ACTIVE_REFERENCE_ROOTS = (
    REPO_ROOT / "apps",
    REPO_ROOT / "configs",
    REPO_ROOT / "docs",
    REPO_ROOT / "infra",
    REPO_ROOT / "packages",
    REPO_ROOT / "scripts",
    REPO_ROOT / "tests",
)

REFERENCE_ALLOWLIST = {
    Path("tests/infra/test_ingestion_python_clean_target_residue.py"),
    Path("tests/ingestion/test_ingestion_clean_target_boundary.py"),
}

TEXT_SUFFIXES = {
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


class IngestionCleanTargetBoundaryTest(unittest.TestCase):
    def test_ingestion_worker_contains_only_python_adapter_island_modules(self) -> None:
        modules = {path.name for path in WORKER_MODULE_ROOT.glob("*.py")}

        self.assertEqual(modules, ALLOWED_WORKER_MODULES)

    def test_ingestion_worker_package_exports_only_adapter_island_symbols(self) -> None:
        package_init = (WORKER_MODULE_ROOT / "__init__.py").read_text(encoding="utf-8")

        self.assertNotIn("_EXPORTS", package_init)
        self.assertNotIn("__getattr__", package_init)
        self.assertNotIn("_main", package_init)
        self.assertNotIn(
            "normalize_authenticated_notice_legacy_office_attachment import", package_init
        )

    def test_ingestion_worker_package_and_image_do_not_carry_old_runtime_dependencies(
        self,
    ) -> None:
        pyproject = (REPO_ROOT / "apps/ingestion-worker/pyproject.toml").read_text(encoding="utf-8")
        dockerfile = (REPO_ROOT / "apps/ingestion-worker/Dockerfile").read_text(encoding="utf-8")

        for text in (pyproject, dockerfile):
            self.assertNotIn("campus-ingestion-contracts", text)
            self.assertNotIn("packages/ingestion-contracts", text)
            self.assertNotIn("packages/retrieval-core", text)
            self.assertNotIn("configs/ingestion", text)
            self.assertNotIn("COPY scripts", text)

    def test_ingestion_core_no_longer_contains_python_release_index_or_ops_runtime(self) -> None:
        offenders = sorted(
            file_name
            for file_name in REMOVED_INGESTION_CORE_RUNTIME_FILES
            if (INGESTION_CORE_ROOT / file_name).exists()
        )

        self.assertEqual(offenders, [])

    def test_python_online_rag_packages_are_removed_from_active_source(self) -> None:
        offenders = [
            str(package_root)
            for package_root in sorted(REMOVED_PYTHON_ONLINE_RAG_PACKAGE_ROOTS)
            if (REPO_ROOT / package_root).exists()
        ]

        self.assertEqual(offenders, [])

    def test_ingestion_core_package_root_does_not_export_legacy_lifecycle_facades(self) -> None:
        package_init = (INGESTION_CORE_ROOT / "__init__.py").read_text(encoding="utf-8")
        offenders = [
            exported_name
            for exported_name in sorted(REMOVED_PUBLIC_INGESTION_CORE_EXPORTS)
            if f'"{exported_name}"' in package_init
            or f" {exported_name}," in package_init
            or f"    {exported_name}," in package_init
        ]

        self.assertEqual(offenders, [])

    def test_active_tree_does_not_reference_removed_ingestion_core_runtime_modules(self) -> None:
        removed_modules = {
            f"campus_ingestion_core.{Path(file_name).stem}"
            for file_name in REMOVED_INGESTION_CORE_RUNTIME_FILES
        }
        pattern = re.compile(r"campus_ingestion_core\.[a-zA-Z0-9_]+")
        offenders: list[str] = []
        for root in ACTIVE_REFERENCE_ROOTS:
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                    continue
                relative_path = path.relative_to(REPO_ROOT)
                if relative_path in REFERENCE_ALLOWLIST or "archive" in relative_path.parts:
                    continue
                text = path.read_text(encoding="utf-8")
                for match in sorted(set(pattern.findall(text))):
                    if match in removed_modules:
                        offenders.append(f"{relative_path}: {match}")

        self.assertEqual(offenders, [])

    def test_default_task_registries_do_not_use_python_adapters(self) -> None:
        registry_paths = sorted((REPO_ROOT / "configs/ingestion").glob("**/task-registry.v1.json"))
        self.assertTrue(registry_paths, "expected default task registries to exist")

        offenders: list[str] = []
        for registry_path in registry_paths:
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            for task in registry.get("tasks", []):
                executor_kind = task.get("executor_kind")
                if executor_kind == "python_adapter":
                    offenders.append(
                        f"{registry_path.relative_to(REPO_ROOT)}:{task.get('task_kind')}"
                    )
                if task.get("task_kind") == "alias_publish" and executor_kind != "ts_control":
                    offenders.append(
                        f"{registry_path.relative_to(REPO_ROOT)}:alias_publish must be ts_control"
                    )

        self.assertEqual(offenders, [])

    def test_active_tree_does_not_reference_legacy_worker_modules(self) -> None:
        offenders: list[str] = []
        pattern = re.compile(r"campus_ingestion_worker\.[a-zA-Z0-9_]+")
        for root in ACTIVE_REFERENCE_ROOTS:
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                    continue
                relative_path = path.relative_to(REPO_ROOT)
                if relative_path in REFERENCE_ALLOWLIST or "archive" in relative_path.parts:
                    continue
                text = path.read_text(encoding="utf-8")
                for match in sorted(set(pattern.findall(text))):
                    if match not in ALLOWED_ACTIVE_MODULE_REFS:
                        offenders.append(f"{relative_path}: {match}")

        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
