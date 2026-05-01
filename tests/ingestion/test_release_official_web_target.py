from __future__ import annotations

import json
import unittest
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.campusrag_ingestion_reporting import ImportReport
from campus_ingestion_worker.release_official_web_target import release_official_web_target


class _FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = dict(objects or {})

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data


class _FakeAppApiClient:
    def __init__(self, release_gate: dict[str, object]) -> None:
        self.release_gate = release_gate
        self.status_updates: list[tuple[str, dict[str, object]]] = []

    def get_release_gate(self, *, release_id: str) -> dict[str, object]:
        self.status_updates.append(("get", {"release_id": release_id}))
        return self.release_gate

    def update_release_gate_execution_status(
        self, *, release_id: str, payload: dict[str, object]
    ) -> None:
        self.status_updates.append((release_id, payload))


@dataclass(frozen=True)
class _ReleaseReport:
    release_id: str
    corpus: str
    collection: str
    document_count: int
    point_count: int
    published_at: str | None = None


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _release_gate() -> dict[str, object]:
    return {
        "decision": "approved",
        "evidenceJson": {
            "sourceObjectKeys": [
                "official_web/muc_public/runs/owrun_school_intro/source-truth-bundle.json"
            ],
            "sourceUrls": ["https://www.muc.edu.cn/xxgk1/xxjj.htm"],
        },
        "inventoryId": "muc-school-introduction-reference",
        "jobId": "owtarget_school_intro",
        "publishAlias": False,
        "releaseId": "owrelease_muc_school_introduction_reference_owrun_school_intro",
        "runId": "owrun_school_intro",
        "status": "approved",
    }


class ReleaseOfficialWebTargetTest(unittest.TestCase):
    def test_release_imports_only_target_document_without_scope_refreshing_stable_reference(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_store = _FakeObjectStore(
                {
                    (
                        "campus-rag-source",
                        "official_web/muc_public/runs/owrun_school_intro/source-truth-bundle.json",
                    ): json.dumps(
                        {
                            "pages": [],
                            "runId": "owrun_school_intro",
                            "siteId": "muc_public",
                        }
                    ).encode("utf-8")
                }
            )
            client = _FakeAppApiClient(_release_gate())

            def fake_replay(*, output_dir: Path, projection_output_dir: Path, **_: object):
                _write_json(
                    projection_output_dir / "projection-report.json",
                    {
                        "documents": [
                            {
                                "document_id": "doc_target",
                                "materialization_policy": "release_gate_required",
                                "normalized_canonical_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                                "serving_intent": "promotable",
                                "target_collection": "stable_reference",
                                "target_corpus": "official_web",
                                "target_job_id": "owtarget_school_intro",
                            },
                            {
                                "document_id": "doc_other_stable_reference",
                                "materialization_policy": "release_gate_required",
                                "normalized_canonical_url": "https://www.muc.edu.cn/other.htm",
                                "serving_intent": "promotable",
                                "target_collection": "stable_reference",
                                "target_corpus": "official_web",
                                "target_job_id": "owtarget_other",
                            },
                            {
                                "document_id": "doc_other_scope",
                                "materialization_policy": "candidate_only",
                                "normalized_canonical_url": "https://www.muc.edu.cn/contact.htm",
                                "serving_intent": "promotable",
                                "target_collection": "contact_directory",
                                "target_corpus": "campus_services",
                                "target_job_id": "owtarget_contact",
                            },
                        ]
                    },
                )
                return {"counts": {"emitted_documents": 3}}

            import_report = ImportReport(
                import_mode="official_web_source_truth_replay",
                report_path=str(root / "import-report.json"),
                success_count=1,
                skipped_count=0,
                failed_count=0,
                raw_uploaded_count=0,
                raw_reused_count=0,
                document_ids=("doc_target",),
                created_document_ids=("doc_target",),
                updated_document_ids=(),
                skipped_document_ids=(),
                unresolved_source_pdfs=(),
                errors=(),
            )

            with (
                patch(
                    "campus_ingestion_worker.release_official_web_target.materialize_replay_input"
                ),
                patch(
                    "campus_ingestion_worker.release_official_web_target.replay_official_web_source_truth_local",
                    side_effect=fake_replay,
                ),
                patch(
                    "campus_ingestion_worker.release_official_web_target.import_projection_output",
                    return_value=import_report,
                ) as import_projection_output,
                patch(
                    "campus_ingestion_worker.release_official_web_target.release_registry_scope",
                    return_value=_ReleaseReport(
                        release_id="official_web_stable_reference__r20260501_081000",
                        corpus="official_web",
                        collection="stable_reference",
                        document_count=1,
                        point_count=4,
                    ),
                ) as release_registry_scope,
            ):
                result = release_official_web_target(
                    release_id="owrelease_muc_school_introduction_reference_owrun_school_intro",
                    app_api_client=client,
                    object_store=object_store,
                    derived_object_store=object_store,
                    document_registry=object(),
                    raw_asset_registry=object(),
                    work_dir=root / "release",
                )

            kwargs = import_projection_output.call_args.kwargs
            self.assertIsNone(kwargs["scope_refresh"])
            self.assertTrue(kwargs["require_promotable"])
            filtered_report = json.loads(
                (kwargs["projection_output_dir"] / "projection-report.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(
                [document["document_id"] for document in filtered_report["documents"]],
                ["doc_target"],
            )
            release_registry_scope.assert_called_once_with(
                corpus="official_web",
                collection="stable_reference",
                preparation_run_id="owrelease_muc_school_introduction_reference_owrun_school_intro",
                acceptance_case_path=None,
                reset_index=False,
                publish_alias=False,
            )
            self.assertEqual(result.status, "indexed")
            self.assertEqual(
                [
                    payload.get("status")
                    for _, payload in client.status_updates
                    if "status" in payload
                ],
                ["running", "materialized", "indexed"],
            )


if __name__ == "__main__":
    unittest.main()
