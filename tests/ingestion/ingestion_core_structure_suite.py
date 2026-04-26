from __future__ import annotations

import unittest
from pathlib import Path

INGESTION_CORE = Path("packages/ingestion-core/src/campus_ingestion_core")
SERVICE_GUIDE_PROJECTION = INGESTION_CORE / "service_guide_projection.py"
SERVICE_GUIDE_PROJECTION_CONSTANTS = INGESTION_CORE / "service_guide_projection_constants.py"
SERVICE_GUIDE_PROJECTION_MODELS = INGESTION_CORE / "service_guide_projection_models.py"
SERVICE_GUIDE_PROJECTION_VALIDATION = INGESTION_CORE / "service_guide_projection_validation.py"
SERVICE_GUIDE_PROJECTION_CURATED = INGESTION_CORE / "service_guide_projection_curated.py"
SERVICE_GUIDE_PROJECTION_FLOW_GRAPH = INGESTION_CORE / "service_guide_projection_flow_graph.py"
NOTICE_CONSUMPTION_PROJECTION = INGESTION_CORE / "internal_notice_consumption_projection.py"
NOTICE_CONSUMPTION_PROJECTION_MODELS = (
    INGESTION_CORE / "internal_notice_consumption_projection_models.py"
)
NOTICE_CONSUMPTION_PROJECTION_MULTIMODAL = (
    INGESTION_CORE / "internal_notice_consumption_projection_multimodal.py"
)
NOTICE_CONSUMPTION_PROJECTION_STATUS = (
    INGESTION_CORE / "internal_notice_consumption_projection_status.py"
)
NOTICE_ROUTING_SAMPLING = INGESTION_CORE / "authenticated_notice_routing_sampling.py"
NOTICE_ROUTING_SAMPLING_MODELS = INGESTION_CORE / "authenticated_notice_routing_sampling_models.py"
NOTICE_ROUTING_SAMPLING_POLICY = INGESTION_CORE / "authenticated_notice_routing_sampling_policy.py"
NOTICE_ROUTING_SAMPLING_REVIEW = INGESTION_CORE / "authenticated_notice_routing_sampling_review.py"
NOTICE_ROUTING_SAMPLING_SAMPLES = (
    INGESTION_CORE / "authenticated_notice_routing_sampling_samples.py"
)
NOTICE_FAMILY_TEST = Path("tests/ingestion/test_authenticated_notice_notice_family.py")
NOTICE_FAMILY_TEST_CONFIG = Path(
    "tests/ingestion/authenticated_notice_notice_family_config_suite.py"
)
NOTICE_FAMILY_TEST_CLASSIFICATION = Path(
    "tests/ingestion/authenticated_notice_notice_family_classification_suite.py"
)
NOTICE_FAMILY_TEST_SUPPORT = Path(
    "tests/ingestion/authenticated_notice_notice_family_test_support.py"
)
NOTICE_CONSUMPTION_TEST = Path("tests/ingestion/test_internal_notice_consumption_projection.py")
NOTICE_CONSUMPTION_TEST_CORE = Path(
    "tests/ingestion/internal_notice_consumption_projection_core_suite.py"
)
NOTICE_CONSUMPTION_TEST_ROUTING = Path(
    "tests/ingestion/internal_notice_consumption_projection_routing_suite.py"
)
NOTICE_CONSUMPTION_TEST_MULTIMODAL = Path(
    "tests/ingestion/internal_notice_consumption_projection_multimodal_suite.py"
)
NOTICE_CONSUMPTION_TEST_STATUS = Path(
    "tests/ingestion/internal_notice_consumption_projection_status_suite.py"
)
NOTICE_CONSUMPTION_TEST_STORE = Path(
    "tests/ingestion/internal_notice_consumption_projection_store_suite.py"
)
NOTICE_CONSUMPTION_TEST_SUPPORT = Path(
    "tests/ingestion/internal_notice_consumption_projection_test_support.py"
)
NOTICE_MULTIMODAL_PROCESSING = INGESTION_CORE / "internal_notice_multimodal_processing.py"
NOTICE_MULTIMODAL_PROCESSING_MODELS = (
    INGESTION_CORE / "internal_notice_multimodal_processing_models.py"
)
NOTICE_MULTIMODAL_PROCESSING_ATTEMPTS = (
    INGESTION_CORE / "internal_notice_multimodal_processing_attempts.py"
)
NOTICE_MULTIMODAL_PROCESSING_PROCESSOR = (
    INGESTION_CORE / "internal_notice_multimodal_processing_processor.py"
)
ATTACHMENT_FETCH_STATUS = INGESTION_CORE / "authenticated_notice_attachment_fetch_status.py"
ATTACHMENT_FETCH_STATUS_MODELS = (
    INGESTION_CORE / "authenticated_notice_attachment_fetch_status_models.py"
)
ATTACHMENT_FETCH_STATUS_STORE = (
    INGESTION_CORE / "authenticated_notice_attachment_fetch_status_store.py"
)
NOTICE_REGULATION_MATERIALIZATION = INGESTION_CORE / "internal_notice_regulation_materialization.py"
NOTICE_REGULATION_MATERIALIZATION_CANDIDATES = (
    INGESTION_CORE / "internal_notice_regulation_materialization_candidates.py"
)
CURRICULUM_PROVIDER_NORMALIZE_SHARED = INGESTION_CORE / "curriculum_provider_normalize_shared.py"
CURRICULUM_PROVIDER_TEXT_REPAIRS = INGESTION_CORE / "curriculum_provider_text_repairs.py"
CURRICULUM_PROVIDER_NORMALIZE_RELATIONSHIPS = (
    INGESTION_CORE / "curriculum_provider_normalize_relationships.py"
)
CURRICULUM_PROVIDER_TABLE_RELATIONSHIPS = (
    INGESTION_CORE / "curriculum_provider_table_relationships.py"
)
HANDBOOK_CLEANUP_NORMALIZE = INGESTION_CORE / "handbook_cleanup_normalize.py"
HANDBOOK_CLEANUP_TEXT_NORMALIZATION = INGESTION_CORE / "handbook_cleanup_text_normalization.py"
HANDBOOK_CLEANUP_OCR_REPAIRS = INGESTION_CORE / "handbook_cleanup_ocr_repairs.py"
HANDBOOK_CLEANUP_ARTICLE_BOUNDARIES = INGESTION_CORE / "handbook_cleanup_article_boundaries.py"
HANDBOOK_SOURCE_PROJECTIONS = INGESTION_CORE / "handbook_source_projections.py"
HANDBOOK_SOURCE_PROJECTION_MODELS = INGESTION_CORE / "handbook_source_projection_models.py"
CURRICULUM_PROVIDER_NORMALIZE_TEST = Path("tests/ingestion/test_curriculum_provider_normalize.py")
CURRICULUM_PROVIDER_NORMALIZE_TEXT_SUITE = Path(
    "tests/ingestion/curriculum_provider_normalize_text_repairs_suite.py"
)
CURRICULUM_PROVIDER_NORMALIZE_SECTION_SUITE = Path(
    "tests/ingestion/curriculum_provider_normalize_section_repairs_suite.py"
)
CURRICULUM_PROVIDER_NORMALIZE_TABLE_SUITE = Path(
    "tests/ingestion/curriculum_provider_normalize_table_repairs_suite.py"
)
CURRICULUM_PROVIDER_NORMALIZE_MISC_SUITE = Path(
    "tests/ingestion/curriculum_provider_normalize_misc_suite.py"
)
CURRICULUM_PROVIDER_NORMALIZE_TEST_SUPPORT = Path(
    "tests/ingestion/curriculum_provider_normalize_test_support.py"
)
NOTICE_REGULATION_MATERIALIZATION_TEST = Path(
    "tests/ingestion/test_internal_notice_regulation_materialization.py"
)
NOTICE_REGULATION_MATERIALIZATION_TARGET_SUITE = Path(
    "tests/ingestion/internal_notice_regulation_materialization_target_suite.py"
)
NOTICE_REGULATION_MATERIALIZATION_GATE_SUITE = Path(
    "tests/ingestion/internal_notice_regulation_materialization_gate_suite.py"
)
NOTICE_REGULATION_MATERIALIZATION_TEST_SUPPORT = Path(
    "tests/ingestion/internal_notice_regulation_materialization_test_support.py"
)
ATTACHMENT_FETCH_STATUS_WORKER_TEST = Path(
    "tests/ingestion/test_authenticated_notice_attachment_fetch_status_worker.py"
)
ATTACHMENT_FETCH_STATUS_WORKER_RECORD_SUITE = Path(
    "tests/ingestion/authenticated_notice_attachment_fetch_status_worker_record_suite.py"
)
ATTACHMENT_FETCH_STATUS_WORKER_REFERENCE_SUITE = Path(
    "tests/ingestion/authenticated_notice_attachment_fetch_status_worker_reference_suite.py"
)
ATTACHMENT_FETCH_STATUS_WORKER_CONTROL_SUITE = Path(
    "tests/ingestion/authenticated_notice_attachment_fetch_status_worker_control_suite.py"
)
ATTACHMENT_FETCH_STATUS_WORKER_TEST_SUPPORT = Path(
    "tests/ingestion/authenticated_notice_attachment_fetch_status_worker_test_support.py"
)


class IngestionCoreStructureTest(unittest.TestCase):
    def test_service_guide_projection_has_models_constants_and_validation_modules(self) -> None:
        projection_source = SERVICE_GUIDE_PROJECTION.read_text(encoding="utf-8")

        self.assertTrue(SERVICE_GUIDE_PROJECTION_CONSTANTS.exists())
        self.assertTrue(SERVICE_GUIDE_PROJECTION_MODELS.exists())
        self.assertTrue(SERVICE_GUIDE_PROJECTION_VALIDATION.exists())
        self.assertTrue(SERVICE_GUIDE_PROJECTION_CURATED.exists())
        self.assertTrue(SERVICE_GUIDE_PROJECTION_FLOW_GRAPH.exists())
        self.assertNotIn("class ServiceGuideProjectionBuildResult", projection_source)
        self.assertNotIn("class ServiceGuideSourceTruthManifest", projection_source)
        self.assertNotIn("SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION =", projection_source)
        self.assertNotIn("def validate_service_guide_projection_bundle", projection_source)
        self.assertNotIn("def _coerce_curated_service_guide_records", projection_source)
        self.assertNotIn("def _coerce_handbook_flow_graph_source", projection_source)
        self.assertLessEqual(len(projection_source.splitlines()), 800)

    def test_internal_notice_consumption_projection_has_model_and_multimodal_modules(
        self,
    ) -> None:
        projection_source = NOTICE_CONSUMPTION_PROJECTION.read_text(encoding="utf-8")

        self.assertTrue(NOTICE_CONSUMPTION_PROJECTION_MODELS.exists())
        self.assertTrue(NOTICE_CONSUMPTION_PROJECTION_MULTIMODAL.exists())
        self.assertTrue(NOTICE_CONSUMPTION_PROJECTION_STATUS.exists())
        self.assertNotIn("class NoticeConsumptionProjectionUnitStatus", projection_source)
        self.assertNotIn("class _MultimodalConsumptionDecision", projection_source)
        self.assertNotIn("NOTICE_MULTIMODAL_CONSUMPTION_POLICY_PROCESS =", projection_source)
        self.assertNotIn("def read_notice_consumption_projection_status", projection_source)
        self.assertNotIn("def check_internal_notice_processing_gaps", projection_source)
        self.assertLessEqual(len(projection_source.splitlines()), 1450)

    def test_authenticated_notice_routing_sampling_has_models_policy_review_and_samples_modules(
        self,
    ) -> None:
        routing_source = NOTICE_ROUTING_SAMPLING.read_text(encoding="utf-8")

        self.assertTrue(NOTICE_ROUTING_SAMPLING_MODELS.exists())
        self.assertTrue(NOTICE_ROUTING_SAMPLING_POLICY.exists())
        self.assertTrue(NOTICE_ROUTING_SAMPLING_REVIEW.exists())
        self.assertTrue(NOTICE_ROUTING_SAMPLING_SAMPLES.exists())
        self.assertNotIn("class AuthenticatedNoticeRoutingSample", routing_source)
        self.assertNotIn("def _sample_from_bundle_record", routing_source)
        self.assertNotIn("def _resolve_routing_decision", routing_source)
        self.assertNotIn("def _build_review_later_clusters", routing_source)
        self.assertLessEqual(len(routing_source.splitlines()), 520)

    def test_authenticated_notice_notice_family_tests_are_split_by_responsibility(
        self,
    ) -> None:
        legacy_test_source = NOTICE_FAMILY_TEST.read_text(encoding="utf-8")

        self.assertTrue(NOTICE_FAMILY_TEST_CONFIG.exists())
        self.assertTrue(NOTICE_FAMILY_TEST_CLASSIFICATION.exists())
        self.assertTrue(NOTICE_FAMILY_TEST_SUPPORT.exists())
        self.assertNotIn("class AuthenticatedNoticeNoticeFamilyConfigTest", legacy_test_source)
        self.assertNotIn(
            "class AuthenticatedNoticeNoticeFamilyClassificationTest",
            legacy_test_source,
        )
        self.assertLessEqual(len(legacy_test_source.splitlines()), 80)

    def test_internal_notice_consumption_projection_tests_are_split_by_responsibility(
        self,
    ) -> None:
        legacy_test_source = NOTICE_CONSUMPTION_TEST.read_text(encoding="utf-8")

        self.assertTrue(NOTICE_CONSUMPTION_TEST_CORE.exists())
        self.assertTrue(NOTICE_CONSUMPTION_TEST_ROUTING.exists())
        self.assertTrue(NOTICE_CONSUMPTION_TEST_MULTIMODAL.exists())
        self.assertTrue(NOTICE_CONSUMPTION_TEST_STATUS.exists())
        self.assertTrue(NOTICE_CONSUMPTION_TEST_STORE.exists())
        self.assertTrue(NOTICE_CONSUMPTION_TEST_SUPPORT.exists())
        self.assertNotIn("class InternalNoticeConsumptionProjectionTest", legacy_test_source)
        self.assertNotIn("class NoticeConsumptionProjectionPostgresStoreTest", legacy_test_source)
        self.assertLessEqual(len(legacy_test_source.splitlines()), 80)

    def test_internal_notice_multimodal_processing_has_models_attempts_and_processor_modules(
        self,
    ) -> None:
        processing_source = NOTICE_MULTIMODAL_PROCESSING.read_text(encoding="utf-8")

        self.assertTrue(NOTICE_MULTIMODAL_PROCESSING_MODELS.exists())
        self.assertTrue(NOTICE_MULTIMODAL_PROCESSING_ATTEMPTS.exists())
        self.assertTrue(NOTICE_MULTIMODAL_PROCESSING_PROCESSOR.exists())
        self.assertNotIn("class InternalNoticeMultimodalProcessingRequest", processing_source)
        self.assertNotIn("class PostgresInternalNoticeMultimodalAttemptStore", processing_source)
        self.assertNotIn(
            "class ChatCompletionsInternalNoticeMultimodalProcessor", processing_source
        )
        self.assertLessEqual(len(processing_source.splitlines()), 800)

    def test_authenticated_notice_attachment_fetch_status_has_models_and_store_modules(
        self,
    ) -> None:
        fetch_status_source = ATTACHMENT_FETCH_STATUS.read_text(encoding="utf-8")

        self.assertTrue(ATTACHMENT_FETCH_STATUS_MODELS.exists())
        self.assertTrue(ATTACHMENT_FETCH_STATUS_STORE.exists())
        self.assertNotIn(
            "class AuthenticatedNoticeAttachmentFetchStatusRecord", fetch_status_source
        )
        self.assertNotIn(
            "class PostgresAuthenticatedNoticeAttachmentFetchStatusStore", fetch_status_source
        )
        self.assertLessEqual(len(fetch_status_source.splitlines()), 800)

    def test_internal_notice_regulation_materialization_has_candidate_module(self) -> None:
        materialization_source = NOTICE_REGULATION_MATERIALIZATION.read_text(encoding="utf-8")

        self.assertTrue(NOTICE_REGULATION_MATERIALIZATION_CANDIDATES.exists())
        self.assertNotIn("class _CandidateAggregation", materialization_source)
        self.assertNotIn("def _build_projection_ready_aggregations", materialization_source)
        self.assertNotIn("def _build_projection_candidate_document", materialization_source)
        self.assertLessEqual(len(materialization_source.splitlines()), 800)

    def test_curriculum_provider_shared_delegates_provider_text_repairs(self) -> None:
        shared_source = CURRICULUM_PROVIDER_NORMALIZE_SHARED.read_text(encoding="utf-8")

        self.assertTrue(CURRICULUM_PROVIDER_TEXT_REPAIRS.exists())
        self.assertNotIn("def _repair_mineru_text_artifacts", shared_source)
        self.assertNotIn("def _repair_minority_preparatory_program_artifacts", shared_source)
        self.assertNotIn("def _repair_sentence_wraps", shared_source)
        self.assertLessEqual(len(shared_source.splitlines()), 800)

    def test_curriculum_provider_relationships_delegate_table_relationships(self) -> None:
        relationships_source = CURRICULUM_PROVIDER_NORMALIZE_RELATIONSHIPS.read_text(
            encoding="utf-8"
        )

        self.assertTrue(CURRICULUM_PROVIDER_TABLE_RELATIONSHIPS.exists())
        self.assertNotIn("def _repair_cross_page_table_continuations", relationships_source)
        self.assertNotIn("def _enrich_relationships", relationships_source)
        self.assertNotIn("def _assign_table_fragment_ids", relationships_source)
        self.assertLessEqual(len(relationships_source.splitlines()), 800)

    def test_handbook_cleanup_normalize_delegates_text_normalization(self) -> None:
        normalize_source = HANDBOOK_CLEANUP_NORMALIZE.read_text(encoding="utf-8")
        text_normalization_source = HANDBOOK_CLEANUP_TEXT_NORMALIZATION.read_text(encoding="utf-8")

        self.assertTrue(HANDBOOK_CLEANUP_TEXT_NORMALIZATION.exists())
        self.assertTrue(HANDBOOK_CLEANUP_OCR_REPAIRS.exists())
        self.assertTrue(HANDBOOK_CLEANUP_ARTICLE_BOUNDARIES.exists())
        self.assertNotIn("def _split_inline_article_boundaries", normalize_source)
        self.assertNotIn("def _merge_broken_body_lines", normalize_source)
        self.assertNotIn("def _repair_known_ocr_phrase_errors", normalize_source)
        self.assertLessEqual(len(normalize_source.splitlines()), 220)
        self.assertNotIn("def _repair_known_ocr_phrase_errors", text_normalization_source)
        self.assertNotIn("def _split_inline_article_boundaries", text_normalization_source)
        self.assertLessEqual(len(text_normalization_source.splitlines()), 800)

    def test_handbook_source_projections_delegate_models(self) -> None:
        source = HANDBOOK_SOURCE_PROJECTIONS.read_text(encoding="utf-8")

        self.assertTrue(HANDBOOK_SOURCE_PROJECTION_MODELS.exists())
        self.assertNotIn("class HandbookSourceProjection", source)
        self.assertNotIn("class HandbookSourceProjectionsConfig", source)
        self.assertLessEqual(len(source.splitlines()), 800)

    def test_curriculum_provider_normalize_tests_are_split_by_repair_family(self) -> None:
        legacy_source = CURRICULUM_PROVIDER_NORMALIZE_TEST.read_text(encoding="utf-8")

        self.assertTrue(CURRICULUM_PROVIDER_NORMALIZE_TEXT_SUITE.exists())
        self.assertTrue(CURRICULUM_PROVIDER_NORMALIZE_SECTION_SUITE.exists())
        self.assertTrue(CURRICULUM_PROVIDER_NORMALIZE_TABLE_SUITE.exists())
        self.assertTrue(CURRICULUM_PROVIDER_NORMALIZE_MISC_SUITE.exists())
        self.assertTrue(CURRICULUM_PROVIDER_NORMALIZE_TEST_SUPPORT.exists())
        self.assertNotIn("class CurriculumProviderNormalizeTest", legacy_source)
        self.assertLessEqual(len(legacy_source.splitlines()), 90)

    def test_internal_notice_regulation_materialization_tests_are_split(self) -> None:
        legacy_source = NOTICE_REGULATION_MATERIALIZATION_TEST.read_text(encoding="utf-8")

        self.assertTrue(NOTICE_REGULATION_MATERIALIZATION_TARGET_SUITE.exists())
        self.assertTrue(NOTICE_REGULATION_MATERIALIZATION_GATE_SUITE.exists())
        self.assertTrue(NOTICE_REGULATION_MATERIALIZATION_TEST_SUPPORT.exists())
        self.assertNotIn("class InternalNoticeRegulationMaterializationTest", legacy_source)
        self.assertLessEqual(len(legacy_source.splitlines()), 90)

    def test_attachment_fetch_status_worker_tests_are_split(self) -> None:
        legacy_source = ATTACHMENT_FETCH_STATUS_WORKER_TEST.read_text(encoding="utf-8")

        self.assertTrue(ATTACHMENT_FETCH_STATUS_WORKER_RECORD_SUITE.exists())
        self.assertTrue(ATTACHMENT_FETCH_STATUS_WORKER_REFERENCE_SUITE.exists())
        self.assertTrue(ATTACHMENT_FETCH_STATUS_WORKER_CONTROL_SUITE.exists())
        self.assertTrue(ATTACHMENT_FETCH_STATUS_WORKER_TEST_SUPPORT.exists())
        self.assertNotIn(
            "class AuthenticatedNoticeAttachmentFetchStatusWorkerCliTest",
            legacy_source,
        )
        self.assertLessEqual(len(legacy_source.splitlines()), 90)


if __name__ == "__main__":
    unittest.main()
