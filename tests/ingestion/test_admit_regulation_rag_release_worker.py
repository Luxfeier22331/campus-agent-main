from __future__ import annotations

import importlib
import io
import json
import unittest
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.regulation_rag_release_admission import (
    RegulationRagReleaseAdmissionDocumentRef,
    RegulationRagReleaseAdmissionManifest,
)

from tests.ingestion.index_release_acceptance_support import _make_record

_MODULE_NAME = "campus_ingestion_worker.admit_regulation_rag_release"


@dataclass(frozen=True)
class _FakeSettings:
    bucket_derived: str = "campus-rag-derived"


def _fake_passed_chunk_quality_gate():
    return SimpleNamespace(
        chunk_quality_status="passed",
        summary={
            "answer_ready_contract_status": "passed",
            "answer_ready_required_field_failures": (),
            "answer_ready_semantic_failures": (),
        },
    )


class AdmitRegulationRagReleaseWorkerCliTest(unittest.TestCase):
    def test_main_requires_component_eval_summary_for_query_enabled_regulation_scope(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        record = _make_record()

        with (
            patch(f"{_MODULE_NAME}.load_worker_env"),
            patch(f"{_MODULE_NAME}.ObjectStoreSettings.from_env") as from_env,
            patch(f"{_MODULE_NAME}.S3ObjectStoreAdmin") as object_store_admin,
            patch(f"{_MODULE_NAME}.build_document_registry_from_env") as build_registry,
            patch(f"{_MODULE_NAME}.load_runtime_profile") as load_profile,
            patch(f"{_MODULE_NAME}.select_releasable_registry_records") as select_records,
            patch(f"{_MODULE_NAME}.load_chunk_preparation_manifest") as load_preparation,
            patch(
                f"{_MODULE_NAME}.evaluate_prepared_regulation_rag_release_chunk_quality"
            ) as evaluate_chunk_quality,
            patch(
                f"{_MODULE_NAME}.build_regulation_rag_release_admission_manifest"
            ) as build_manifest,
            patch(
                f"{_MODULE_NAME}.write_regulation_rag_release_admission_manifest"
            ) as write_manifest,
        ):
            from_env.return_value = _FakeSettings()
            object_store_admin.return_value = object()
            build_registry.return_value = SimpleNamespace(list_by_scope=lambda _c, _k: (record,))
            load_profile.return_value = load_runtime_profile("regulations", "student_rules")
            select_records.return_value = (record,)
            load_preparation.return_value = object()
            evaluate_chunk_quality.return_value = _fake_passed_chunk_quality_gate()

            with self.assertRaisesRegex(
                ValueError,
                "component eval summary is required before query-enabled regulation release admission",
            ):
                worker.main(
                    [
                        "--collection",
                        "student_rules",
                        "--preparation-run-id",
                        "phase09-student-release",
                        "--admission-run-id",
                        "phase09-student-release",
                    ]
                )

        build_manifest.assert_not_called()
        write_manifest.assert_not_called()

    def test_main_writes_release_admission_manifest_for_current_registry_scope(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        record = DocumentRegistryRecord(
            corpus="regulations",
            collection="institutional_rules",
            document_id="institutional_regulation:muc:中央民族大学学生社团管理办法:7da72ac3d796",
            revision_track="current-effective",
            version_id=(
                "sha256:5c66a76ef416c5e1b632eea6ebdfcf7a3befe171a4761196ba5e7bb99f698136"
                ":effective-undated:revision-none"
            ),
            source_uri="notice://619",
            canonical_markdown_object_key=(
                "regulations/documents/institutional_rules/中央民族大学学生社团管理办法--7da72ac3/"
                "current-effective/undated/canonical.md"
            ),
            document_units_object_key=(
                "regulations/documents/institutional_rules/中央民族大学学生社团管理办法--7da72ac3/"
                "current-effective/undated/document-units.jsonl"
            ),
            content_hash="5c66a76ef416c5e1b632eea6ebdfcf7a3befe171a4761196ba5e7bb99f698136",
            status="active",
            is_current=True,
            ingestion_timestamp="2026-05-03T00:00:00+00:00",
            parser_version="collected_notice_regulation_canonical_cleaning_v9",
            source_channel="authenticated_notice_portal",
            import_source="historical-regulation-denominator-expansion",
            cleaning_policy_version="institutional_rules_cleaning_v1",
        )
        admission_manifest = RegulationRagReleaseAdmissionManifest(
            schema_version="regulation_rag_release_admission.v1",
            policy_version="regulation_rag_release_admission_policy.v2",
            admission_run_id="phase09-institutional-release",
            corpus="regulations",
            collection="institutional_rules",
            admission_status="passed",
            admitted_at="2026-05-03T00:00:00+00:00",
            cleaning_policy_version="institutional_rules_cleaning_v1",
            chunk_profile_version="institutional_rules_semantic_v1",
            runtime_profile_identity="sha256:profile",
            document_count=1,
            documents=(
                RegulationRagReleaseAdmissionDocumentRef(
                    document_id=record.document_id,
                    revision_track=record.revision_track,
                    version_id=record.version_id,
                    content_hash=record.content_hash,
                    document_units_object_key=record.document_units_object_key or "",
                    document_units_sha256="sha256-document-units",
                    cleaning_policy_version="institutional_rules_cleaning_v1",
                    chunk_profile_version="institutional_rules_semantic_v1",
                    runtime_profile_identity="sha256:profile",
                    reader_current_version_id=record.version_id,
                ),
            ),
        )

        with (
            patch(f"{_MODULE_NAME}.load_worker_env"),
            patch(f"{_MODULE_NAME}.ObjectStoreSettings.from_env") as from_env,
            patch(f"{_MODULE_NAME}.S3ObjectStoreAdmin") as object_store_admin,
            patch(f"{_MODULE_NAME}.build_document_registry_from_env") as build_registry,
            patch(f"{_MODULE_NAME}.load_runtime_profile") as load_profile,
            patch(f"{_MODULE_NAME}.select_releasable_registry_records") as select_records,
            patch(f"{_MODULE_NAME}.load_chunk_preparation_manifest") as load_preparation,
            patch(
                f"{_MODULE_NAME}.evaluate_prepared_regulation_rag_release_chunk_quality"
            ) as evaluate_chunk_quality,
            patch(
                f"{_MODULE_NAME}.build_regulation_rag_release_admission_manifest"
            ) as build_manifest,
            patch(
                f"{_MODULE_NAME}.write_regulation_rag_release_admission_manifest"
            ) as write_manifest,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            registry = SimpleNamespace(list_by_scope=lambda _corpus, _collection: (record,))
            runtime_profile = load_runtime_profile("regulations", "institutional_rules")
            preparation_manifest = SimpleNamespace(
                validation_status="passed",
                validation_summary_object_key=(
                    "regulations/operations/registry-scope-chunk-preparation/"
                    "phase09-institutional-release/institutional_rules/validation-summary.json"
                ),
                documents=(),
            )
            object_store = object()
            from_env.return_value = _FakeSettings()
            object_store_admin.return_value = object_store
            build_registry.return_value = registry
            load_profile.return_value = runtime_profile
            select_records.return_value = (record,)
            load_preparation.return_value = preparation_manifest
            evaluate_chunk_quality.return_value = _fake_passed_chunk_quality_gate()
            build_manifest.return_value = admission_manifest
            write_manifest.return_value = (
                "regulations/operations/regulation-rag-release-admission/"
                "phase09-institutional-release/institutional_rules/release-admission.json"
            )
            with TemporaryDirectory() as temp_dir:
                component_eval_summary_path = Path(temp_dir) / "component-eval-summary.json"
                component_eval_summary_path.write_text(
                    json.dumps(
                        {
                            "schema_version": 1,
                            "case_family": "answer_ready_component_eval.v1",
                            "summary": {
                                "overall_passed": True,
                                "failed": 0,
                                "primary_failure_stage_counts": {},
                                "secondary_failure_stage_counts": {},
                            },
                            "results": [],
                        },
                        ensure_ascii=False,
                    )
                    + "\n",
                    encoding="utf-8",
                )

                worker.main(
                    [
                        "--corpus",
                        "regulations",
                        "--collection",
                        "institutional_rules",
                        "--preparation-run-id",
                        "phase09-institutional-release",
                        "--admission-run-id",
                        "phase09-institutional-release",
                        "--component-eval-summary-path",
                        str(component_eval_summary_path),
                        "--admitted-at",
                        "2026-05-03T00:00:00+00:00",
                        "--note",
                        "chunk quality accepted before release",
                    ]
                )

        build_registry.assert_called_once_with(prefer_operator=True)
        load_profile.assert_called_once_with("regulations", "institutional_rules")
        select_records.assert_called_once_with(
            records=(record,),
            runtime_profile=runtime_profile,
        )
        load_preparation.assert_called_once_with(
            reader=object_store,
            bucket="campus-rag-derived",
            corpus="regulations",
            collection="institutional_rules",
            preparation_run_id="phase09-institutional-release",
        )
        build_manifest.assert_called_once_with(
            admission_run_id="phase09-institutional-release",
            corpus="regulations",
            collection="institutional_rules",
            records=(record,),
            runtime_profile=runtime_profile,
            preparation_manifest=preparation_manifest,
            admitted_at="2026-05-03T00:00:00+00:00",
            chunk_quality_status="passed",
            answer_ready_contract_status="passed",
            answer_ready_required_field_failures=(),
            answer_ready_semantic_failures=(),
            semantic_oracle_status="passed",
            notes=("chunk quality accepted before release",),
        )
        write_manifest.assert_called_once_with(
            writer=object_store,
            bucket="campus-rag-derived",
            manifest=admission_manifest,
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["document_count"], 1)
        self.assertEqual(
            payload["admission_manifest_object_key"],
            "regulations/operations/regulation-rag-release-admission/"
            "phase09-institutional-release/institutional_rules/release-admission.json",
        )

    def test_main_loads_component_eval_summary_and_derives_admission_status_fields(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        record = _make_record()
        admission_manifest = RegulationRagReleaseAdmissionManifest(
            schema_version="regulation_rag_release_admission.v1",
            policy_version="regulation_rag_release_admission_policy.v2",
            admission_run_id="phase09-student-release",
            corpus="regulations",
            collection="student_rules",
            admission_status="passed",
            admitted_at="2026-05-03T00:00:00+00:00",
            cleaning_policy_version="student_rules_cleaning_v1",
            chunk_profile_version="student_rules_semantic_v1",
            runtime_profile_identity="sha256:profile",
            document_count=1,
            documents=(),
            semantic_oracle_status="passed",
        )

        with TemporaryDirectory() as temp_dir:
            summary_path = Path(temp_dir) / "component-eval-summary.json"
            summary_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "case_family": "answer_ready_component_eval.v1",
                        "summary": {
                            "overall_passed": True,
                            "failed": 0,
                            "primary_failure_stage_counts": {},
                            "secondary_failure_stage_counts": {},
                        },
                        "results": [],
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            with (
                patch(f"{_MODULE_NAME}.load_worker_env"),
                patch(f"{_MODULE_NAME}.ObjectStoreSettings.from_env") as from_env,
                patch(f"{_MODULE_NAME}.S3ObjectStoreAdmin") as object_store_admin,
                patch(f"{_MODULE_NAME}.build_document_registry_from_env") as build_registry,
                patch(f"{_MODULE_NAME}.load_runtime_profile") as load_profile,
                patch(f"{_MODULE_NAME}.select_releasable_registry_records") as select_records,
                patch(f"{_MODULE_NAME}.load_chunk_preparation_manifest") as load_preparation,
                patch(
                    f"{_MODULE_NAME}.evaluate_prepared_regulation_rag_release_chunk_quality"
                ) as evaluate_chunk_quality,
                patch(
                    f"{_MODULE_NAME}.build_regulation_rag_release_admission_manifest"
                ) as build_manifest,
                patch(
                    f"{_MODULE_NAME}.write_regulation_rag_release_admission_manifest"
                ) as write_manifest,
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                registry = SimpleNamespace(list_by_scope=lambda _corpus, _collection: (record,))
                runtime_profile = load_runtime_profile("regulations", "student_rules")
                preparation_manifest = SimpleNamespace(
                    validation_status="passed",
                    validation_summary_object_key=(
                        "regulations/operations/registry-scope-chunk-preparation/"
                        "phase09-student-release/student_rules/validation-summary.json"
                    ),
                    documents=(),
                )
                object_store = object()
                from_env.return_value = _FakeSettings()
                object_store_admin.return_value = object_store
                build_registry.return_value = registry
                load_profile.return_value = runtime_profile
                select_records.return_value = (record,)
                load_preparation.return_value = preparation_manifest
                evaluate_chunk_quality.return_value = _fake_passed_chunk_quality_gate()
                build_manifest.return_value = admission_manifest
                write_manifest.return_value = (
                    "regulations/operations/regulation-rag-release-admission/"
                    "phase09-student-release/student_rules/release-admission.json"
                )

                worker.main(
                    [
                        "--collection",
                        "student_rules",
                        "--preparation-run-id",
                        "phase09-student-release",
                        "--admission-run-id",
                        "phase09-student-release",
                        "--component-eval-summary-path",
                        str(summary_path),
                    ]
                )

        self.assertEqual(build_manifest.call_args.kwargs["semantic_oracle_status"], "passed")
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["admission_manifest"]["semantic_oracle_status"], "passed")

    def test_main_blocks_when_release_chunk_quality_gate_fails_for_query_enabled_regulation_scope(
        self,
    ) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        record = _make_record()

        with TemporaryDirectory() as temp_dir:
            summary_path = Path(temp_dir) / "component-eval-summary.json"
            summary_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "case_family": "answer_ready_component_eval.v1",
                        "summary": {
                            "overall_passed": True,
                            "failed": 0,
                            "primary_failure_stage_counts": {},
                            "secondary_failure_stage_counts": {},
                        },
                        "results": [],
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            with (
                patch(f"{_MODULE_NAME}.load_worker_env"),
                patch(f"{_MODULE_NAME}.ObjectStoreSettings.from_env") as from_env,
                patch(f"{_MODULE_NAME}.S3ObjectStoreAdmin") as object_store_admin,
                patch(f"{_MODULE_NAME}.build_document_registry_from_env") as build_registry,
                patch(f"{_MODULE_NAME}.load_runtime_profile") as load_profile,
                patch(f"{_MODULE_NAME}.select_releasable_registry_records") as select_records,
                patch(f"{_MODULE_NAME}.load_chunk_preparation_manifest") as load_preparation,
                patch(
                    f"{_MODULE_NAME}.evaluate_prepared_regulation_rag_release_chunk_quality"
                ) as evaluate_chunk_quality,
                patch(
                    f"{_MODULE_NAME}.build_regulation_rag_release_admission_manifest"
                ) as build_manifest,
                patch(
                    f"{_MODULE_NAME}.write_regulation_rag_release_admission_manifest"
                ) as write_manifest,
            ):
                from_env.return_value = _FakeSettings()
                object_store_admin.return_value = object()
                build_registry.return_value = SimpleNamespace(
                    list_by_scope=lambda _c, _k: (record,)
                )
                load_profile.return_value = load_runtime_profile("regulations", "student_rules")
                select_records.return_value = (record,)
                load_preparation.return_value = SimpleNamespace(
                    validation_status="passed",
                    validation_summary_object_key=(
                        "regulations/operations/registry-scope-chunk-preparation/"
                        "phase09-student-release/student_rules/validation-summary.json"
                    ),
                    documents=(),
                )
                evaluate_chunk_quality.side_effect = ValueError(
                    "release quality gate failed for regulations/student_rules"
                )

                with self.assertRaisesRegex(
                    ValueError,
                    "release quality gate failed for regulations/student_rules",
                ):
                    worker.main(
                        [
                            "--collection",
                            "student_rules",
                            "--preparation-run-id",
                            "phase09-student-release",
                            "--admission-run-id",
                            "phase09-student-release",
                            "--component-eval-summary-path",
                            str(summary_path),
                        ]
                    )

        build_manifest.assert_not_called()
        write_manifest.assert_not_called()


if __name__ == "__main__":
    unittest.main()
