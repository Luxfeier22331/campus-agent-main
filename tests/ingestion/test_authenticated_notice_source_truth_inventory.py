from __future__ import annotations

import unittest
from dataclasses import asdict

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    _select_latest_authenticated_notice_parent_records_for_inventory,
    document_record_from_authenticated_notice_source_truth_parent_snapshot,
)
from campus_ingestion_core.authenticated_notice_source_truth_replay import (
    SOURCE_TRUTH_REPLAY_INPUT_KIND,
    AuthenticatedNoticeSourceTruthReplayInventory,
    build_authenticated_notice_source_truth_replay_batch_input_payload,
    build_authenticated_notice_source_truth_replay_expected_scope,
    build_authenticated_notice_source_truth_replay_inventory_payload,
    load_authenticated_notice_source_truth_replay_inventory_from_payload,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord, RawAssetRef


def _document_record(document_id: str, version_id: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=version_id,
        source_uri=f"https://portal.example.edu/{document_id}",
        content_hash=version_id,
        corpus="campus_notices",
        collection="internal_notice",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-06T00:00:00+00:00",
        parser_version="authenticated_notice_import_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        raw_asset=RawAssetRef(
            raw_asset_id=f"asset:{document_id}",
            raw_version_id=version_id,
        ),
        processed_object_keys=(f"campus_notices/source-truth/{document_id}/notice-manifest.json",),
        import_source="authenticated_notice_bootstrap_import",
    )


def _raw_record(raw_asset_id: str, raw_version_id: str) -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        corpus="campus_notices",
        collection="internal_notice",
        raw_source_uri=f"https://portal.example.edu/raw/{raw_asset_id}",
        content_hash=raw_version_id,
        source_filename="detail-response.json",
        object_key=f"campus_notices/raw/{raw_asset_id}/{raw_version_id}/detail-response.json",
        ingestion_timestamp="2026-04-06T00:00:00+00:00",
        import_source="authenticated_notice_bootstrap_import",
    )


class AuthenticatedNoticeSourceTruthInventoryPagingTest(unittest.TestCase):
    def test_parent_snapshot_record_parser_rehydrates_registry_record_with_source_keys(
        self,
    ) -> None:
        record = _document_record("notice:muc:000005", "sha256:5")
        parent_snapshot = {
            "record": asdict(record),
            "source_artifact_keys": [
                "source/000005/notice-manifest.json",
                "source/000005/content-blocks.jsonl",
            ],
        }
        record_payload = dict(parent_snapshot["record"])
        record_payload["processed_object_keys"] = []
        parent_snapshot["record"] = record_payload

        parsed = document_record_from_authenticated_notice_source_truth_parent_snapshot(
            parent_snapshot
        )

        self.assertEqual(parsed.document_id, record.document_id)
        self.assertEqual(parsed.revision_track, record.revision_track)
        self.assertEqual(parsed.version_id, record.version_id)
        self.assertEqual(
            parsed.processed_object_keys,
            (
                "source/000005/notice-manifest.json",
                "source/000005/content-blocks.jsonl",
            ),
        )
        self.assertIsNone(parsed.raw_asset)
        self.assertEqual(parsed.source_observations, ())

    def test_inventory_parent_selection_keeps_one_latest_parent_per_notice(self) -> None:
        older = _document_record("notice:example_internal_portal:355122", "sha256:older")
        newer = _document_record("notice:example_internal_portal:355122", "sha256:newer")
        older_raw = _raw_record(older.raw_asset.raw_asset_id, older.raw_asset.raw_version_id)
        newer_raw = _raw_record(newer.raw_asset.raw_asset_id, newer.raw_asset.raw_version_id)
        older_raw = RawAssetRecord(
            **{
                **asdict(older_raw),
                "ingestion_timestamp": "2026-04-01T00:00:00+00:00",
            }
        )
        newer_raw = RawAssetRecord(
            **{
                **asdict(newer_raw),
                "ingestion_timestamp": "2026-04-26T00:00:00+00:00",
            }
        )

        selected = _select_latest_authenticated_notice_parent_records_for_inventory(
            records=(newer, older),
            raw_by_key={
                (older_raw.raw_asset_id, older_raw.raw_version_id): older_raw,
                (newer_raw.raw_asset_id, newer_raw.raw_version_id): newer_raw,
            },
        )

        self.assertEqual([record.version_id for record in selected], ["sha256:newer"])


class AuthenticatedNoticeSourceTruthReplayPayloadContractTest(unittest.TestCase):
    def test_replay_inventory_payload_round_trips_through_repo_owned_helper(self) -> None:
        inventory = AuthenticatedNoticeSourceTruthReplayInventory(
            site_id="example_internal_portal",
            source_home_url="https://portal.example.edu/home",
            embedding_model="Qwen3-Embedding-4B",
            selected_notice_ids=("355119",),
            notice_risk_counts={"body_with_text_attachments": 1},
            high_risk_notice_count=0,
            expected_notice_count=1,
            expected_document_count=2,
            expected_attachment_document_count=1,
            expected_ocr_candidate_count=0,
            expected_raw_asset_count=1,
            parents=(
                {
                    "notice_id": "355119",
                    "document_id": "notice:example_internal_portal:355119",
                    "raw_record": {"raw_asset_id": "asset:355119"},
                    "attachment_projection_plans": [
                        {
                            "attachment_ref_id": "attachment-0001",
                            "classification": "text_extractable",
                            "document_id": "notice_attachment:example_internal_portal:355119:attachment-0001",
                            "materialization_policy": "required_document",
                        }
                    ],
                },
            ),
        )

        payload = build_authenticated_notice_source_truth_replay_inventory_payload(
            run_id="run-1",
            inventory=inventory,
        )
        reparsed = load_authenticated_notice_source_truth_replay_inventory_from_payload(
            payload,
            expected_run_id="run-1",
        )

        self.assertEqual(payload["input_kind"], SOURCE_TRUTH_REPLAY_INPUT_KIND)
        self.assertEqual(reparsed.site_id, inventory.site_id)
        self.assertEqual(reparsed.selected_notice_ids, inventory.selected_notice_ids)
        self.assertEqual(reparsed.notice_risk_counts, inventory.notice_risk_counts)
        self.assertEqual(reparsed.expected_document_count, inventory.expected_document_count)
        self.assertEqual(reparsed.parents, inventory.parents)

    def test_replay_expected_scope_and_batch_payload_share_same_parent_contract(self) -> None:
        parents = (
            {
                "notice_id": "355119",
                "document_id": "notice:example_internal_portal:355119",
                "raw_record": {"raw_asset_id": "asset:355119"},
                "attachment_projection_plans": [
                    {
                        "attachment_ref_id": "attachment-0001",
                        "classification": "text_extractable",
                        "document_id": "notice_attachment:example_internal_portal:355119:attachment-0001",
                        "materialization_policy": "required_document",
                    },
                    {
                        "attachment_ref_id": "attachment-0002",
                        "classification": "ocr_required",
                        "document_id": "notice_attachment:example_internal_portal:355119:attachment-0002",
                        "materialization_policy": "conditional_on_extracted_text",
                    },
                ],
            },
            {
                "notice_id": "355120",
                "document_id": "notice:example_internal_portal:355120",
                "raw_record": {"raw_asset_id": "asset:355120"},
                "attachment_projection_plans": [
                    {
                        "attachment_ref_id": "attachment-0003",
                        "classification": "text_extractable",
                        "document_id": "notice_attachment:example_internal_portal:355120:attachment-0003",
                        "materialization_policy": "required_document",
                    }
                ],
            },
        )

        expected_scope = build_authenticated_notice_source_truth_replay_expected_scope(parents)
        batch_payload = build_authenticated_notice_source_truth_replay_batch_input_payload(
            run_id="run-1",
            batch_id=7,
            shard_id=2,
            notice_ids=("355120", "355119"),
            parent_by_notice_id={str(parent["notice_id"]): dict(parent) for parent in parents},
        )

        self.assertEqual(expected_scope["attachment_document_count"], 2)
        self.assertEqual(expected_scope["ocr_candidate_count"], 1)
        self.assertEqual(
            expected_scope["document_ids"],
            {
                "notice:example_internal_portal:355119",
                "notice:example_internal_portal:355120",
                "notice_attachment:example_internal_portal:355119:attachment-0001",
                "notice_attachment:example_internal_portal:355120:attachment-0003",
            },
        )
        self.assertEqual(batch_payload["input_kind"], SOURCE_TRUTH_REPLAY_INPUT_KIND)
        self.assertEqual(batch_payload["notice_ids"], ["355120", "355119"])
        self.assertEqual(
            [parent["notice_id"] for parent in batch_payload["source_truth_parents"]],
            ["355120", "355119"],
        )

    def test_replay_rejects_legacy_expected_attachment_documents_without_projection_plans(
        self,
    ) -> None:
        parents = (
            {
                "notice_id": "355120",
                "document_id": "notice:example_internal_portal:355120",
                "expected_attachment_documents": [
                    {
                        "attachment_ref_id": "attachment-0003",
                        "classification": "text_extractable",
                        "document_id": "notice_attachment:example_internal_portal:355120:attachment-0003",
                        "materialization_policy": "required_document",
                    }
                ],
            },
        )

        with self.assertRaisesRegex(ValueError, "attachment_projection_plans"):
            build_authenticated_notice_source_truth_replay_expected_scope(parents)


if __name__ == "__main__":
    unittest.main()
