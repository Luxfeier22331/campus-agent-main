from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.authenticated_notice_defaults import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTION,
    DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
    DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE,
)
from campus_ingestion_core.authenticated_notice_source_projections import (
    AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_CONDITIONAL_ON_EXTRACTED_TEXT,
    AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_MANUAL_REVIEW,
    AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_REQUIRED_DOCUMENT,
    AuthenticatedNoticeProjectedNotice,
    _AuthenticatedNoticeParentSourceTruth,
    _load_json_payload,
    _load_jsonl_rows,
    _project_parent_source_truth,
    _resolve_authenticated_notice_ocr_runtime,
    load_authenticated_notice_source_projections_config,
    read_authenticated_notice_source_projections_config_path,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    HIGH_RISK_NOTICE_LABELS,
    AuthenticatedNoticeSourceTruthInventoryEntry,
    AuthenticatedNoticeSourceTruthInventoryStore,
    _aggregate_notice_risk_counts,
    build_authenticated_notice_source_truth_inventory_entries,
    document_record_from_authenticated_notice_source_truth_parent_snapshot,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.raw_ingestion import OnlineOcrClient
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry
from campus_ingestion_core.scope_catalog import assert_known_scope
from campus_ingestion_core.settings import ObjectStoreSettings

SOURCE_TRUTH_REPLAY_INPUT_KIND = "source_truth_replay"


class AuthenticatedNoticeSourceTruthReplayObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceTruthReplayRequest:
    corpus: str = DEFAULT_AUTHENTICATED_NOTICE_CORPUS
    collection: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTION
    source_projections_path: Path | None = None
    default_visibility_scope: str | None = DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE
    notice_ids: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.source_projections_path is not None:
            object.__setattr__(self, "source_projections_path", Path(self.source_projections_path))
        object.__setattr__(
            self,
            "notice_ids",
            tuple(sorted({str(item).strip() for item in self.notice_ids if str(item).strip()})),
        )
        assert_known_scope(self.corpus, self.collection)


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceTruthReplayInventory:
    site_id: str
    source_home_url: str
    embedding_model: str
    selected_notice_ids: tuple[str, ...]
    notice_risk_counts: dict[str, int]
    high_risk_notice_count: int
    expected_notice_count: int
    expected_document_count: int
    expected_attachment_document_count: int
    expected_ocr_candidate_count: int
    expected_raw_asset_count: int
    parents: tuple[dict[str, Any], ...]


def load_authenticated_notice_source_truth_replay_inventory(
    *,
    request: AuthenticatedNoticeSourceTruthReplayRequest,
    document_registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    object_store: AuthenticatedNoticeSourceTruthReplayObjectStore,
    object_store_settings: ObjectStoreSettings,
    env: dict[str, str] | None = None,
) -> AuthenticatedNoticeSourceTruthReplayInventory:
    entries = build_authenticated_notice_source_truth_inventory_entries(
        corpus=request.corpus,
        collection=request.collection,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        object_store=object_store,
        object_store_settings=object_store_settings,
        source_projections_path=request.source_projections_path,
        notice_ids=request.notice_ids,
        env=env,
    )
    return _inventory_from_entries(entries, corpus=request.corpus, collection=request.collection)


def load_authenticated_notice_source_truth_replay_inventory_from_store(
    *,
    request: AuthenticatedNoticeSourceTruthReplayRequest,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore,
) -> AuthenticatedNoticeSourceTruthReplayInventory:
    entries = source_truth_inventory_store.list_by_scope(
        request.corpus,
        request.collection,
        notice_ids=request.notice_ids,
    )
    if request.notice_ids:
        found_notice_ids = {entry.notice_id for entry in entries}
        missing_notice_ids = tuple(
            notice_id for notice_id in request.notice_ids if notice_id not in found_notice_ids
        )
        if missing_notice_ids:
            raise ValueError(
                "authenticated notice source replay notice_ids not found in source-truth inventory: "
                + ", ".join(missing_notice_ids)
            )
    return _inventory_from_entries(entries, corpus=request.corpus, collection=request.collection)


def build_authenticated_notice_source_truth_replay_documents(
    *,
    parent_snapshot: dict[str, Any],
    request: AuthenticatedNoticeSourceTruthReplayRequest,
    object_store: AuthenticatedNoticeSourceTruthReplayObjectStore,
    object_store_settings: ObjectStoreSettings,
    env: dict[str, str] | None = None,
    ocr_client: OnlineOcrClient | None = None,
) -> AuthenticatedNoticeProjectedNotice:
    source = env if env is not None else dict(os.environ)
    config_path = (
        request.source_projections_path
        or read_authenticated_notice_source_projections_config_path(source)
    )
    config = load_authenticated_notice_source_projections_config(config_path)
    runtime_profile = load_runtime_profile(request.corpus, request.collection)
    parent_source_truth = _load_parent_source_truth_from_snapshot(
        parent_snapshot=parent_snapshot,
        object_store=object_store,
        object_store_settings=object_store_settings,
    )
    ocr_provider_response_cache: dict[str, bytes] = {}
    runtime_ocr = (
        _resolve_authenticated_notice_ocr_runtime(env=source, ocr_client=ocr_client)
        if ocr_client is not None
        else None
    )
    projected_notice, _runtime_ocr_client = _project_parent_source_truth(
        parent_source_truth=parent_source_truth,
        config=config,
        object_store=object_store,
        object_store_settings=object_store_settings,
        runtime_profile=runtime_profile,
        ocr_runtime=runtime_ocr,
        ocr_provider_response_cache=ocr_provider_response_cache,
        env=source,
    )
    return projected_notice


def build_authenticated_notice_source_truth_replay_inventory_payload(
    *,
    run_id: str,
    inventory: AuthenticatedNoticeSourceTruthReplayInventory,
) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "input_kind": SOURCE_TRUTH_REPLAY_INPUT_KIND,
        "selected_notice_ids": list(inventory.selected_notice_ids),
        "notice_risk_counts": dict(inventory.notice_risk_counts),
        "high_risk_notice_count": inventory.high_risk_notice_count,
        "site_id": inventory.site_id,
        "source_home_url": inventory.source_home_url,
        "embedding_model": inventory.embedding_model,
        "expected_notice_count": inventory.expected_notice_count,
        "expected_document_count": inventory.expected_document_count,
        "expected_attachment_document_count": inventory.expected_attachment_document_count,
        "expected_ocr_candidate_count": inventory.expected_ocr_candidate_count,
        "expected_raw_asset_count": inventory.expected_raw_asset_count,
        "parents": [dict(parent) for parent in inventory.parents],
    }


def load_authenticated_notice_source_truth_replay_inventory_from_payload(
    payload: Mapping[str, Any],
    *,
    expected_run_id: str | None = None,
) -> AuthenticatedNoticeSourceTruthReplayInventory:
    raw = dict(payload)
    run_id = str(raw.get("run_id") or "").strip()
    if expected_run_id is not None and run_id != expected_run_id:
        raise ValueError(f"source-truth replay frozen inventory run mismatch: {expected_run_id}")
    input_kind = str(raw.get("input_kind") or SOURCE_TRUTH_REPLAY_INPUT_KIND).strip()
    if input_kind != SOURCE_TRUTH_REPLAY_INPUT_KIND:
        raise ValueError(
            "source-truth replay frozen inventory payload must use input_kind "
            f"{SOURCE_TRUTH_REPLAY_INPUT_KIND}: {input_kind}"
        )
    parents = tuple(
        sorted(
            (dict(item) for item in raw.get("parents") or ()),
            key=lambda item: str(item["notice_id"]),
        )
    )
    expected_scope = build_authenticated_notice_source_truth_replay_expected_scope(parents)
    selected_notice_ids = tuple(
        sorted(
            str(item).strip()
            for item in (
                raw.get("selected_notice_ids") or [str(parent["notice_id"]) for parent in parents]
            )
            if str(item).strip()
        )
    )
    if not selected_notice_ids and parents:
        selected_notice_ids = tuple(sorted(str(parent["notice_id"]) for parent in parents))
    notice_risk_counts = {
        str(label): int(count)
        for label, count in dict(raw.get("notice_risk_counts") or {}).items()
        if str(label).strip()
    }
    if not notice_risk_counts:
        notice_risk_counts = _aggregate_notice_risk_counts(
            str(parent.get("notice_risk_label") or "")
            for parent in parents
            if str(parent.get("notice_risk_label") or "").strip()
        )
    return AuthenticatedNoticeSourceTruthReplayInventory(
        site_id=str(raw.get("site_id") or ""),
        source_home_url=str(raw.get("source_home_url") or ""),
        embedding_model=str(raw.get("embedding_model") or ""),
        selected_notice_ids=selected_notice_ids,
        notice_risk_counts=notice_risk_counts,
        high_risk_notice_count=int(
            raw.get("high_risk_notice_count")
            or sum(
                count
                for label, count in notice_risk_counts.items()
                if label in HIGH_RISK_NOTICE_LABELS
            )
        ),
        expected_notice_count=int(
            raw.get("expected_notice_count") or len(expected_scope["notice_ids"])
        ),
        expected_document_count=int(
            raw.get("expected_document_count") or len(expected_scope["document_ids"])
        ),
        expected_attachment_document_count=int(
            raw.get("expected_attachment_document_count")
            or expected_scope["attachment_document_count"]
        ),
        expected_ocr_candidate_count=int(
            raw.get("expected_ocr_candidate_count") or expected_scope["ocr_candidate_count"]
        ),
        expected_raw_asset_count=int(
            raw.get("expected_raw_asset_count") or len(expected_scope["raw_asset_ids"])
        ),
        parents=parents,
    )


def build_authenticated_notice_source_truth_replay_batch_input_payload(
    *,
    run_id: str,
    batch_id: int,
    shard_id: int,
    notice_ids: Sequence[str],
    parent_by_notice_id: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    ordered_notice_ids = [str(item) for item in notice_ids]
    return {
        "run_id": run_id,
        "batch_id": batch_id,
        "shard_id": shard_id,
        "input_kind": SOURCE_TRUTH_REPLAY_INPUT_KIND,
        "notice_ids": ordered_notice_ids,
        "source_truth_parents": [
            dict(parent_by_notice_id[notice_id]) for notice_id in ordered_notice_ids
        ],
    }


def build_authenticated_notice_source_truth_replay_expected_scope(
    parents: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    expected_notice_ids: set[str] = set()
    expected_document_ids: set[str] = set()
    expected_raw_asset_ids: set[str] = set()
    parent_document_ids_by_notice: dict[str, str] = {}
    attachment_document_count = 0
    ocr_candidate_count = 0
    manual_review_required_count = 0
    attachment_projection_plans: dict[tuple[str, str], dict[str, Any]] = {}
    for parent in parents:
        notice_id = str(parent["notice_id"])
        expected_notice_ids.add(notice_id)
        parent_document_id = str(parent["document_id"])
        expected_document_ids.add(parent_document_id)
        parent_document_ids_by_notice[notice_id] = parent_document_id
        raw_record = dict(parent.get("raw_record") or {})
        raw_asset_id = str(raw_record.get("raw_asset_id") or "").strip()
        if raw_asset_id:
            expected_raw_asset_ids.add(raw_asset_id)
        for plan in _attachment_projection_plans_from_parent(parent):
            attachment_projection_plans[(notice_id, str(plan["attachment_ref_id"]))] = plan
            materialization_policy = str(plan["materialization_policy"])
            if materialization_policy == AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_REQUIRED_DOCUMENT:
                attachment_document_count += 1
                expected_document_ids.add(str(plan["document_id"]))
            elif (
                materialization_policy
                == AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_CONDITIONAL_ON_EXTRACTED_TEXT
            ):
                ocr_candidate_count += 1
            elif materialization_policy == AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_MANUAL_REVIEW:
                manual_review_required_count += 1
    return {
        "notice_ids": expected_notice_ids,
        "document_ids": expected_document_ids,
        "raw_asset_ids": expected_raw_asset_ids,
        "parent_document_ids_by_notice": parent_document_ids_by_notice,
        "attachment_document_count": attachment_document_count,
        "ocr_candidate_count": ocr_candidate_count,
        "manual_review_required_count": manual_review_required_count,
        "attachment_projection_plans": attachment_projection_plans,
    }


def _load_parent_source_truth_from_snapshot(
    *,
    parent_snapshot: dict[str, Any],
    object_store: AuthenticatedNoticeSourceTruthReplayObjectStore,
    object_store_settings: ObjectStoreSettings,
) -> _AuthenticatedNoticeParentSourceTruth:
    source_artifact_keys = tuple(
        str(item) for item in parent_snapshot.get("source_artifact_keys") or ()
    )
    record = document_record_from_authenticated_notice_source_truth_parent_snapshot(parent_snapshot)
    notice_manifest_key = str(parent_snapshot["notice_manifest_key"])
    content_blocks_key = str(parent_snapshot["content_blocks_key"])
    attachment_refs_key = str(parent_snapshot["attachment_refs_key"])
    manifest = _load_json_payload(
        object_store.get_bytes(
            bucket=object_store_settings.bucket_source,
            key=notice_manifest_key,
        )
    )
    content_blocks = _load_jsonl_rows(
        object_store.get_bytes(
            bucket=object_store_settings.bucket_source,
            key=content_blocks_key,
        )
    )
    attachment_refs = _load_jsonl_rows(
        object_store.get_bytes(
            bucket=object_store_settings.bucket_source,
            key=attachment_refs_key,
        )
    )
    return _AuthenticatedNoticeParentSourceTruth(
        record=record,
        manifest=manifest,
        content_blocks=content_blocks,
        attachment_refs=attachment_refs,
        source_keys=source_artifact_keys,
        notice_manifest_key=notice_manifest_key,
        content_blocks_key=content_blocks_key,
        attachment_refs_key=attachment_refs_key,
    )


def _attachment_projection_plans_from_parent(
    parent: Mapping[str, Any],
) -> tuple[dict[str, Any], ...]:
    plans = tuple(dict(item) for item in parent.get("attachment_projection_plans") or ())
    if plans:
        return plans
    fallback: list[dict[str, Any]] = []
    for item in tuple(parent.get("expected_attachment_documents") or ()):
        payload = dict(item)
        classification = str(payload.get("classification") or "")
        materialization_policy = str(payload.get("materialization_policy") or "")
        if not materialization_policy:
            if classification == "ocr_required":
                materialization_policy = (
                    AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_CONDITIONAL_ON_EXTRACTED_TEXT
                )
            elif classification == "manual_review_required":
                materialization_policy = AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_MANUAL_REVIEW
            else:
                materialization_policy = AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_REQUIRED_DOCUMENT
        plan = {
            "attachment_ref_id": str(payload["attachment_ref_id"]),
            "classification": classification,
            "document_id": str(payload["document_id"]),
            "materialization_policy": materialization_policy,
        }
        review_reason = str(payload.get("review_reason") or "").strip()
        if review_reason:
            plan["review_reason"] = review_reason
        fallback.append(plan)
    return tuple(fallback)


def _inventory_from_entries(
    entries: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    *,
    corpus: str,
    collection: str,
) -> AuthenticatedNoticeSourceTruthReplayInventory:
    if not entries:
        raise ValueError(
            f"no authenticated notice source-truth parents found for {corpus}/{collection}"
        )
    site_ids = {entry.site_id for entry in entries if entry.site_id.strip()}
    if len(site_ids) != 1:
        raise ValueError(
            f"authenticated notice source replay requires a single site_id, got {sorted(site_ids)}"
        )
    source_home_urls = {entry.source_home_url for entry in entries if entry.source_home_url.strip()}
    if len(source_home_urls) != 1:
        raise ValueError(
            "authenticated notice source replay requires a single non-empty source_home_url"
        )
    embedding_models = {entry.embedding_model for entry in entries if entry.embedding_model.strip()}
    if len(embedding_models) != 1:
        raise ValueError(
            "authenticated notice source replay requires a single non-empty embedding_model"
        )
    ordered_parents = tuple(
        sorted(
            (dict(entry.parent_snapshot) for entry in entries),
            key=lambda item: str(item["notice_id"]),
        )
    )
    return AuthenticatedNoticeSourceTruthReplayInventory(
        site_id=next(iter(site_ids)),
        source_home_url=next(iter(source_home_urls)),
        embedding_model=next(iter(embedding_models)),
        selected_notice_ids=tuple(sorted(str(item["notice_id"]) for item in ordered_parents)),
        notice_risk_counts=_aggregate_notice_risk_counts(
            entry.notice_risk_label for entry in entries
        ),
        high_risk_notice_count=sum(
            1 for entry in entries if entry.notice_risk_label in HIGH_RISK_NOTICE_LABELS
        ),
        expected_notice_count=len(ordered_parents),
        expected_document_count=sum(1 + entry.attachment_document_count for entry in entries),
        expected_attachment_document_count=sum(
            entry.attachment_document_count for entry in entries
        ),
        expected_ocr_candidate_count=sum(entry.ocr_required_count for entry in entries),
        expected_raw_asset_count=len(
            {(entry.raw_asset_id, entry.raw_version_id) for entry in entries}
        ),
        parents=ordered_parents,
    )


__all__ = [
    "SOURCE_TRUTH_REPLAY_INPUT_KIND",
    "AuthenticatedNoticeSourceTruthReplayInventory",
    "AuthenticatedNoticeSourceTruthReplayRequest",
    "build_authenticated_notice_source_truth_replay_batch_input_payload",
    "build_authenticated_notice_source_truth_replay_documents",
    "build_authenticated_notice_source_truth_replay_expected_scope",
    "build_authenticated_notice_source_truth_replay_inventory_payload",
    "load_authenticated_notice_source_truth_replay_inventory",
    "load_authenticated_notice_source_truth_replay_inventory_from_payload",
    "load_authenticated_notice_source_truth_replay_inventory_from_store",
]
