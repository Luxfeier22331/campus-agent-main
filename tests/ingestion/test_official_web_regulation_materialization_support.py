from __future__ import annotations

import json

import unittest

from dataclasses import replace

from datetime import datetime

from pathlib import Path

from tempfile import TemporaryDirectory

from campus_ingestion_core.collected_notice_regulation_text_normalization import (
    REGULATION_CANONICAL_NORMALIZER_VERSION,
)

from campus_ingestion_core.document_reader_publisher import publish_document_reader_assets

from campus_ingestion_core.in_memory_registries import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
)

from campus_ingestion_core.official_web_regulation_materialization import (
    materialize_official_web_regulation_candidates,
)

from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.materialize_official_web_regulations import (
    _generated_at_from_report,
)

from campus_ingestion_worker.materialize_official_web_regulations import (
    main as materialize_worker_main,
)

from tests.ingestion.official_web_projection_test_support import (
    _block,
    _declarations_payload,
    _target_match,
    _write_json,
    _write_output_page,
)


class _FakeObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def delete_prefix(
        self,
        *,
        bucket: str,
        prefix: str,
        exclude_keys: tuple[str, ...] = (),
        include_path_segment_suffix: str | None = None,
    ) -> None:
        excluded = set(exclude_keys)
        for object_key in tuple(self.objects):
            object_bucket, key = object_key
            if (
                object_bucket == bucket
                and key.startswith(prefix)
                and key not in excluded
                and _matches_path_segment_suffix(key, include_path_segment_suffix)
            ):
                del self.objects[object_key]


def _object_store_settings() -> ObjectStoreSettings:
    return ObjectStoreSettings(
        endpoint="http://localhost:9000",
        access_key="test",
        secret_key="test",
        region="us-east-1",
        bucket_source="campus-rag-source",
        bucket_derived="campus-rag-derived",
        secure=False,
    )


def _matches_path_segment_suffix(key: str, suffix: str | None) -> bool:
    if suffix is None:
        return True
    return any(segment.endswith(suffix) for segment in key.split("/"))


def _page(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    normalized_canonical_url: str,
    target_matches: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "rawAssetId": raw_asset_id,
        "rawVersionId": raw_version_id,
        "normalizedCanonicalUrl": normalized_canonical_url,
        "pageFamily": "article_detail",
        "pageManifestObjectKey": (
            f"official_web/{raw_asset_id}/undated/{raw_version_id}/source-truth/page-manifest.json"
        ),
        "contentBlocksObjectKey": (
            f"official_web/{raw_asset_id}/undated/{raw_version_id}/"
            "source-truth/content-blocks.jsonl"
        ),
        "providerExtractionObjectKey": (
            f"official_web/{raw_asset_id}/undated/{raw_version_id}/"
            "provider/cheerio-basic/page-extraction.json"
        ),
        "responseHtmlObjectKey": (
            f"official_web/{raw_asset_id}/undated/{raw_version_id}/capture/response.html"
        ),
        "responseBodyHash": f"hash-{raw_asset_id}",
        "blockCount": 2,
        "targetMatches": target_matches,
        "selectedWriteTarget": "regulations/institutional_rules",
        "materializationPolicy": "release_gate_required",
        "reviewPolicy": "release_gate_required",
    }


def _read_units(payload: bytes) -> list[dict[str, object]]:
    return [json.loads(line) for line in payload.decode("utf-8").splitlines() if line.strip()]


def _materialize_single_title(
    *,
    declarations_path: Path,
    output_dir: Path,
    projection_dir: Path,
    raw_asset_id: str,
    raw_version_id: str,
    source_url: str,
    target_matches: list[dict[str, object]],
    title: str,
    work_dir: Path,
) -> dict[str, str]:
    _write_json(
        output_dir / "source-truth-bundle.json",
        {
            "schemaVersion": "official_web_source_truth_bundle.v1",
            "siteId": "campus_public",
            "crawlRunId": "owrun_regulation_identity_test",
            "collectionMode": "target-workset",
            "pages": [
                _page(
                    raw_asset_id=raw_asset_id,
                    raw_version_id=raw_version_id,
                    normalized_canonical_url=source_url,
                    target_matches=target_matches,
                )
            ],
        },
    )
    _write_output_page(
        output_dir,
        site_id="campus_public",
        host="met.example.edu",
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        normalized_canonical_url=source_url,
        page_title=title,
        page_family="article_detail",
        target_matches=target_matches,
        blocks=[
            _block(
                raw_asset_id=raw_asset_id,
                raw_version_id=raw_version_id,
                row_id="title",
                row_index=0,
                block_order=0,
                block_role="title",
                text=title,
            ),
            _block(
                raw_asset_id=raw_asset_id,
                raw_version_id=raw_version_id,
                row_id="p1",
                row_index=1,
                block_order=1,
                block_role="paragraph",
                text="第一条 为规范校园一卡通管理，制定本规定。",
            ),
        ],
    )
    object_store = _FakeObjectStore()
    registry = InMemoryDocumentRegistry()
    raw_registry = InMemoryRawAssetRegistry()
    materialize_official_web_regulation_candidates(
        source_truth_output_dir=output_dir,
        projection_output_dir=projection_dir,
        work_dir=work_dir,
        declarations_path=declarations_path,
        object_store=object_store,
        document_registry=registry,
        raw_asset_registry=raw_registry,
        object_store_settings=_object_store_settings(),
    )
    records = registry.list_by_scope("regulations", "institutional_rules")
    if len(records) != 1:
        raise AssertionError(f"expected one materialized record, got {len(records)}")
    record = records[0]
    return {
        "document_id": record.document_id,
        "version_id": record.version_id,
    }


def _materializable_regulation_urls(projection_dir: Path) -> set[str]:
    report = json.loads((projection_dir / "projection-report.json").read_text(encoding="utf-8"))
    return {
        str(candidate["normalized_canonical_url"])
        for candidate in report.get("consumer_candidate_pages") or []
        if str(candidate.get("selected_write_target") or "").strip()
        == "regulations/institutional_rules"
    }


__all__ = [name for name in globals() if not name.startswith("__")]
