from __future__ import annotations

import importlib
import json
from pathlib import Path

from campus_ingestion_core.models import DocumentRegistryRecord

worker = importlib.import_module("campus_ingestion_worker.official_web_projection_import")


class _FakeObjectStore:
    def __init__(self, *, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = dict(objects or {})
        self.put_requests: list[tuple[str, str]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.put_requests.append((bucket, key))
        self.objects[(bucket, key)] = data


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def _projection_report() -> dict[str, object]:
    return {
        "schemaVersion": "official_web_projection_replay_report.v1",
        "siteId": "muc_public",
        "crawlRunId": "subset-run-001",
        "outputDir": "/tmp/replay",
        "projectionOutputDir": "/tmp/projection",
        "generatedAt": "2026-04-03T00:00:00+00:00",
        "counts": {"pages_seen": 1, "emitted_documents": 1, "manual_review_pages": 0},
        "documents": [
            {
                "document_id": "official_web:muc_public_pages:article_detail:doc-1",
                "version_id": "owdocver:doc-1",
                "title": "学校简介",
                "declaration_id": "article-detail-primary",
                "page_family": "article_detail",
                "projection_family": "content_document",
                "document_kind": "article",
                "target_corpus": "official_web",
                "target_collection": "muc_public_pages",
                "normalized_canonical_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                "raw_asset_id": "owasset_doc_1",
                "raw_version_id": "owver_doc_1",
                "unit_count": 1,
                "canonical_markdown_path": "",
                "document_units_path": "",
                "serving_intent": "promotable",
                "promotion_block_reason": None,
            }
        ],
        "manual_review_pages": [],
    }


def _document_units_row() -> dict[str, object]:
    return {
        "doc_id": "official_web:muc_public_pages:article_detail:doc-1",
        "version_id": "owdocver:doc-1",
        "chunk_id": "official_web:muc_public_pages:article_detail:doc-1:0001",
        "clean_text": "中央民族大学学校简介。",
        "anchor": {"section_path": ["学校概况", "学校简介"], "page_start": 1, "page_end": 1},
        "entitlement_groups": [],
        "visibility_scope": None,
        "visibility_level": "public",
        "metadata": {
            "page_family": "article_detail",
            "unit_type": "page_content",
            "serving_intent": "promotable",
            "content_role": "primary_content",
            "document_id": "official_web:muc_public_pages:article_detail:doc-1",
            "version_id": "owdocver:doc-1",
            "source_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
        },
    }


def _projection_document(
    *,
    document_id: str,
    version_id: str,
    title: str,
    normalized_canonical_url: str,
    raw_asset_id: str,
    raw_version_id: str,
    canonical_markdown_path: str,
    document_units_path: str,
    serving_intent: str = "promotable",
    promotion_block_reason: str | None = None,
) -> dict[str, object]:
    return {
        "document_id": document_id,
        "version_id": version_id,
        "title": title,
        "declaration_id": "article-detail-primary",
        "page_family": "article_detail",
        "projection_family": "content_document",
        "document_kind": "article",
        "target_corpus": "official_web",
        "target_collection": "muc_public_pages",
        "normalized_canonical_url": normalized_canonical_url,
        "raw_asset_id": raw_asset_id,
        "raw_version_id": raw_version_id,
        "unit_count": 1,
        "canonical_markdown_path": canonical_markdown_path,
        "document_units_path": document_units_path,
        "serving_intent": serving_intent,
        "promotion_block_reason": promotion_block_reason,
    }


def _document_units_row_for(
    *,
    document_id: str,
    version_id: str,
    source_url: str,
    title: str,
    semantic_content_hash: str | None = None,
) -> dict[str, object]:
    metadata: dict[str, object] = {
        "page_family": "article_detail",
        "unit_type": "page_content",
        "serving_intent": "promotable",
        "content_role": "primary_content",
        "document_id": document_id,
        "version_id": version_id,
        "source_url": source_url,
        "title": title,
    }
    if semantic_content_hash is not None:
        metadata["semantic_content_hash"] = semantic_content_hash
    return {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": f"{document_id}:0001",
        "clean_text": "中央民族大学与北京丰台人才集团共建就业实习实践基地。",
        "anchor": {"section_path": ["新闻"], "page_start": 1, "page_end": 1},
        "entitlement_groups": [],
        "visibility_scope": None,
        "visibility_level": "public",
        "metadata": metadata,
    }


def _bundle_payload() -> dict[str, object]:
    return {
        "schemaVersion": "official_web_source_truth_bundle.v1",
        "sourceChannel": "official_web",
        "siteId": "muc_public",
        "crawlRunId": "subset-run-001",
        "generatedAt": "2026-04-03T00:00:00+00:00",
        "pages": [
            {
                "rawAssetId": "owasset_doc_1",
                "rawVersionId": "owver_doc_1",
                "normalizedCanonicalUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                "pageFamily": "article_detail",
                "pageManifestObjectKey": (
                    "official_web/owasset_doc_1/undated/owver_doc_1/source-truth/page-manifest.json"
                ),
                "contentBlocksObjectKey": (
                    "official_web/owasset_doc_1/undated/owver_doc_1/source-truth/content-blocks.jsonl"
                ),
                "providerExtractionObjectKey": (
                    "official_web/owasset_doc_1/undated/owver_doc_1/provider/cheerio-basic/page-extraction.json"
                ),
                "responseHtmlObjectKey": (
                    "official_web/owasset_doc_1/undated/owver_doc_1/capture/response.html"
                ),
                "responseBodyHash": "sha256:body-1",
                "blockCount": 2,
            }
        ],
    }


def _page_manifest() -> dict[str, object]:
    return {
        "schemaVersion": "official_web_page_manifest.v1",
        "sourceChannel": "official_web",
        "siteId": "muc_public",
        "host": "www.muc.edu.cn",
        "rawAssetId": "owasset_doc_1",
        "rawVersionId": "owver_doc_1",
        "requestedUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
        "finalUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
        "declaredCanonicalUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
        "normalizedCanonicalUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
        "urlIdentityBasis": "declared_canonical",
        "fetchedAt": "2026-04-03T00:00:00.000Z",
        "httpStatus": 200,
        "contentType": "text/html",
        "responseBodyHash": "sha256:body-1",
        "retainedSnapshotHash": "sha256:snapshot-1",
        "fetcherName": "collector-test",
        "fetcherVersion": "1.0",
        "parserName": "cheerio-basic",
        "parserVersion": "1.0",
        "pageTitleRaw": "学校简介",
        "pageTitleNormalized": "学校简介",
        "languageHint": "zh-CN",
        "pageFamily": "article_detail",
        "pageFamilyConfidence": 0.99,
        "pageFamilyReason": "test-fixture",
        "mainContentHash": "sha256:main-1",
        "blockCount": 2,
        "mainContentBlockCount": 2,
        "navigationBlockCount": 0,
        "boilerplateBlockCount": 0,
        "crawlRunId": "subset-run-001",
        "hostPolicyVersion": "campus_public_hosts_v1",
        "crawlPolicyVersion": "campus_public_crawl_policy_v1",
        "credentialsMode": "public",
    }


def _existing_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="official_web:muc_public_pages:old-doc",
        revision_track="source-faithful",
        version_id="owdocver:old-doc",
        source_uri="https://news.muc.edu.cn/",
        content_hash="sha256:old-doc",
        corpus="official_web",
        collection="muc_public_pages",
        cleaning_policy_version="official_web_cleaning_v2",
        entitlement_groups=(),
        visibility_scope=None,
        status="active",
        ingestion_timestamp="2026-04-02T00:00:00+00:00",
        parser_version="official_web_projection_replay.v1",
        embedding_model="",
        source_channel="official_web",
        is_current=True,
        document_units_object_key="official_web/documents/muc_public_pages/old-doc/document-units.jsonl",
        processed_object_keys=(
            "official_web/documents/muc_public_pages/old-doc/document-units.jsonl",
        ),
        import_source="official_web_source_truth_replay",
    )


def _existing_raw_asset_record() -> object:
    from campus_ingestion_core.models import RawAssetRecord

    return RawAssetRecord(
        raw_asset_id="owasset_old_doc",
        raw_version_id="owver_old_doc",
        corpus="official_web",
        collection="muc_public_pages",
        raw_source_uri="https://news.muc.edu.cn/",
        content_hash="sha256:old-raw",
        source_filename="response.html",
        object_key="official_web/owasset_old_doc/undated/owver_old_doc/capture/response.html",
        ingestion_timestamp="2026-04-02T00:00:00+00:00",
        import_source="official_web_source_truth_replay",
    )


def _object_store_settings():
    return worker.ObjectStoreSettings(
        endpoint="http://localhost:9000",
        access_key="minioadmin",
        secret_key="minioadmin",
        bucket_source="campus-rag-source",
        bucket_derived="campus-rag-derived",
        secure=False,
    )
