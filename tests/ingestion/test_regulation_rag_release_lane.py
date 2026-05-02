from __future__ import annotations

import json
import unittest
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.regulation_rag_release_lane import (
    InMemoryRegulationRagReleaseCandidateStore,
    RagReleaseExecutionResult,
    build_operator_rag_release_status,
    build_registry_scope_rag_release_executor,
    enqueue_regulation_rag_release_candidates_for_records,
    enqueue_regulation_rag_release_candidates_for_registry_delta,
    process_pending_regulation_rag_release_candidates,
)

from tests.support.in_memory_registry import InMemoryDocumentRegistry


class RegulationRagReleaseLaneTest(unittest.TestCase):
    def test_enqueues_current_institutional_rule_candidate(self) -> None:
        store = InMemoryRegulationRagReleaseCandidateStore()

        report = enqueue_regulation_rag_release_candidates_for_records(
            store=store,
            records=(self._record(collection="institutional_rules"),),
            runtime_profile=self._profile(
                collection="institutional_rules",
                query_enabled_by_default=True,
            ),
            now=self._now(),
        )

        self.assertEqual(report.created_count, 1)
        candidate = store.list_candidates()[0]
        self.assertEqual(candidate.status, "pending")
        self.assertEqual(candidate.corpus, "regulations")
        self.assertEqual(candidate.collection, "institutional_rules")
        self.assertEqual(candidate.document_id, "doc-001")
        self.assertTrue(candidate.query_enabled_by_default)
        self.assertEqual(candidate.documentSiteStatus, "not_tracked")
        self.assertEqual(candidate.ragPreparationStatus, "pending")
        self.assertEqual(candidate.ragServingStatus, "not_serving")

    def test_query_disabled_scoped_rule_is_held_without_release_runner(self) -> None:
        store = InMemoryRegulationRagReleaseCandidateStore()
        enqueue_regulation_rag_release_candidates_for_records(
            store=store,
            records=(self._record(collection="scoped_rules"),),
            runtime_profile=self._profile(
                collection="scoped_rules", query_enabled_by_default=False
            ),
            now=self._now(),
        )

        report = process_pending_regulation_rag_release_candidates(
            store=store,
            release_executor=self._unexpected_release_executor,
            now=self._now(),
        )

        self.assertEqual(report.processed_count, 1)
        candidate = store.list_candidates()[0]
        self.assertEqual(candidate.status, "not_query_enabled")
        self.assertEqual(candidate.ragServingStatus, "not_serving")
        self.assertEqual(candidate.ragVerificationStatus, "not_applicable")

    def test_unchanged_candidate_skips_reembedding(self) -> None:
        store = InMemoryRegulationRagReleaseCandidateStore()
        profile = self._profile(
            collection="institutional_rules",
            query_enabled_by_default=True,
        )
        enqueue_regulation_rag_release_candidates_for_records(
            store=store,
            records=(self._record(collection="institutional_rules"),),
            runtime_profile=profile,
            now=self._now(),
        )
        process_pending_regulation_rag_release_candidates(
            store=store,
            release_executor=lambda candidate: RagReleaseExecutionResult(
                status="passed",
                release_id="release-001",
                verification_status="passed",
                release_admission_status="passed",
                release_admission_manifest_key="admission.json",
            ),
            now=self._now(),
        )

        second = enqueue_regulation_rag_release_candidates_for_records(
            store=store,
            records=(self._record(collection="institutional_rules"),),
            runtime_profile=profile,
            now=self._now(),
        )

        self.assertEqual(second.skipped_unchanged_count, 1)
        latest = store.list_candidates()[-1]
        self.assertEqual(latest.status, "skipped_unchanged")
        self.assertEqual(latest.ragIndexStatus, "skipped_unchanged")
        self.assertEqual(latest.last_release_id, "release-001")

    def test_force_reenqueue_overrides_unchanged_serving_candidate(self) -> None:
        store = InMemoryRegulationRagReleaseCandidateStore()
        profile = self._profile(
            collection="institutional_rules",
            query_enabled_by_default=True,
        )
        enqueue_regulation_rag_release_candidates_for_records(
            store=store,
            records=(self._record(collection="institutional_rules"),),
            runtime_profile=profile,
            now=self._now(),
        )
        process_pending_regulation_rag_release_candidates(
            store=store,
            release_executor=lambda candidate: RagReleaseExecutionResult(
                status="passed",
                release_id="stale-release",
                verification_status="passed",
                release_admission_status="passed",
                release_admission_manifest_key="stale-admission.json",
            ),
            now=self._now(),
        )

        report = enqueue_regulation_rag_release_candidates_for_records(
            store=store,
            records=(self._record(collection="institutional_rules"),),
            runtime_profile=profile,
            now=self._now(),
            force=True,
        )

        self.assertEqual(report.created_count, 1)
        self.assertEqual(report.skipped_unchanged_count, 0)
        self.assertEqual(report.forced_reenqueue_count, 1)
        candidate = store.list_candidates()[0]
        self.assertEqual(candidate.status, "pending")
        self.assertEqual(candidate.ragIndexStatus, "pending")
        self.assertIsNone(candidate.last_release_id)

    def test_same_collection_pending_candidates_share_one_scope_release(self) -> None:
        store = InMemoryRegulationRagReleaseCandidateStore()
        profile = self._profile(
            collection="institutional_rules",
            query_enabled_by_default=True,
        )
        enqueue_regulation_rag_release_candidates_for_records(
            store=store,
            records=(
                self._record(
                    collection="institutional_rules",
                    document_id="institutional-doc-001",
                    version_id="version-001",
                ),
                self._record(
                    collection="institutional_rules",
                    document_id="institutional-doc-002",
                    version_id="version-002",
                ),
            ),
            runtime_profile=profile,
            now=self._now(),
        )
        released_candidate_ids: list[str] = []

        def release_executor(candidate):
            released_candidate_ids.append(candidate.candidate_id)
            return RagReleaseExecutionResult(
                status="passed",
                release_id="release-institutional-scope",
                verification_status="passed",
                release_admission_status="passed",
                release_admission_manifest_key="admission.json",
            )

        report = process_pending_regulation_rag_release_candidates(
            store=store,
            release_executor=release_executor,
            now=self._now(),
        )

        self.assertEqual(report.processed_count, 2)
        self.assertEqual(len(released_candidate_ids), 1)
        candidates = store.list_candidates()
        self.assertEqual(
            {candidate.status for candidate in candidates},
            {"serving_published"},
        )
        self.assertEqual(
            {candidate.last_release_id for candidate in candidates},
            {"release-institutional-scope"},
        )

    def test_same_collection_preparation_failure_is_shared_without_retry(self) -> None:
        store = InMemoryRegulationRagReleaseCandidateStore()
        profile = self._profile(
            collection="institutional_rules",
            query_enabled_by_default=True,
        )
        enqueue_regulation_rag_release_candidates_for_records(
            store=store,
            records=(
                self._record(
                    collection="institutional_rules",
                    document_id="institutional-doc-001",
                    version_id="version-001",
                ),
                self._record(
                    collection="institutional_rules",
                    document_id="institutional-doc-002",
                    version_id="version-002",
                ),
            ),
            runtime_profile=profile,
            now=self._now(),
        )
        call_count = 0

        def release_executor(candidate):
            nonlocal call_count
            call_count += 1
            raise ValueError("canonical cleaning provenance failed")

        report = process_pending_regulation_rag_release_candidates(
            store=store,
            release_executor=release_executor,
            now=self._now(),
        )

        self.assertEqual(report.processed_count, 2)
        self.assertEqual(call_count, 1)
        candidates = store.list_candidates()
        self.assertEqual({candidate.status for candidate in candidates}, {"preparation_failed"})
        self.assertEqual(
            {candidate.ragPreparationStatus for candidate in candidates},
            {"failed"},
        )
        self.assertEqual(
            {candidate.message for candidate in candidates},
            {"canonical cleaning provenance failed"},
        )

    def test_withdrawn_current_rule_generates_delete_terminal_state(self) -> None:
        store = InMemoryRegulationRagReleaseCandidateStore()
        enqueue_regulation_rag_release_candidates_for_records(
            store=store,
            records=(
                self._record(
                    collection="institutional_rules",
                    status="withdrawn",
                    is_current=False,
                ),
            ),
            runtime_profile=self._profile(
                collection="institutional_rules",
                query_enabled_by_default=True,
            ),
            now=self._now(),
        )

        process_pending_regulation_rag_release_candidates(
            store=store,
            release_executor=self._unexpected_release_executor,
            now=self._now(),
        )

        candidate = store.list_candidates()[0]
        self.assertEqual(candidate.status, "deleted")
        self.assertEqual(candidate.cleanup_disposition, "delete_current_alias_points")
        self.assertEqual(candidate.ragServingStatus, "not_serving")

    def test_phase_6_canary_cohort_closeout_states(self) -> None:
        store = InMemoryRegulationRagReleaseCandidateStore()
        institutional_profile = self._profile(
            collection="institutional_rules",
            query_enabled_by_default=True,
        )
        scoped_profile = self._profile(
            collection="scoped_rules",
            query_enabled_by_default=False,
        )
        enqueue_regulation_rag_release_candidates_for_records(
            store=store,
            records=(
                self._record(
                    collection="institutional_rules",
                    document_id="current-institutional-rule",
                    source_uri="authenticated_notice:policy-regulation:355282",
                ),
            ),
            runtime_profile=institutional_profile,
            now=self._now(),
        )
        enqueue_regulation_rag_release_candidates_for_records(
            store=store,
            records=(
                self._record(
                    collection="scoped_rules",
                    document_id="current-scoped-rule",
                    source_uri="authenticated_notice:policy-regulation:351699",
                ),
                self._record(
                    collection="scoped_rules",
                    document_id="historical-scoped-rule-186977",
                    revision_track="source-faithful",
                    version_id="2021",
                    is_current=False,
                    source_uri="authenticated_notice:policy-regulation:186977",
                ),
            ),
            runtime_profile=scoped_profile,
            now=self._now(),
        )

        self.assertEqual(len(store.list_candidates()), 3)
        self.assertNotIn(
            "negative-source-truth-notice",
            {candidate.document_id for candidate in store.list_candidates()},
        )

        report = process_pending_regulation_rag_release_candidates(
            store=store,
            release_executor=lambda candidate: RagReleaseExecutionResult(
                status="passed",
                release_id=f"release-{candidate.document_id}",
                verification_status="passed",
                release_admission_status="passed",
                release_admission_manifest_key="admission.json",
            ),
            now=self._now(),
        )

        self.assertEqual(report.processed_count, 3)
        candidates = {candidate.document_id: candidate for candidate in store.list_candidates()}
        self.assertEqual(
            candidates["current-institutional-rule"].status,
            "serving_published",
        )
        self.assertEqual(
            candidates["current-institutional-rule"].ragServingStatus,
            "serving_published",
        )
        self.assertEqual(candidates["current-scoped-rule"].status, "not_query_enabled")
        self.assertEqual(candidates["current-scoped-rule"].ragServingStatus, "not_serving")
        self.assertEqual(
            candidates["historical-scoped-rule-186977"].status,
            "held_search_only",
        )
        self.assertEqual(
            candidates["historical-scoped-rule-186977"].cleanup_disposition,
            "none",
        )
        self.assertEqual(
            candidates["historical-scoped-rule-186977"].ragServingStatus,
            "not_serving",
        )

    def test_phase_6_selected_replay_evidence_matches_real_sample_expectations(self) -> None:
        evidence_path = (
            Path(".planning/workstreams/regulation-rag-release-lane")
            / "evidence/phase-06-canary-cohort-closeout/selected-replay-dry-run.json"
        )
        payload = json.loads(evidence_path.read_text(encoding="utf-8"))

        self.assertEqual(
            payload["schema_version"],
            "regulation_rag_release_selected_replay_dry_run_v1",
        )
        self.assertFalse(payload["write_enabled"])
        self.assertEqual(payload["replay_mode"], "local_selected_record_dry_run")
        self.assertEqual(payload["counts"]["selected_notice_count"], 5)
        self.assertEqual(payload["counts"]["candidate_count"], 3)

        by_notice_id = {item["source_notice_id"]: item for item in payload["notices"]}
        self.assertEqual(
            by_notice_id["355282"]["candidate_status"],
            "serving_published",
        )
        self.assertEqual(
            by_notice_id["355282"]["document_id"],
            "institutional_regulation:muc:中央民族大学关于学生使用人工智能的指导意见:089bcf7907da",
        )
        self.assertEqual(
            by_notice_id["355282"]["ragServingStatus"],
            "serving_published",
        )
        self.assertEqual(
            by_notice_id["351907"]["candidate_status"],
            "held_search_only",
        )
        self.assertEqual(
            by_notice_id["351907"]["registry_delta_behavior"],
            "no_candidate_current_version_absent",
        )
        self.assertEqual(
            by_notice_id["186977"]["candidate_status"],
            "held_search_only",
        )
        self.assertEqual(
            by_notice_id["186977"]["registry_delta_behavior"],
            "no_candidate_current_version_absent",
        )
        self.assertEqual(by_notice_id["351699"]["candidate_status"], "no_candidate")
        self.assertEqual(
            by_notice_id["187233"]["candidate_status"],
            "excluded_owner_body_recovery_required",
        )

    def test_acceptance_failure_does_not_publish_serving_status(self) -> None:
        store = InMemoryRegulationRagReleaseCandidateStore()
        enqueue_regulation_rag_release_candidates_for_records(
            store=store,
            records=(self._record(collection="institutional_rules"),),
            runtime_profile=self._profile(
                collection="institutional_rules",
                query_enabled_by_default=True,
            ),
            now=self._now(),
        )

        process_pending_regulation_rag_release_candidates(
            store=store,
            release_executor=lambda candidate: RagReleaseExecutionResult(
                status="acceptance_failed",
                release_id="release-failed",
                verification_status="failed",
                message="qrels coverage failed",
            ),
            now=self._now(),
        )

        candidate = store.list_candidates()[0]
        self.assertEqual(candidate.status, "acceptance_failed")
        self.assertEqual(candidate.ragServingStatus, "not_serving")
        self.assertEqual(candidate.ragVerificationStatus, "failed")

    def test_preparation_failure_is_terminal_without_serving_publication(self) -> None:
        store = InMemoryRegulationRagReleaseCandidateStore()
        enqueue_regulation_rag_release_candidates_for_records(
            store=store,
            records=(self._record(collection="institutional_rules"),),
            runtime_profile=self._profile(
                collection="institutional_rules",
                query_enabled_by_default=True,
            ),
            now=self._now(),
        )

        report = process_pending_regulation_rag_release_candidates(
            store=store,
            release_executor=lambda candidate: (_ for _ in ()).throw(
                ValueError("canonical cleaning provenance failed")
            ),
            now=self._now(),
        )

        self.assertEqual(report.processed_count, 1)
        candidate = store.list_candidates()[0]
        self.assertEqual(candidate.status, "preparation_failed")
        self.assertEqual(candidate.ragPreparationStatus, "failed")
        self.assertEqual(candidate.ragIndexStatus, "not_applicable")
        self.assertEqual(candidate.ragServingStatus, "not_serving")
        self.assertEqual(candidate.ragVerificationStatus, "failed")
        self.assertIn("canonical cleaning provenance failed", candidate.message or "")

    def test_registry_delta_enqueues_created_and_updated_target_records_only(self) -> None:
        store = InMemoryRegulationRagReleaseCandidateStore()
        changed = self._record(collection="institutional_rules", document_id="doc-changed")
        unchanged = self._record(collection="institutional_rules", document_id="doc-unchanged")
        registry = InMemoryDocumentRegistry((changed, unchanged))

        report = enqueue_regulation_rag_release_candidates_for_registry_delta(
            store=store,
            registry=registry,
            corpus="regulations",
            collection="institutional_rules",
            changed_document_ids=("doc-changed",),
            runtime_profile=self._profile(
                collection="institutional_rules",
                query_enabled_by_default=True,
            ),
            now=self._now(),
        )

        self.assertEqual(report.created_count, 1)
        self.assertEqual([item.document_id for item in store.list_candidates()], ["doc-changed"])

    def test_registry_scope_executor_prepares_and_releases_candidate_scope(self) -> None:
        calls: list[tuple[str, dict[str, object]]] = []

        def prepare(**kwargs):
            calls.append(("prepare", kwargs))
            return object()

        class _ReleaseReport:
            release_id = "release-001"
            retrieval_acceptance_status = "passed"
            post_publish_audit_status = "passed"

        def release(**kwargs):
            calls.append(("release", kwargs))
            return _ReleaseReport()

        executor = build_registry_scope_rag_release_executor(
            prepare_registry_scope_chunks=prepare,
            release_registry_scope=release,
            acceptance_case_path="/tmp/regulation-qrels.jsonl",
            release_admission_manifest_key="regulations/operations/release-admission.json",
            publish_alias=True,
        )

        result = executor(
            self._candidate(
                collection="institutional_rules",
                query_enabled_by_default=True,
            )
        )

        self.assertEqual(result.status, "passed")
        self.assertEqual(result.release_id, "release-001")
        self.assertEqual(calls[0][0], "prepare")
        self.assertEqual(calls[0][1]["corpus"], "regulations")
        self.assertEqual(calls[0][1]["collection"], "institutional_rules")
        self.assertEqual(calls[0][1]["preparation_run_id"], "candidate-001")
        self.assertTrue(calls[0][1]["require_current_cleaning_provenance"])
        self.assertEqual(calls[1][0], "release")
        self.assertEqual(calls[1][1]["preparation_run_id"], "candidate-001")
        self.assertEqual(calls[1][1]["acceptance_case_path"], "/tmp/regulation-qrels.jsonl")
        self.assertEqual(
            calls[1][1]["release_admission_manifest_key"],
            "regulations/operations/release-admission.json",
        )
        self.assertTrue(calls[1][1]["publish_alias"])

    def test_query_enabled_regulation_candidate_blocks_without_release_admission(self) -> None:
        store = InMemoryRegulationRagReleaseCandidateStore()
        enqueue_regulation_rag_release_candidates_for_records(
            store=store,
            records=(self._record(collection="institutional_rules"),),
            runtime_profile=self._profile(
                collection="institutional_rules",
                query_enabled_by_default=True,
            ),
            now=self._now(),
        )

        executor = build_registry_scope_rag_release_executor(
            prepare_registry_scope_chunks=lambda **_kwargs: self.fail(
                "release admission must be checked before chunk preparation"
            ),
            release_registry_scope=lambda **_kwargs: self.fail(
                "release admission must be checked before release execution"
            ),
            publish_alias=True,
        )
        report = process_pending_regulation_rag_release_candidates(
            store=store,
            release_executor=executor,
            now=self._now(),
        )

        candidate = store.list_candidates()[0]
        self.assertEqual(report.processed_count, 1)
        self.assertEqual(report.admission_blocked_count, 1)
        self.assertEqual(report.status_counts, {"release_admission_blocked": 1})
        self.assertEqual(candidate.status, "release_admission_blocked")
        self.assertEqual(candidate.ragPreparationStatus, "blocked")
        self.assertEqual(candidate.ragIndexStatus, "not_applicable")
        self.assertEqual(candidate.ragServingStatus, "not_serving")
        self.assertEqual(candidate.ragVerificationStatus, "not_applicable")
        self.assertIn("release admission manifest", candidate.message or "")

    def test_operator_status_projection_is_sanitized(self) -> None:
        store = InMemoryRegulationRagReleaseCandidateStore()
        enqueue_regulation_rag_release_candidates_for_records(
            store=store,
            records=(self._record(collection="institutional_rules"),),
            runtime_profile=self._profile(
                collection="institutional_rules",
                query_enabled_by_default=True,
            ),
            now=self._now(),
        )
        candidate = store.list_candidates()[0]

        status = build_operator_rag_release_status(candidate)

        self.assertEqual(
            set(status),
            {
                "documentSiteStatus",
                "ragPreparationStatus",
                "ragIndexStatus",
                "ragServingStatus",
                "ragVerificationStatus",
            },
        )
        self.assertNotIn("document_units_object_key", str(status))
        self.assertNotIn("objectKey", str(status))

    def _record(
        self,
        *,
        collection: str,
        document_id: str = "doc-001",
        revision_track: str = "current-effective",
        version_id: str = "version-001",
        source_uri: str | None = None,
        status: str = "active",
        is_current: bool = True,
    ) -> DocumentRegistryRecord:
        return DocumentRegistryRecord(
            document_id=document_id,
            revision_track=revision_track,
            version_id=version_id,
            source_uri=source_uri or f"campusrag://regulations/{document_id}",
            content_hash="sha256:content-001",
            corpus="regulations",
            collection=collection,
            cleaning_policy_version=f"{collection}_cleaning_v1",
            entitlement_groups=("campus_members",),
            visibility_scope="campus",
            visibility_level="restricted",
            status=status,
            ingestion_timestamp="2026-05-02T00:00:00+00:00",
            parser_version="test-parser-v1",
            embedding_model="test-embedding",
            source_channel="authenticated_notice_portal",
            is_current=is_current,
            document_units_object_key=(
                f"regulations/documents/{collection}/doc-001/source-faithful/"
                "2026/document-units.jsonl"
            ),
            import_source="test",
        )

    def _candidate(
        self,
        *,
        collection: str,
        query_enabled_by_default: bool,
    ):
        store = InMemoryRegulationRagReleaseCandidateStore()
        enqueue_regulation_rag_release_candidates_for_records(
            store=store,
            records=(self._record(collection=collection),),
            runtime_profile=self._profile(
                collection=collection,
                query_enabled_by_default=query_enabled_by_default,
            ),
            now=self._now(),
        )
        return replace(store.list_candidates()[0], candidate_id="candidate-001")

    def _profile(
        self,
        *,
        collection: str,
        query_enabled_by_default: bool,
    ) -> CollectionRuntimeProfile:
        return CollectionRuntimeProfile(
            corpus="regulations",
            collection=collection,
            serving_stage="query_serving",
            allowed_artifact_modes=("normalized", "source_truth_only"),
            split_manifest_required=False,
            cleaning_policy_version=f"{collection}_cleaning_v1",
            chunk_profile_version=f"{collection}_semantic_v1",
            retrieval_enabled=True,
            query_enabled_by_default=query_enabled_by_default,
            current_only=True,
            serving_revision_tracks=("current-effective",),
        )

    def _now(self) -> datetime:
        return datetime(2026, 5, 2, 1, 0, tzinfo=UTC)

    def _unexpected_release_executor(self, candidate):
        raise AssertionError(f"release executor should not be called for {candidate.status}")


if __name__ == "__main__":
    unittest.main()
