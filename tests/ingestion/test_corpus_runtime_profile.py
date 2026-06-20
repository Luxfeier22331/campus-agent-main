from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_ingestion_core import default_query_scopes, load_runtime_profile
from campus_ingestion_core.corpus_profiles import (
    CollectionRuntimeProfile,
    is_official_web_stable_reference_like_collection,
    is_official_web_stable_reference_like_profile,
    load_chunk_profile,
)


class CorpusRuntimeProfileTest(unittest.TestCase):
    def test_default_query_enabled_retrieval_profiles_declare_embedding_query_instruction(
        self,
    ) -> None:
        config_root = Path("configs/ingestion")

        for corpus, collection in default_query_scopes():
            with self.subTest(scope=f"{corpus}/{collection}"):
                payload = json.loads(
                    (config_root / corpus / collection / "runtime-profile.json").read_text(
                        encoding="utf-8"
                    )
                )

                self.assertIsInstance(payload.get("embedding_query_instruction"), str)
                self.assertTrue(payload["embedding_query_instruction"].strip())

    def test_load_student_handbook_runtime_profile_requires_split_manifest(self) -> None:
        profile = load_runtime_profile("regulations", "student_rules")

        self.assertEqual(profile.corpus, "regulations")
        self.assertEqual(profile.collection, "student_rules")
        self.assertEqual(profile.serving_stage, "query_serving")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertTrue(profile.split_manifest_required)
        self.assertTrue(profile.retrieval_enabled)
        self.assertTrue(profile.query_enabled_by_default)
        self.assertTrue(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ("current-effective", "source-faithful"))
        self.assertEqual(profile.retrieval_top_k, 8)
        self.assertEqual(profile.dense_prefetch_limit, 20)
        self.assertEqual(profile.sparse_prefetch_limit, 20)
        self.assertEqual(profile.rrf_k, 60)
        self.assertEqual(profile.rrf_dense_weight, 1.0)
        self.assertEqual(profile.rrf_sparse_weight, 1.0)
        self.assertEqual(profile.document_support_limit, 24)
        self.assertEqual(profile.document_support_strategy, "targeted_overfetch")
        self.assertEqual(
            profile.embedding_query_instruction,
            "Given a campus policy or handbook question, retrieve relevant passages that answer the query.",
        )
        self.assertEqual(profile.no_hit_min_top_score, 0.6)
        self.assertEqual(profile.no_hit_min_score_gap, 0.1)
        self.assertEqual(profile.cleaning_policy_version, "student_rules_cleaning_v1")
        self.assertEqual(profile.chunk_profile_version, "student_rules_semantic_v3")
        self.assertEqual(profile.source_ocr_provider, "mineru_api")
        self.assertEqual(profile.source_ocr_model, "vlm")
        self.assertEqual(profile.source_parser_version, "mineru-vlm-adapted-v2")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "student_rules")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "student_rules")

    def test_load_student_rules_chunk_profile_uses_handbook_strategy(self) -> None:
        profile = load_chunk_profile("regulations", "student_rules")

        self.assertEqual(profile.corpus, "regulations")
        self.assertEqual(profile.collection, "student_rules")
        self.assertEqual(profile.chunk_profile_version, "student_rules_semantic_v3")
        self.assertEqual(profile.structured_input, "document_units_jsonl")
        self.assertEqual(profile.cleaning_policy_version, "student_rules_cleaning_v1")
        self.assertEqual(profile.runtime_defaults.strategy_name, "student_handbook_structure_v3")
        self.assertEqual(profile.runtime_defaults.chunk_size, 384)
        self.assertEqual(profile.runtime_defaults.max_chunk_size, 512)
        self.assertEqual(profile.runtime_defaults.chunk_overlap, 64)
        self.assertEqual(profile.runtime_defaults.min_chunk_size, 96)

    def test_load_institutional_rules_runtime_profile_enables_no_hit_guard(self) -> None:
        profile = load_runtime_profile("regulations", "institutional_rules")

        self.assertEqual(profile.corpus, "regulations")
        self.assertEqual(profile.collection, "institutional_rules")
        self.assertEqual(profile.serving_stage, "query_serving")
        self.assertTrue(profile.retrieval_enabled)
        self.assertTrue(profile.query_enabled_by_default)
        self.assertTrue(profile.current_only)
        self.assertEqual(profile.retrieval_top_k, 3)
        self.assertEqual(profile.no_hit_min_top_score, 0.6)
        self.assertEqual(profile.no_hit_min_score_gap, 0.1)
        self.assertEqual(profile.qdrant_index_binding.alias_name, "institutional_rules")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "institutional_rules")

    def test_load_curriculum_plan_runtime_profile(self) -> None:
        profile = load_runtime_profile("curriculum", "curriculum_plan")

        self.assertEqual(profile.corpus, "curriculum")
        self.assertEqual(profile.collection, "curriculum_plan")
        self.assertEqual(profile.serving_stage, "query_serving")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertTrue(profile.split_manifest_required)
        self.assertTrue(profile.retrieval_enabled)
        self.assertTrue(profile.query_enabled_by_default)
        self.assertFalse(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ("source-faithful",))
        self.assertEqual(profile.retrieval_top_k, 5)
        self.assertEqual(profile.dense_prefetch_limit, 20)
        self.assertEqual(profile.sparse_prefetch_limit, 20)
        self.assertEqual(profile.rrf_k, 60)
        self.assertEqual(profile.rrf_dense_weight, 1.0)
        self.assertEqual(profile.rrf_sparse_weight, 1.0)
        self.assertEqual(profile.document_support_limit, 24)
        self.assertEqual(profile.document_support_strategy, "targeted_overfetch")
        self.assertEqual(
            profile.embedding_query_instruction,
            "Given a campus policy or handbook question, retrieve relevant passages that answer the query.",
        )
        self.assertEqual(profile.no_hit_min_top_score, 0.6)
        self.assertEqual(profile.no_hit_min_score_gap, 0.1)
        self.assertEqual(profile.cleaning_policy_version, "curriculum_plan_cleaning_v1")
        self.assertEqual(profile.chunk_profile_version, "curriculum_plan_semantic_v2")
        self.assertEqual(profile.source_ocr_provider, "mineru_api")
        self.assertEqual(profile.source_ocr_model, "vlm")
        self.assertEqual(profile.source_parser_version, "mineru-vlm-adapted-v2")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "curriculum_plan")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "curriculum_plan")

    def test_load_curriculum_course_facts_runtime_profile(self) -> None:
        profile = load_runtime_profile("curriculum", "course_facts")

        self.assertEqual(profile.corpus, "curriculum")
        self.assertEqual(profile.collection, "course_facts")
        self.assertEqual(profile.serving_stage, "query_serving")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertFalse(profile.split_manifest_required)
        self.assertTrue(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertFalse(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ("source-faithful",))
        self.assertEqual(profile.retrieval_top_k, 5)
        self.assertEqual(profile.dense_prefetch_limit, 20)
        self.assertEqual(profile.sparse_prefetch_limit, 20)
        self.assertEqual(profile.rrf_k, 60)
        self.assertEqual(profile.rrf_dense_weight, 1.0)
        self.assertEqual(profile.rrf_sparse_weight, 1.0)
        self.assertEqual(profile.document_support_limit, 24)
        self.assertEqual(
            profile.embedding_query_instruction,
            "Given a campus policy or handbook question, retrieve relevant passages that answer the query.",
        )
        self.assertEqual(profile.cleaning_policy_version, "curriculum_course_facts_projection_v1")
        self.assertEqual(profile.chunk_profile_version, "curriculum_course_facts_semantic_v1")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "course_facts")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "course_facts")

    def test_load_curriculum_program_family_facts_runtime_profile(self) -> None:
        profile = load_runtime_profile("curriculum", "program_family_facts")

        self.assertEqual(profile.corpus, "curriculum")
        self.assertEqual(profile.collection, "program_family_facts")
        self.assertEqual(profile.serving_stage, "query_serving")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertFalse(profile.split_manifest_required)
        self.assertTrue(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertFalse(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ("source-faithful",))
        self.assertEqual(profile.retrieval_top_k, 5)
        self.assertEqual(
            profile.cleaning_policy_version, "curriculum_program_family_facts_projection_v1"
        )
        self.assertEqual(
            profile.chunk_profile_version, "curriculum_program_family_facts_semantic_v1"
        )
        self.assertEqual(profile.qdrant_index_binding.alias_name, "program_family_facts")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "program_family_facts")

    def test_load_curriculum_program_semester_facts_runtime_profile(self) -> None:
        profile = load_runtime_profile("curriculum", "program_semester_facts")

        self.assertEqual(profile.corpus, "curriculum")
        self.assertEqual(profile.collection, "program_semester_facts")
        self.assertEqual(profile.serving_stage, "query_serving")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertFalse(profile.split_manifest_required)
        self.assertTrue(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertFalse(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ("source-faithful",))
        self.assertEqual(profile.retrieval_top_k, 5)
        self.assertEqual(profile.document_support_limit, 24)
        self.assertEqual(profile.document_support_strategy, "targeted_overfetch")
        self.assertEqual(
            profile.cleaning_policy_version, "curriculum_program_semester_facts_projection_v1"
        )
        self.assertEqual(
            profile.chunk_profile_version, "curriculum_program_semester_facts_semantic_v1"
        )
        self.assertEqual(profile.qdrant_index_binding.alias_name, "program_semester_facts")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "program_semester_facts")

    def test_load_service_catalog_runtime_profile(self) -> None:
        profile = load_runtime_profile("campus_services", "service_catalog")

        self.assertEqual(profile.corpus, "campus_services")
        self.assertEqual(profile.collection, "service_catalog")
        self.assertEqual(profile.serving_stage, "offline_preparation")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertFalse(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertFalse(profile.structured_query_enabled)
        self.assertFalse(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ())
        self.assertEqual(profile.retrieval_top_k, 3)
        self.assertIsNone(profile.no_hit_min_top_score)
        self.assertIsNone(profile.no_hit_min_score_gap)
        self.assertEqual(profile.cleaning_policy_version, "service_catalog_cleaning_v1")
        self.assertEqual(profile.chunk_profile_version, "service_catalog_semantic_v1")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "service_catalog")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "service_catalog")

    def test_load_service_guide_runtime_profile(self) -> None:
        profile = load_runtime_profile("campus_services", "service_guide")

        self.assertEqual(profile.corpus, "campus_services")
        self.assertEqual(profile.collection, "service_guide")
        self.assertEqual(profile.serving_stage, "structured_query_serving")
        self.assertEqual(profile.allowed_artifact_modes, ("source_truth_only",))
        self.assertFalse(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertTrue(profile.structured_query_enabled)
        self.assertEqual(profile.structured_query_tools, ("service_guide_lookup",))
        self.assertFalse(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ())
        self.assertEqual(profile.retrieval_top_k, 3)
        self.assertIsNone(profile.no_hit_min_top_score)
        self.assertIsNone(profile.no_hit_min_score_gap)
        self.assertEqual(profile.cleaning_policy_version, "service_guide_projection_v1")
        self.assertEqual(profile.chunk_profile_version, "service_guide_projection_v1")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "service_guide")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "service_guide")

    def test_load_service_catalog_chunk_profile(self) -> None:
        profile = load_chunk_profile("campus_services", "service_catalog")

        self.assertEqual(profile.corpus, "campus_services")
        self.assertEqual(profile.collection, "service_catalog")
        self.assertEqual(profile.chunk_profile_version, "service_catalog_semantic_v1")
        self.assertEqual(profile.structured_input, "document_units_jsonl")
        self.assertEqual(profile.cleaning_policy_version, "service_catalog_cleaning_v1")
        self.assertEqual(profile.runtime_defaults.strategy_name, "service_catalog_structure_v1")

    def test_load_service_status_runtime_profile(self) -> None:
        profile = load_runtime_profile("campus_services", "service_status")

        self.assertEqual(profile.corpus, "campus_services")
        self.assertEqual(profile.collection, "service_status")
        self.assertEqual(profile.serving_stage, "structured_query_serving")
        self.assertEqual(profile.allowed_artifact_modes, ("source_truth_only",))
        self.assertFalse(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertTrue(profile.structured_query_enabled)
        self.assertEqual(profile.structured_query_tools, ("service_status_lookup",))
        self.assertFalse(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ())
        self.assertEqual(profile.retrieval_top_k, 3)
        self.assertEqual(profile.cleaning_policy_version, "service_status_projection_v1")
        self.assertEqual(profile.chunk_profile_version, "service_status_projection_v1")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "service_status")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "service_status")

    def test_load_service_status_chunk_profile(self) -> None:
        profile = load_chunk_profile("campus_services", "service_status")

        self.assertEqual(profile.corpus, "campus_services")
        self.assertEqual(profile.collection, "service_status")
        self.assertEqual(profile.chunk_profile_version, "service_status_projection_v1")
        self.assertEqual(profile.structured_input, "service_status_projection_json")
        self.assertEqual(profile.cleaning_policy_version, "service_status_projection_v1")
        self.assertEqual(profile.runtime_defaults.strategy_name, "service_status_projection_v1")

    def test_load_contact_directory_runtime_profile(self) -> None:
        profile = load_runtime_profile("campus_services", "contact_directory")

        self.assertEqual(profile.corpus, "campus_services")
        self.assertEqual(profile.collection, "contact_directory")
        self.assertEqual(profile.serving_stage, "structured_query_serving")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertFalse(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertTrue(profile.structured_query_enabled)
        self.assertEqual(profile.structured_query_tools, ("contact_directory_lookup",))
        self.assertFalse(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ())
        self.assertEqual(profile.retrieval_top_k, 3)
        self.assertIsNone(profile.no_hit_min_top_score)
        self.assertIsNone(profile.no_hit_min_score_gap)
        self.assertEqual(profile.cleaning_policy_version, "contact_directory_cleaning_v1")
        self.assertEqual(profile.chunk_profile_version, "contact_directory_semantic_v1")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "contact_directory")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "contact_directory")

    def test_load_contact_directory_chunk_profile(self) -> None:
        profile = load_chunk_profile("campus_services", "contact_directory")

        self.assertEqual(profile.corpus, "campus_services")
        self.assertEqual(profile.collection, "contact_directory")
        self.assertEqual(profile.chunk_profile_version, "contact_directory_semantic_v1")
        self.assertEqual(profile.structured_input, "document_units_jsonl")
        self.assertEqual(profile.cleaning_policy_version, "contact_directory_cleaning_v1")
        self.assertEqual(profile.runtime_defaults.strategy_name, "contact_directory_structure_v1")

    def test_load_transport_schedule_runtime_profile(self) -> None:
        profile = load_runtime_profile("campus_services", "transport_schedule")

        self.assertEqual(profile.corpus, "campus_services")
        self.assertEqual(profile.collection, "transport_schedule")
        self.assertEqual(profile.serving_stage, "structured_query_serving")
        self.assertEqual(profile.allowed_artifact_modes, ("source_truth_only",))
        self.assertFalse(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertTrue(profile.structured_query_enabled)
        self.assertEqual(profile.structured_query_tools, ("transport_schedule_lookup",))
        self.assertEqual(profile.cleaning_policy_version, "transport_schedule_projection_v1")
        self.assertEqual(profile.chunk_profile_version, "transport_schedule_projection_v1")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "transport_schedule")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "transport_schedule")

    def test_load_academic_calendar_runtime_profile(self) -> None:
        profile = load_runtime_profile("calendar", "academic_calendar")

        self.assertEqual(profile.corpus, "calendar")
        self.assertEqual(profile.collection, "academic_calendar")
        self.assertEqual(profile.serving_stage, "structured_query_serving")
        self.assertEqual(profile.allowed_artifact_modes, ("source_truth_only",))
        self.assertFalse(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertTrue(profile.structured_query_enabled)
        self.assertEqual(profile.structured_query_tools, ("academic_calendar_lookup",))
        self.assertFalse(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ())
        self.assertEqual(profile.retrieval_top_k, 3)
        self.assertEqual(profile.cleaning_policy_version, "academic_calendar_projection_v1")
        self.assertEqual(profile.chunk_profile_version, "academic_calendar_projection_v1")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "academic_calendar")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "academic_calendar")

    def test_load_academic_calendar_chunk_profile(self) -> None:
        profile = load_chunk_profile("calendar", "academic_calendar")

        self.assertEqual(profile.corpus, "calendar")
        self.assertEqual(profile.collection, "academic_calendar")
        self.assertEqual(profile.chunk_profile_version, "academic_calendar_projection_v1")
        self.assertEqual(profile.structured_input, "academic_calendar_projection_json")
        self.assertEqual(profile.cleaning_policy_version, "academic_calendar_projection_v1")
        self.assertEqual(profile.runtime_defaults.strategy_name, "academic_calendar_projection_v1")

    def test_load_internal_notice_runtime_profile_uses_mineru_primary_source_ocr(self) -> None:
        profile = load_runtime_profile("campus_notices", "internal_notice")

        self.assertEqual(profile.corpus, "campus_notices")
        self.assertEqual(profile.collection, "internal_notice")
        self.assertEqual(profile.source_ocr_provider, "mineru_api")
        self.assertEqual(profile.source_ocr_model, "vlm")
        self.assertEqual(profile.source_parser_version, "mineru-vlm-adapted-v2")
        self.assertEqual(profile.source_ocr_image_routing_strategy, "mineru_primary")

    def test_load_official_web_runtime_profile_current_truth_remains_offline_and_not_freshness_ready(
        self,
    ) -> None:
        profile = load_runtime_profile("official_web", "muc_public_pages")

        self.assertEqual(profile.corpus, "official_web")
        self.assertEqual(profile.collection, "muc_public_pages")
        self.assertEqual(profile.serving_stage, "offline_preparation")
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertEqual(profile.serving_surface, "mixed")
        self.assertFalse(profile.supports_freshness_sensitive_queries)
        self.assertIsNone(profile.freshness_max_age_hours)
        self.assertEqual(profile.qdrant_index_binding.alias_name, "muc_public_pages")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "muc_public_pages")

    def test_load_official_web_stable_reference_runtime_profile(self) -> None:
        profile = load_runtime_profile("official_web", "stable_reference")

        self.assertEqual(profile.corpus, "official_web")
        self.assertEqual(profile.collection, "stable_reference")
        self.assertEqual(profile.serving_stage, "query_serving")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertTrue(profile.split_manifest_required)
        self.assertTrue(profile.retrieval_enabled)
        self.assertTrue(profile.query_enabled_by_default)
        self.assertEqual(profile.serving_surface, "stable_reference")
        self.assertFalse(profile.supports_freshness_sensitive_queries)
        self.assertIsNone(profile.freshness_max_age_hours)
        self.assertEqual(profile.required_metadata_fields, ())
        self.assertEqual(profile.primary_evidence_page_families, ())
        self.assertIsNone(profile.listing_page_role)
        self.assertFalse(profile.requires_freshness_gate)
        self.assertFalse(profile.requires_explicit_history_intent)
        self.assertFalse(profile.duplicate_collapse_required)
        self.assertFalse(profile.reranker_enabled_by_default)
        self.assertTrue(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ("source-faithful",))
        self.assertEqual(profile.cleaning_policy_version, "official_web_cleaning_v2")
        self.assertEqual(profile.chunk_profile_version, "official_web_semantic_v2")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "official_web_stable_reference")
        self.assertEqual(
            profile.qdrant_index_binding.collection_prefix, "official_web_stable_reference"
        )

    def test_load_official_web_fresh_news_runtime_profile(self) -> None:
        profile = load_runtime_profile("official_web", "fresh_news")

        self.assertEqual(profile.corpus, "official_web")
        self.assertEqual(profile.collection, "fresh_news")
        self.assertEqual(profile.serving_stage, "offline_preparation")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertTrue(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertEqual(profile.serving_surface, "fresh_news")
        self.assertFalse(profile.supports_freshness_sensitive_queries)
        self.assertIsNone(profile.freshness_max_age_hours)
        self.assertEqual(
            profile.required_metadata_fields,
            (
                "published_at",
                "crawled_at",
                "last_seen_at",
                "host",
                "page_family",
                "section",
                "news_kind",
            ),
        )
        self.assertEqual(profile.primary_evidence_page_families, ("article_detail",))
        self.assertEqual(profile.listing_page_role, "discovery_only")
        self.assertTrue(profile.requires_freshness_gate)
        self.assertFalse(profile.requires_explicit_history_intent)
        self.assertTrue(profile.duplicate_collapse_required)
        self.assertEqual(profile.cleaning_policy_version, "official_web_cleaning_v2")
        self.assertEqual(profile.chunk_profile_version, "official_web_semantic_v2")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "official_web_fresh_news")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "official_web_fresh_news")

    def test_load_official_web_news_archive_runtime_profile(self) -> None:
        profile = load_runtime_profile("official_web", "news_archive")

        self.assertEqual(profile.corpus, "official_web")
        self.assertEqual(profile.collection, "news_archive")
        self.assertEqual(profile.serving_stage, "offline_preparation")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertFalse(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertEqual(profile.serving_surface, "news_archive")
        self.assertFalse(profile.supports_freshness_sensitive_queries)
        self.assertIsNone(profile.freshness_max_age_hours)
        self.assertEqual(
            profile.required_metadata_fields,
            (
                "published_at",
                "crawled_at",
                "last_seen_at",
                "host",
                "page_family",
                "section",
                "news_kind",
            ),
        )
        self.assertEqual(profile.primary_evidence_page_families, ("article_detail",))
        self.assertEqual(profile.listing_page_role, "discovery_only")
        self.assertFalse(profile.requires_freshness_gate)
        self.assertTrue(profile.requires_explicit_history_intent)
        self.assertTrue(profile.duplicate_collapse_required)
        self.assertEqual(profile.cleaning_policy_version, "official_web_cleaning_v2")
        self.assertEqual(profile.chunk_profile_version, "official_web_semantic_v2")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "official_web_news_archive")
        self.assertEqual(
            profile.qdrant_index_binding.collection_prefix, "official_web_news_archive"
        )

    def test_official_web_stable_reference_like_helpers_match_runtime_profiles(self) -> None:
        bridge_profile = load_runtime_profile("official_web", "muc_public_pages")
        stable_reference_profile = load_runtime_profile("official_web", "stable_reference")
        fresh_news_profile = load_runtime_profile("official_web", "fresh_news")
        news_archive_profile = load_runtime_profile("official_web", "news_archive")

        self.assertFalse(is_official_web_stable_reference_like_profile(bridge_profile))
        self.assertTrue(is_official_web_stable_reference_like_profile(stable_reference_profile))
        self.assertFalse(is_official_web_stable_reference_like_profile(fresh_news_profile))
        self.assertFalse(is_official_web_stable_reference_like_profile(news_archive_profile))
        self.assertFalse(is_official_web_stable_reference_like_collection("muc_public_pages"))
        self.assertTrue(is_official_web_stable_reference_like_collection("stable_reference"))
        self.assertFalse(is_official_web_stable_reference_like_collection("fresh_news"))
        self.assertFalse(is_official_web_stable_reference_like_collection("news_archive"))

    def test_load_internal_notice_runtime_profile(self) -> None:
        profile = load_runtime_profile("campus_notices", "internal_notice")

        self.assertEqual(profile.corpus, "campus_notices")
        self.assertEqual(profile.collection, "internal_notice")
        self.assertEqual(profile.serving_stage, "offline_preparation")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertFalse(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertFalse(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ("source-faithful",))
        self.assertEqual(profile.retrieval_top_k, 3)
        self.assertEqual(profile.cleaning_policy_version, "authenticated_notice_projection_v1")
        self.assertEqual(profile.chunk_profile_version, "authenticated_notice_semantic_v1")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "internal_notice")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "internal_notice")

    def test_load_authenticated_documents_common_download_source_runtime_profile(self) -> None:
        profile = load_runtime_profile("authenticated_documents", "common_download_source")

        self.assertEqual(profile.corpus, "authenticated_documents")
        self.assertEqual(profile.collection, "common_download_source")
        self.assertEqual(profile.serving_stage, "offline_preparation")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertFalse(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertFalse(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ("source-faithful",))
        self.assertEqual(profile.retrieval_top_k, 3)
        self.assertEqual(profile.cleaning_policy_version, "authenticated_documents_holding_v1")
        self.assertEqual(profile.chunk_profile_version, "authenticated_documents_holding_v1")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "common_download_source")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "common_download_source")

    def test_load_authenticated_documents_file_release_source_runtime_profile(self) -> None:
        profile = load_runtime_profile("authenticated_documents", "file_release_source")

        self.assertEqual(profile.corpus, "authenticated_documents")
        self.assertEqual(profile.collection, "file_release_source")
        self.assertEqual(profile.serving_stage, "offline_preparation")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertFalse(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertFalse(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ("source-faithful",))
        self.assertEqual(profile.retrieval_top_k, 3)
        self.assertEqual(profile.cleaning_policy_version, "authenticated_documents_holding_v1")
        self.assertEqual(profile.chunk_profile_version, "authenticated_documents_holding_v1")
        self.assertEqual(profile.source_ocr_provider, "mineru_api")
        self.assertEqual(profile.source_ocr_model, "vlm")
        self.assertEqual(profile.source_parser_version, "mineru-vlm-adapted-v2")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "file_release_source")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "file_release_source")

    def test_load_institutional_regulations_runtime_profile(self) -> None:
        profile = load_runtime_profile("regulations", "institutional_rules")

        self.assertEqual(profile.corpus, "regulations")
        self.assertEqual(profile.collection, "institutional_rules")
        self.assertEqual(profile.serving_stage, "query_serving")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertFalse(profile.split_manifest_required)
        self.assertTrue(profile.retrieval_enabled)
        self.assertTrue(profile.query_enabled_by_default)
        self.assertTrue(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ("current-effective",))
        self.assertEqual(profile.retrieval_top_k, 3)
        self.assertEqual(profile.cleaning_policy_version, "institutional_rules_cleaning_v1")
        self.assertEqual(profile.chunk_profile_version, "institutional_rules_semantic_v1")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "institutional_rules")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "institutional_rules")

    def test_load_scoped_rules_runtime_profile(self) -> None:
        profile = load_runtime_profile("regulations", "scoped_rules")

        self.assertEqual(profile.corpus, "regulations")
        self.assertEqual(profile.collection, "scoped_rules")
        self.assertEqual(profile.serving_stage, "query_serving")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertFalse(profile.split_manifest_required)
        self.assertTrue(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertTrue(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ("current-effective",))
        self.assertEqual(profile.retrieval_top_k, 3)
        self.assertEqual(profile.cleaning_policy_version, "scoped_rules_cleaning_v1")
        self.assertEqual(profile.chunk_profile_version, "scoped_rules_semantic_v1")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "scoped_rules")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "scoped_rules")

    def test_default_query_scopes_include_all_query_enabled_profiles(self) -> None:
        self.assertEqual(
            default_query_scopes(),
            (
                ("curriculum", "curriculum_plan"),
                ("official_web", "stable_reference"),
                ("regulations", "institutional_rules"),
                ("regulations", "student_rules"),
            ),
        )

    def test_structured_query_tools_have_explicit_runtime_profile_opening(self) -> None:
        profiles = {
            tool: load_runtime_profile(corpus, collection)
            for tool, corpus, collection in (
                ("service_status_lookup", "campus_services", "service_status"),
                ("service_guide_lookup", "campus_services", "service_guide"),
                ("contact_directory_lookup", "campus_services", "contact_directory"),
                ("transport_schedule_lookup", "campus_services", "transport_schedule"),
                ("academic_calendar_lookup", "calendar", "academic_calendar"),
            )
        }

        for tool_name, profile in profiles.items():
            self.assertEqual(profile.serving_stage, "structured_query_serving", tool_name)
            self.assertTrue(profile.structured_query_enabled, tool_name)
            self.assertIn(tool_name, profile.structured_query_tools)
            self.assertFalse(profile.retrieval_enabled, tool_name)
            self.assertFalse(profile.query_enabled_by_default, tool_name)

    def test_structured_query_serving_profile_rejects_generic_query_opening(self) -> None:
        base_kwargs = {
            "corpus": "campus_services",
            "collection": "service_status",
            "serving_stage": "structured_query_serving",
            "allowed_artifact_modes": ("source_truth_only",),
            "split_manifest_required": False,
            "cleaning_policy_version": "service_status_projection_v1",
            "chunk_profile_version": "service_status_projection_v1",
            "retrieval_enabled": False,
            "query_enabled_by_default": False,
            "structured_query_enabled": True,
            "structured_query_tools": ("service_status_lookup",),
        }

        with self.assertRaisesRegex(
            ValueError,
            "structured_query_serving requires retrieval_enabled=false",
        ):
            CollectionRuntimeProfile(**{**base_kwargs, "retrieval_enabled": True})

        with self.assertRaisesRegex(
            ValueError,
            "structured_query_serving requires query_enabled_by_default=false",
        ):
            CollectionRuntimeProfile(**{**base_kwargs, "query_enabled_by_default": True})

        with self.assertRaisesRegex(
            ValueError,
            "structured_query_serving requires structured_query_enabled=true",
        ):
            CollectionRuntimeProfile(**{**base_kwargs, "structured_query_enabled": False})


if __name__ == "__main__":
    unittest.main()
