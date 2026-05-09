from __future__ import annotations

from types import SimpleNamespace

from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.regulation_rag_release_admission import (
    RegulationRagReleaseAdmissionError,
    build_regulation_rag_release_admission_manifest,
    validate_regulation_rag_release_admission_for_release,
    validate_regulation_rag_release_admission_manifest_shape,
    write_regulation_rag_release_admission_manifest,
)

from tests.ingestion.index_release_acceptance_test_support import (
    _FakeObjectStore,
    _make_record,
)


class IndexReleaseAcceptanceAdmissionSuite:
    def test_release_admission_manifest_carries_phase5_answer_ready_quality_fields(self) -> None:
        manifest = build_regulation_rag_release_admission_manifest(
            admission_run_id="run-phase5",
            corpus="regulations",
            collection="student_rules",
            records=(_make_record(),),
            runtime_profile=load_runtime_profile("regulations", "student_rules"),
            preparation_manifest=SimpleNamespace(
                documents=(
                    SimpleNamespace(
                        document_id="student_rules:handbook",
                        revision_track="current-effective",
                        version_id="sha256:handbook-v1",
                        document_units_sha256="sha256-document-units",
                    ),
                )
            ),
            answer_ready_contract_status="passed",
            answer_ready_contract_version="answer_ready_evidence.v3",
            answer_ready_required_field_failures=(),
            answer_ready_semantic_failures=(),
            fallback_budget_status="not_applicable",
            semantic_oracle_status="pending_phase8",
        )

        self.assertEqual(manifest.answer_ready_contract_version, "answer_ready_evidence.v3")
        self.assertEqual(manifest.answer_ready_required_field_failures, ())
        self.assertEqual(manifest.answer_ready_semantic_failures, ())
        self.assertEqual(manifest.fallback_budget_status, "not_applicable")
        self.assertEqual(manifest.semantic_oracle_status, "pending_phase8")

    def test_release_admission_manifest_requires_answer_ready_contract_passed(self) -> None:
        manifest = build_regulation_rag_release_admission_manifest(
            admission_run_id="run-1",
            corpus="regulations",
            collection="student_rules",
            records=(_make_record(),),
            runtime_profile=load_runtime_profile("regulations", "student_rules"),
            preparation_manifest=SimpleNamespace(
                documents=(
                    SimpleNamespace(
                        document_id="student_rules:handbook",
                        revision_track="current-effective",
                        version_id="sha256:handbook-v1",
                        document_units_sha256="sha256-document-units",
                    ),
                )
            ),
            answer_ready_contract_status="failed",
        )

        with self.assertRaisesRegex(
            RegulationRagReleaseAdmissionError,
            "answer_ready_contract_status_not_passed:failed",
        ):
            validate_regulation_rag_release_admission_manifest_shape(manifest)

    def test_release_admission_manifest_rejects_failed_component_eval_statuses(self) -> None:
        manifest = build_regulation_rag_release_admission_manifest(
            admission_run_id="run-2",
            corpus="regulations",
            collection="student_rules",
            records=(_make_record(),),
            runtime_profile=load_runtime_profile("regulations", "student_rules"),
            preparation_manifest=SimpleNamespace(
                documents=(
                    SimpleNamespace(
                        document_id="student_rules:handbook",
                        revision_track="current-effective",
                        version_id="sha256:handbook-v1",
                        document_units_sha256="sha256-document-units",
                    ),
                )
            ),
            semantic_oracle_status="failed",
            fallback_budget_status="failed",
        )

        with self.assertRaisesRegex(
            RegulationRagReleaseAdmissionError,
            "semantic_oracle_status_not_passed:failed",
        ):
            validate_regulation_rag_release_admission_manifest_shape(manifest)

    def test_release_admission_for_release_rejects_pending_component_eval_proof(self) -> None:
        runtime_profile = load_runtime_profile("regulations", "student_rules")
        preparation_manifest = SimpleNamespace(
            documents=(
                SimpleNamespace(
                    document_id="student_rules:handbook",
                    revision_track="current-effective",
                    version_id="sha256:handbook-v1",
                    document_units_sha256="sha256-document-units",
                ),
            )
        )
        manifest = build_regulation_rag_release_admission_manifest(
            admission_run_id="run-3",
            corpus="regulations",
            collection="student_rules",
            records=(_make_record(),),
            runtime_profile=runtime_profile,
            preparation_manifest=preparation_manifest,
            semantic_oracle_status="pending_phase8",
            fallback_budget_status="not_applicable",
        )

        issues = validate_regulation_rag_release_admission_for_release(
            manifest=manifest,
            corpus="regulations",
            collection="student_rules",
            runtime_profile=runtime_profile,
            records=(_make_record(),),
            preparation_manifest=preparation_manifest,
        )

        self.assertIn("semantic_oracle_status_not_passed:pending_phase8", issues)
        self.assertIn("fallback_budget_status_not_passed:not_applicable", issues)

    def test_release_admission_manifest_write_rejects_conflicting_rewrite_for_same_run_id(
        self,
    ) -> None:
        runtime_profile = load_runtime_profile("regulations", "student_rules")
        preparation_manifest = SimpleNamespace(
            documents=(
                SimpleNamespace(
                    document_id="student_rules:handbook",
                    revision_track="current-effective",
                    version_id="sha256:handbook-v1",
                    document_units_sha256="sha256-document-units",
                ),
            )
        )
        object_store = _FakeObjectStore()
        first_manifest = build_regulation_rag_release_admission_manifest(
            admission_run_id="admit-student-rules-test",
            corpus="regulations",
            collection="student_rules",
            records=(_make_record(),),
            runtime_profile=runtime_profile,
            preparation_manifest=preparation_manifest,
            admitted_at="2026-05-09T07:00:00+00:00",
            semantic_oracle_status="passed",
            fallback_budget_status="passed",
        )
        second_manifest = build_regulation_rag_release_admission_manifest(
            admission_run_id="admit-student-rules-test",
            corpus="regulations",
            collection="student_rules",
            records=(_make_record(),),
            runtime_profile=runtime_profile,
            preparation_manifest=preparation_manifest,
            admitted_at="2026-05-09T07:05:00+00:00",
            semantic_oracle_status="passed",
            fallback_budget_status="passed",
        )

        write_regulation_rag_release_admission_manifest(
            writer=object_store,
            bucket="campus-rag-derived",
            manifest=first_manifest,
        )

        with self.assertRaisesRegex(
            RegulationRagReleaseAdmissionError,
            "admission manifest already exists with different content",
        ):
            write_regulation_rag_release_admission_manifest(
                writer=object_store,
                bucket="campus-rag-derived",
                manifest=second_manifest,
            )
