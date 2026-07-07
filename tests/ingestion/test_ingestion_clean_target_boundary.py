from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

from tests.ingestion.clean_target_boundary_support import (
    REMOVED_TEST_ONLY_INGESTION_CORE_PYTHON_TESTS,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
INGESTION_CORE_PACKAGE_ROOT = REPO_ROOT / "packages/ingestion-core"

REMOVED_PYTHON_ONLINE_RAG_PACKAGE_ROOTS = {
    Path("packages") / "knowledge-tool" / "src" / "campus_knowledge_tool",
    Path("packages/retrieval-core/src/campus_retrieval_core"),
}

REMOVED_INTERNAL_NOTICE_PYTHON_PROCESSOR_TERMS = {
    "INTERNAL_NOTICE_MULTIMODAL_API_KEY",
    "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_DATABASE_URL",
    "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_DATABASE_URL",
    "INTERNAL_NOTICE_MULTIMODAL_MODEL",
    "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_API_KEY",
    "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_DATABASE_URL",
    "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_OPERATOR_DATABASE_URL",
    "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_MODEL",
    "InternalNoticeMultimodalAttempt",
    "InternalNoticeMultimodalProcessor",
    "PostgresInternalNoticeMultimodalAttemptStore",
    "PostgresScheduleImageOcrAttemptStore",
    "ScheduleImageOcrAttempt",
    "ScheduleImageOcrProvider",
    "build_internal_notice_multimodal_attempt_store_from_env",
    "build_internal_notice_multimodal_processor_from_env",
    "build_schedule_image_ocr_attempt_store_from_env",
    "evaluate_internal_notice_multimodal_decisions_jsonl",
    "evaluate_internal_notice_multimodal_visual_jsonl",
    "ingestion_projection.internal_notice_multimodal_attempt",
    "ingestion_projection.internal_notice_schedule_image_ocr_attempt",
    "internal_notice_consumption_runtime_smoke",
    "internal_notice_multimodal_attempt",
    "internal_notice_multimodal_processing",
    "internal_notice_schedule_image_ocr",
    "internal_notice_schedule_image_ocr_attempt",
    "multimodal-decision-eval.v1.jsonl",
    "multimodal-visual-eval.v1.jsonl",
}

REMOVED_INGESTION_CORE_PROVIDER_CLIENT_TERMS = {
    "CURRICULUM_COURSE_MAP_MULTIMODAL_API_KEY",
    "HANDBOOK_SERVICE_NAVIGATION_API_KEY",
    "LegacyOfficeConversionClientProtocol",
    "SourceOcrClient",
    "conversion_client",
    "httpx.AsyncClient",
    "httpx.Client",
    "import httpx",
    "ocr_client",
    "ocr_clients",
}

REMOVED_INGESTION_CORE_FILE_RELEASE_PYTHON_MATERIALIZATION_TERMS = {
    "AuthenticatedDocumentHoldingStatus",
    "AuthenticatedNoticeFileReleaseInventory",
    "build_authenticated_document_holding_status_report",
    "file_release_inventory_store",
    "load_authenticated_notice_file_release_export",
    "resolve_file_release_owner_recovery_readiness",
}

REMOVED_INGESTION_CORE_LOCAL_REPORT_OUTPUT_TERMS = {
    "CurriculumCourseMapProbeReport",
    "HANDBOOK_VALIDATION_CACHE_DIR",
    "budget-eval-matrix.json",
    "budget-eval-report.md",
    "map-{detected_region.map_index:02d}.png",
    "map-{detected_region.map_index:02d}-tile-{tile_index:02d}.png",
    "output_path",
    "_resolve_validation_cache_dir",
    "_validation_cache_file_path",
    "_write_json",
}

REMOVED_INGESTION_CORE_OFFICIAL_WEB_LOCAL_OUTPUT_TERMS = {
    "canonical_markdown_path",
    "document_units_path",
    "projection-report.json",
    "projection_output_dir",
    "_build_document_output_dir",
    "_load_local_page_source_truth",
}

REMOVED_INGESTION_CORE_RUNTIME_NAMING_TERMS = {
    "AuthenticatedNoticeOcrProviderRuntime",
    "AuthenticatedNoticeOcrRuntime",
    "CollectionSourceOcrRuntime",
    "RawAssetTypeRefinement",
    "RawAssetTypedMetadata",
    "DerivedStructuredUnit",
    "HandbookCleanupResult",
    "_parse_attachment_with_ocr_runtimes",
    "build_curriculum_structured_units",
    "cleanup_handbook_document",
    "serialize_handbook_document_units",
    "_resolve_authenticated_notice_ocr_runtime",
    "infer_raw_asset_typed_metadata",
    "persist_raw_provider_artifact",
    "refine_raw_asset_typed_metadata_with_ocr_evidence",
    "resolve_collection_source_ocr_runtime",
    "resolve_object_store_bucket_names",
    "source_truth_common",
}

REMOVED_INGESTION_CONFIG_COLLECTIONS = {
    Path("configs/ingestion/authenticated_documents/common_download_source"),
    Path("configs/ingestion/calendar/academic_calendar"),
    Path("configs/ingestion/campus_navigation/place_catalog"),
    Path("configs/ingestion/campus_notices/file_release_capture"),
    Path("configs/ingestion/curriculum/curriculum_plan/course-map-probe-gold.v1.json"),
    Path("configs/ingestion/curriculum/curriculum_plan/course-map-probe-gold.v2.json"),
    Path("configs/ingestion/curriculum/curriculum_plan/course-map-probe-samples.v1.json"),
    Path("configs/ingestion/official_web/muc_public_pages"),
    Path("configs/ingestion/official_web/news_archive"),
    Path("configs/ingestion/public_docs/reader_assets"),
}

REMOVED_INGESTION_CONFIG_SCOPE_TOKENS = {
    "common_download_source",
    "file_release_capture",
    "muc_public_pages",
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

REFERENCE_ALLOWLIST_PREFIXES = (("docs", "decisions"),)

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
    def test_ingestion_worker_app_is_removed_from_active_workspace(self) -> None:
        self.assertFalse((REPO_ROOT / "apps/ingestion-worker").exists())

    def test_legacy_python_ingestion_core_package_is_removed(self) -> None:
        self.assertFalse(INGESTION_CORE_PACKAGE_ROOT.exists())

    def test_legacy_office_conversion_service_is_removed(self) -> None:
        self.assertFalse((REPO_ROOT / "apps/legacy-office-conversion-service").exists())
        self.assertFalse(
            (REPO_ROOT / "infra/local/docker-compose.legacy-office-conversion.yml").exists()
        )

    def test_app_api_is_not_a_python_workspace_package(self) -> None:
        app_api_root = REPO_ROOT / "apps/app-api"
        workspace_config = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")

        self.assertFalse((app_api_root / "pyproject.toml").exists())
        self.assertFalse((app_api_root / "src/campus_app_api").exists())
        self.assertNotIn('"apps/app-api"', workspace_config)

    def test_python_online_rag_packages_are_removed_from_active_source(self) -> None:
        offenders = [
            str(package_root)
            for package_root in sorted(REMOVED_PYTHON_ONLINE_RAG_PACKAGE_ROOTS)
            if (REPO_ROOT / package_root).exists()
        ]

        self.assertEqual(offenders, [])

    def test_ingestion_configs_do_not_keep_deleted_non_executable_collections(self) -> None:
        path_offenders = [
            str(path)
            for path in sorted(REMOVED_INGESTION_CONFIG_COLLECTIONS)
            if (REPO_ROOT / path).exists()
        ]

        text_offenders: list[str] = []
        for root in (REPO_ROOT / "configs/ingestion", REPO_ROOT / "configs/sources"):
            if not root.exists():
                continue
            for path in sorted(root.rglob("*")):
                if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                    continue
                text = path.read_text(encoding="utf-8")
                for term in sorted(REMOVED_INGESTION_CONFIG_SCOPE_TOKENS):
                    if term in text:
                        text_offenders.append(f"{path.relative_to(REPO_ROOT)}: {term}")

        self.assertEqual(path_offenders, [])
        self.assertEqual(text_offenders, [])

    def test_ingestion_does_not_keep_test_only_python_residue(self) -> None:
        removed_files = (
            (REPO_ROOT / "tests/ingestion", REMOVED_TEST_ONLY_INGESTION_CORE_PYTHON_TESTS),
        )
        offenders = [
            str((root / file_name).relative_to(REPO_ROOT))
            for root, file_names in removed_files
            for file_name in sorted(file_names)
            if (root / file_name).exists()
        ]

        self.assertEqual(offenders, [])

    def test_python_test_support_does_not_keep_retired_attachment_fetch_status_store(
        self,
    ) -> None:
        notice_stores = (REPO_ROOT / "tests/support/notice_stores.py").read_text(encoding="utf-8")

        self.assertNotIn(
            "InMemoryAuthenticatedNoticeAttachmentFetchStatusStore",
            notice_stores,
        )
        self.assertNotIn(
            "AuthenticatedNoticeAttachmentFetchStatusRecord",
            notice_stores,
        )
        self.assertNotIn(
            "InMemoryAuthenticatedNoticeSourceTruthInventoryStore",
            notice_stores,
        )
        self.assertNotIn(
            "InMemoryInternalNoticeReadModelStore",
            notice_stores,
        )

    def test_active_tree_does_not_reference_removed_ingestion_core_package(self) -> None:
        pattern = re.compile(r"campus_ingestion_core\.[a-zA-Z0-9_]+")
        offenders: list[str] = []
        for root in ACTIVE_REFERENCE_ROOTS:
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                    continue
                relative_path = path.relative_to(REPO_ROOT)
                if (
                    relative_path in REFERENCE_ALLOWLIST
                    or "archive" in relative_path.parts
                    or any(
                        relative_path.parts[: len(prefix)] == prefix
                        for prefix in REFERENCE_ALLOWLIST_PREFIXES
                    )
                ):
                    continue
                text = path.read_text(encoding="utf-8")
                for match in sorted(set(pattern.findall(text))):
                    offenders.append(f"{relative_path}: {match}")
                if "packages/ingestion-core" in text:
                    offenders.append(f"{relative_path}: packages/ingestion-core")

        self.assertEqual(offenders, [])

    def test_default_task_registries_do_not_use_python_adapters(self) -> None:
        registry_paths = sorted((REPO_ROOT / "configs/ingestion").glob("**/task-registry.v2.json"))
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
        self.assertEqual(offenders, [])

    def test_wechat_public_notice_registry_declares_real_source_truth_materializer(self) -> None:
        registry_path = (
            REPO_ROOT
            / "configs/ingestion/campus_notices/wechat_public_notice/task-registry.v2.json"
        )
        registry = json.loads(registry_path.read_text(encoding="utf-8"))

        self.assertEqual(registry["source_family"], "wechat_public_notice")
        self.assertEqual(registry["corpus"], "campus_notices")
        self.assertEqual(registry["collection"], "wechat_public_notice")
        expected = {
            "task_kind": "source_truth_materialize",
            "executor_kind": "ts_control",
            "input_contract": "wechat_official_account_capture_release.v1",
            "output_contract": "wechat_official_account_source_truth.v1",
            "registry_task_id": "source_truth_materialize",
        }
        self.assertTrue(
            any(
                all(task.get(key) == value for key, value in expected.items())
                for task in registry["tasks"]
            ),
            registry["tasks"],
        )

    def test_ingestion_control_temporal_worker_wires_wechat_public_notice_materializer(
        self,
    ) -> None:
        runtime_text = (REPO_ROOT / "apps/ingestion-control/src/temporal-worker.ts").read_text(
            encoding="utf-8"
        )

        self.assertIn("wechatOfficialAccountObjectStore: objectStore", runtime_text)


if __name__ == "__main__":
    unittest.main()
