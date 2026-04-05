from __future__ import annotations

import json
from typing import Any

from campus_ingestion_core.authenticated_notice_closeout_artifacts import (
    CloseoutArtifactManager,
)
from campus_ingestion_core.authenticated_notice_closeout_store import CloseoutStore
from campus_ingestion_core.authenticated_notice_source_truth_replay import (
    SOURCE_TRUTH_REPLAY_INPUT_KIND,
)
from campus_ingestion_core.authenticated_notice_source_truth import (
    build_authenticated_notice_raw_asset_id,
)
from campus_ingestion_core.settings import ObjectStoreSettings


class CloseoutVerifier:
    def reconcile_documents(
        self,
        expected_document_ids: set[str],
        observed_document_ids: set[str],
    ) -> dict[str, Any]:
        missing = sorted(expected_document_ids - observed_document_ids)
        unexpected = sorted(observed_document_ids - expected_document_ids)
        return {
            "expected_document_id_count": len(expected_document_ids),
            "observed_document_id_count": len(observed_document_ids),
            "matching_document_id_count": len(expected_document_ids & observed_document_ids),
            "missing_document_id_count": len(missing),
            "unexpected_document_id_count": len(unexpected),
            "missing_document_ids_sample": missing[:20],
            "unexpected_document_ids_sample": unexpected[:20],
        }

    def reconcile_raw_assets(
        self,
        expected_raw_asset_ids: set[str],
        observed_raw_asset_ids: set[str],
    ) -> dict[str, Any]:
        missing = sorted(expected_raw_asset_ids - observed_raw_asset_ids)
        unexpected = sorted(observed_raw_asset_ids - expected_raw_asset_ids)
        return {
            "expected_raw_asset_id_count": len(expected_raw_asset_ids),
            "observed_raw_asset_id_count": len(observed_raw_asset_ids),
            "matching_raw_asset_id_count": len(expected_raw_asset_ids & observed_raw_asset_ids),
            "missing_raw_asset_id_count": len(missing),
            "unexpected_raw_asset_id_count": len(unexpected),
            "missing_raw_asset_ids_sample": missing[:20],
            "unexpected_raw_asset_ids_sample": unexpected[:20],
        }


class CloseoutRunVerifier:
    def __init__(
        self,
        *,
        closeout_store: CloseoutStore,
        artifacts: CloseoutArtifactManager,
        object_store_settings: ObjectStoreSettings,
        verifier: CloseoutVerifier,
    ) -> None:
        self.closeout_store = closeout_store
        self.artifacts = artifacts
        self.object_store_settings = object_store_settings
        self.verifier = verifier

    def verify_run(self, run_id: str) -> dict[str, Any]:
        run = self.closeout_store.get_run(run_id)
        if run is None:
            raise ValueError(f"closeout run not found: {run_id}")
        staged_notices = self.closeout_store.get_staged_notices(run_id)
        staged_raw_assets = self.closeout_store.get_staged_raw_assets(run_id)
        staged_documents = self.closeout_store.get_staged_documents(run_id)
        shards = self.closeout_store.list_shards(run_id)
        batches = self.closeout_store.list_batches(run_id)

        persisted_shard_ids = {shard.shard_id for shard in shards}
        expected_shard_ids = set(range(1, max(run.shard_count, len(shards)) + 1))
        missing_shard_ids = sorted(expected_shard_ids - persisted_shard_ids)
        persisted_batch_ids = {batch.batch_id for batch in batches}
        expected_batch_ids = {
            int(batch_id) for shard in shards for batch_id in shard.batch_ids
        }
        missing_batch_ids = sorted(expected_batch_ids - persisted_batch_ids)
        unexpected_batch_ids = sorted(persisted_batch_ids - expected_batch_ids)
        expected_scope = self._load_expected_scope(run_id=run_id, batches=batches, run=run)
        expected_notice_ids = expected_scope["notice_ids"]
        expected_parent_document_ids = expected_scope["parent_document_ids_by_notice"]
        planned_batch_notice_ids = {
            notice_id for batch in batches for notice_id in batch.notice_ids
        }
        missing_planned_notice_ids = sorted(expected_notice_ids - planned_batch_notice_ids)
        unexpected_planned_notice_ids = sorted(
            planned_batch_notice_ids - expected_notice_ids
        )
        observed_notice_ids = {str(item["notice_id"]) for item in staged_notices}
        expected_document_ids = expected_scope["document_ids"]
        observed_document_ids = {
            str(item["document"]["document_id"]) for item in staged_documents
        }
        expected_raw_asset_ids = expected_scope["raw_asset_ids"]
        observed_raw_asset_ids = {
            str(item["raw_record"]["raw_asset_id"]) for item in staged_raw_assets
        }

        notice_manifest_missing: list[str] = []
        for staged_notice in staged_notices:
            notice_manifest_key = next(
                (
                    str(key)
                    for key in staged_notice.get("artifact_keys") or ()
                    if str(key).endswith("/source-truth/notice-manifest.json")
                ),
                None,
            )
            if notice_manifest_key is None or self.artifacts.object_head_or_none(
                bucket=self.object_store_settings.bucket_source,
                key=notice_manifest_key,
            ) is None:
                notice_manifest_missing.append(str(staged_notice["notice_id"]))

        document_units_missing: list[str] = []
        mismatched_document_hashes: list[str] = []
        mismatched_staged_object_hashes: list[str] = []
        for staged_document in staged_documents:
            document_id = str(staged_document["document"]["document_id"])
            stage_key = staged_document["staged_object_keys"].get("document_units")
            if stage_key is None:
                document_units_missing.append(document_id)
                continue
            expected_meta = dict(
                staged_document.get("staged_object_metadata", {}).get("document_units", {})
            )
            if str(staged_document.get("content_hash") or "") != str(
                expected_meta.get("sha256") or ""
            ):
                mismatched_document_hashes.append(document_id)
            head = self.artifacts.object_head_or_none(
                bucket=self.object_store_settings.bucket_derived,
                key=str(stage_key),
            )
            if head is None:
                document_units_missing.append(document_id)
                continue
            metadata = dict(head.get("metadata") or {})
            if (
                str(metadata.get("sha256") or "") != str(expected_meta.get("sha256") or "")
                or int(head.get("content_length") or 0)
                != int(expected_meta.get("content_length") or 0)
            ):
                mismatched_staged_object_hashes.append(document_id)

        raw_versions_by_asset = {
            str(item["raw_record"]["raw_asset_id"]): str(item["raw_record"]["raw_version_id"])
            for item in staged_raw_assets
        }
        documents_by_id = {
            str(item["document"]["document_id"]): str(item["document"]["version_id"])
            for item in staged_documents
        }
        mismatched_raw_versions: list[str] = []
        for staged_notice in staged_notices:
            notice_id = str(staged_notice["notice_id"])
            raw_asset_id = str(staged_notice["raw_asset_id"])
            document_id = str(staged_notice["document_id"])
            raw_version_id = str(staged_notice["raw_version_id"])
            expected_parent_document_id = expected_parent_document_ids.get(notice_id)
            if (
                expected_parent_document_id is not None
                and document_id != expected_parent_document_id
            ):
                mismatched_raw_versions.append(raw_asset_id)
                continue
            if raw_versions_by_asset.get(raw_asset_id) != raw_version_id:
                mismatched_raw_versions.append(raw_asset_id)
                continue
            if (
                run.input_kind != SOURCE_TRUTH_REPLAY_INPUT_KIND
                and documents_by_id.get(document_id) != raw_version_id
            ):
                mismatched_raw_versions.append(raw_asset_id)

        document_report = self.verifier.reconcile_documents(
            expected_document_ids,
            observed_document_ids,
        )
        raw_report = self.verifier.reconcile_raw_assets(
            expected_raw_asset_ids,
            observed_raw_asset_ids,
        )
        frozen_expected_document_count = int(
            run.expected_document_count or len(expected_document_ids)
        )
        frozen_expected_attachment_document_count = int(
            run.expected_attachment_document_count
        )
        frozen_expected_raw_asset_count = int(
            run.expected_raw_asset_count or len(expected_raw_asset_ids)
        )
        notice_missing = sorted(expected_notice_ids - observed_notice_ids)
        verification = {
            "run_id": run_id,
            "input_kind": run.input_kind,
            "frozen_expected_notice_count": run.expected_notice_count,
            "frozen_expected_document_count": frozen_expected_document_count,
            "frozen_expected_attachment_document_count": frozen_expected_attachment_document_count,
            "frozen_expected_raw_asset_count": frozen_expected_raw_asset_count,
            "expected_notice_count": len(expected_notice_ids),
            "expected_attachment_document_count": expected_scope["attachment_document_count"],
            "persisted_shard_count": len(shards),
            "persisted_batch_count": len(batches),
            "missing_shard_id_count": len(missing_shard_ids),
            "missing_shard_ids_sample": missing_shard_ids[:20],
            "missing_batch_id_count": len(missing_batch_ids),
            "missing_batch_ids_sample": missing_batch_ids[:20],
            "unexpected_batch_id_count": len(unexpected_batch_ids),
            "unexpected_batch_ids_sample": unexpected_batch_ids[:20],
            "missing_batch_notice_id_count": len(missing_planned_notice_ids),
            "missing_batch_notice_ids_sample": missing_planned_notice_ids[:20],
            "unexpected_batch_notice_id_count": len(unexpected_planned_notice_ids),
            "unexpected_batch_notice_ids_sample": unexpected_planned_notice_ids[:20],
            "staged_notice_count": len(observed_notice_ids),
            "missing_notice_id_count": len(notice_missing),
            "missing_notice_ids_sample": notice_missing[:20],
            "missing_notice_manifest_count": len(notice_manifest_missing),
            "missing_notice_manifest_sample": notice_manifest_missing[:20],
            "missing_document_units_count": len(document_units_missing),
            "missing_document_units_sample": document_units_missing[:20],
            "mismatched_document_hash_count": len(mismatched_document_hashes),
            "mismatched_document_hash_sample": sorted(mismatched_document_hashes)[:20],
            "mismatched_staged_object_hash_count": len(mismatched_staged_object_hashes),
            "mismatched_staged_object_hash_sample": sorted(
                mismatched_staged_object_hashes
            )[:20],
            "mismatched_raw_version_count": len(mismatched_raw_versions),
            "mismatched_raw_version_sample": sorted(mismatched_raw_versions)[:20],
            **document_report,
            **raw_report,
        }
        verification["ok"] = (
            verification["missing_shard_id_count"] == 0
            and verification["missing_batch_id_count"] == 0
            and verification["unexpected_batch_id_count"] == 0
            and verification["missing_batch_notice_id_count"] == 0
            and verification["unexpected_batch_notice_id_count"] == 0
            and verification["frozen_expected_notice_count"] == verification["expected_notice_count"]
            and verification["frozen_expected_document_count"] == verification["expected_document_id_count"]
            and verification["frozen_expected_attachment_document_count"]
            == verification["expected_attachment_document_count"]
            and verification["frozen_expected_raw_asset_count"] == verification["expected_raw_asset_id_count"]
            and verification["missing_notice_id_count"] == 0
            and verification["missing_notice_manifest_count"] == 0
            and verification["missing_document_units_count"] == 0
            and verification["mismatched_document_hash_count"] == 0
            and verification["mismatched_staged_object_hash_count"] == 0
            and verification["mismatched_raw_version_count"] == 0
            and verification["missing_document_id_count"] == 0
            and verification["missing_raw_asset_id_count"] == 0
            and verification["unexpected_document_id_count"] == 0
            and verification["unexpected_raw_asset_id_count"] == 0
        )
        if not verification["ok"]:
            raise ValueError(f"closeout verification failed for {run_id}")
        return verification

    def _load_expected_scope(
        self,
        *,
        run_id: str,
        batches,
        run,
    ) -> dict[str, Any]:
        expected_notice_ids: set[str] = set()
        expected_document_ids: set[str] = set()
        expected_raw_asset_ids: set[str] = set()
        parent_document_ids_by_notice: dict[str, str] = {}
        attachment_document_count = 0
        for batch in batches:
            if batch.input_object_key is None:
                raise ValueError(f"closeout batch {batch.batch_id} missing input_object_key")
            payload = json.loads(
                self.artifacts.object_store.get_bytes(
                    bucket=self.object_store_settings.bucket_derived,
                    key=batch.input_object_key,
                ).decode("utf-8")
            )
            if str(payload.get("run_id")) != run_id:
                raise ValueError(f"closeout verification batch run mismatch: {batch.batch_id}")
            input_kind = str(payload.get("input_kind") or run.input_kind or "")
            if input_kind == SOURCE_TRUTH_REPLAY_INPUT_KIND:
                for parent in tuple(payload.get("source_truth_parents") or ()):
                    notice_id = str(parent["notice_id"])
                    expected_notice_ids.add(notice_id)
                    parent_document_id = str(parent["document_id"])
                    expected_document_ids.add(parent_document_id)
                    parent_document_ids_by_notice[notice_id] = parent_document_id
                    expected_raw_asset_ids.add(str(parent["raw_record"]["raw_asset_id"]))
                    attachment_documents = tuple(
                        parent.get("expected_attachment_documents") or ()
                    )
                    attachment_document_count += len(attachment_documents)
                    for attachment in attachment_documents:
                        expected_document_ids.add(str(attachment["document_id"]))
                continue
            notice_ids = tuple(str(item) for item in payload.get("notice_ids") or ())
            expected_notice_ids.update(notice_ids)
            expected_document_ids.update(
                f"notice:{run.site_id}:{notice_id}" for notice_id in notice_ids
            )
            expected_raw_asset_ids.update(
                build_authenticated_notice_raw_asset_id(run.site_id, notice_id)
                for notice_id in notice_ids
            )
        return {
            "notice_ids": expected_notice_ids,
            "document_ids": expected_document_ids,
            "raw_asset_ids": expected_raw_asset_ids,
            "parent_document_ids_by_notice": parent_document_ids_by_notice,
            "attachment_document_count": attachment_document_count,
        }


__all__ = [
    "CloseoutRunVerifier",
    "CloseoutVerifier",
]
