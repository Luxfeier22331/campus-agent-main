from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    CONSUMER_ADMISSION_DECISION_ADMIT,
    CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
    CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
    ConsumerAdmissionDecisionRecord,
    InternalNoticeConsumerAdmissionManifest,
    compute_consumer_admission_selection_sha256,
    write_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
)
from tests.ingestion.test_notice_derived_contact_candidate import _runtime

worker = importlib.import_module(
    "campus_ingestion_worker.build_notice_stable_contact_candidates"
)


class _FakeProjectionStore:
    def __init__(self, entries):
        self.entries = tuple(entries)
        self.calls: list[dict[str, object]] = []

    def list_by_scope(
        self,
        source_corpus: str,
        source_collection: str,
        *,
        notice_ids=(),
    ):
        self.calls.append(
            {
                "source_corpus": source_corpus,
                "source_collection": source_collection,
                "notice_ids": tuple(notice_ids),
            }
        )
        selected = set(notice_ids)
        return tuple(entry for entry in self.entries if entry.source_notice_id in selected)


class BuildNoticeStableContactCandidatesWorkerTest(unittest.TestCase):
    def test_main_builds_notice_stable_contact_candidate_bundle(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            selection_path = root / "selected-notices.json"
            manifest_path = root / "consumer-admission-manifest.json"
            selection_path.write_text(
                json.dumps({"selected_notice_ids": ["355131"]}),
                encoding="utf-8",
            )
            _write_consumer_manifest(
                manifest_path,
                notice_ids=("355131",),
                target_surface=NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
            )
            registry, object_store, entry = _runtime(
                notice_id="355131",
                notice_title="关于调整信息化建设管理处一卡通中心办公地点及联系电话的通知",
                body=(
                    "# 关于调整信息化建设管理处一卡通中心办公地点及联系电话的通知\n\n"
                    "一卡通中心 68932649\n"
                ),
            )
            projection_store = _FakeProjectionStore((entry,))

            with (
                patch(
                    "campus_ingestion_worker.build_notice_stable_contact_candidates.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.build_notice_stable_contact_candidates.ObjectStoreSettings.from_env",
                    return_value=SimpleNamespace(bucket_derived="campus-rag-derived"),
                ),
                patch(
                    "campus_ingestion_worker.build_notice_stable_contact_candidates.S3ObjectStoreAdmin",
                    return_value=object_store,
                ),
                patch(
                    "campus_ingestion_worker.build_notice_stable_contact_candidates.build_notice_consumption_projection_store_from_env",
                    return_value=projection_store,
                ),
                patch(
                    "campus_ingestion_worker.build_notice_stable_contact_candidates.build_document_registry_from_env",
                    return_value=registry,
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--selection-path",
                        str(selection_path),
                        "--consumer-admission-manifest-path",
                        str(manifest_path),
                        "--work-dir",
                        str(root / "work"),
                        "--generated-at",
                        "2026-04-27T11:00:00+08:00",
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["candidate_count"], 1)
            self.assertEqual(
                projection_store.calls,
                [
                    {
                        "source_corpus": "campus_notices",
                        "source_collection": "internal_notice",
                        "notice_ids": ("355131",),
                    }
                ],
            )
            bundle = json.loads(
                (root / "work" / "notice-stable-contact-candidates.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(bundle["candidate_records"][0]["phone_number"], "68932649")

    def test_main_blocks_when_manifest_target_surface_is_mismatched(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            selection_path = root / "selected-notices.json"
            manifest_path = root / "consumer-admission-manifest.json"
            selection_path.write_text(
                json.dumps({"selected_notice_ids": ["355131"]}),
                encoding="utf-8",
            )
            _write_consumer_manifest(
                manifest_path,
                notice_ids=("355131",),
                target_surface="campus_services/service_status_candidate",
            )
            with (
                patch(
                    "campus_ingestion_worker.build_notice_stable_contact_candidates.load_worker_env"
                ),
                self.assertRaisesRegex(ValueError, "consumer admission manifest gate blocked"),
            ):
                worker.main(
                    [
                        "--selection-path",
                        str(selection_path),
                        "--consumer-admission-manifest-path",
                        str(manifest_path),
                        "--work-dir",
                        str(root / "work"),
                    ]
                )


def _write_consumer_manifest(
    path: Path,
    *,
    notice_ids: tuple[str, ...],
    target_surface: str,
) -> None:
    manifest = InternalNoticeConsumerAdmissionManifest(
        admission_run_id="consumer-admission-test",
        source_channel="authenticated_notice_portal",
        corpus="campus_notices",
        collection="internal_notice",
        selection_source="bundle_dry_run",
        selection_path="bundle.json",
        selection_sha256=compute_consumer_admission_selection_sha256(notice_ids),
        scope_write_mode=CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
        selected_notice_ids=notice_ids,
        decision_records=tuple(
            ConsumerAdmissionDecisionRecord(
                notice_id=notice_id,
                source_notice_id=notice_id,
                site_id="muc_internal_portal",
                raw_asset_id=f"asset:authenticated-notice:muc_internal_portal:{notice_id}",
                raw_version_id=f"sha256:bundle:{notice_id}",
                notice_family="stable_contact_update",
                suggested_consumption_route="stable_contact_candidate",
                target_surface=target_surface,
                consumption_status=CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
                admission_decision=CONSUMER_ADMISSION_DECISION_ADMIT,
                admission_reason_codes=("stable_contact_candidate",),
                body_quality="body_present",
                attachment_ref_count=0,
                reference_only_attachment_ref_count=0,
                owner_expectation_count=0,
                pending_multimodal_attachment_count=0,
            )
            for notice_id in notice_ids
        ),
        created_at="2026-04-27T00:00:00+00:00",
    )
    write_internal_notice_consumer_admission_manifest(path, manifest)


if __name__ == "__main__":
    unittest.main()
