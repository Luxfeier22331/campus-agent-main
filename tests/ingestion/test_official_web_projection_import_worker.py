from __future__ import annotations

import importlib
from dataclasses import replace
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from campus_ingestion_core.campusrag_ingestion_support import ImportReport
from campus_ingestion_core.models import DocumentRegistryRecord
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

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
    metadata = {
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
        processed_object_keys=("official_web/documents/muc_public_pages/old-doc/document-units.jsonl",),
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


class OfficialWebProjectionImportTest(unittest.TestCase):
    def test_import_projection_output_prefers_local_provider_artifact_when_present(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_dir = root / "projection-output"
            replay_input_dir = root / "replay-input"
            work_dir = root / "work"
            projection_report = _projection_report()
            canonical_path = projection_dir / "canonical.md"
            document_units_path = projection_dir / "document-units.jsonl"
            projection_report["documents"][0]["canonical_markdown_path"] = str(canonical_path)
            projection_report["documents"][0]["document_units_path"] = str(document_units_path)
            _write_json(projection_dir / "projection-report.json", projection_report)
            canonical_path.write_text("# 学校简介\n\n中央民族大学学校简介。", encoding="utf-8")
            _write_jsonl(document_units_path, [_document_units_row()])
            _write_json(replay_input_dir / "source-truth-bundle.json", _bundle_payload())
            provider_path = (
                replay_input_dir
                / "source-assets"
                / "owasset_doc_1"
                / "owver_doc_1"
                / "provider"
                / "cheerio-basic"
                / "page-extraction.json"
            )
            _write_json(provider_path, {"title": "学校简介", "source": "local"})
            object_store = _FakeObjectStore()

            report = worker.import_projection_output(
                work_dir=work_dir,
                projection_output_dir=projection_dir,
                replay_input_dir=replay_input_dir,
                source_object_store=object_store,
                derived_object_store=object_store,
                document_registry=InMemoryDocumentRegistry(),
                raw_asset_registry=InMemoryRawAssetRegistry(),
                object_store_settings=worker.ObjectStoreSettings(
                    endpoint="http://localhost:9000",
                    access_key="minioadmin",
                    secret_key="minioadmin",
                    bucket_source="campus-rag-source",
                    bucket_derived="campus-rag-derived",
                    secure=False,
                ),
                scope_refresh=("official_web", "muc_public_pages"),
                require_promotable=True,
            )

        self.assertEqual(report.success_count, 1)

    def test_import_projection_output_scope_refresh_replaces_existing_scope(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_dir = root / "projection-output"
            replay_input_dir = root / "replay-input"
            work_dir = root / "work"
            projection_report = _projection_report()
            canonical_path = projection_dir / "canonical.md"
            document_units_path = projection_dir / "document-units.jsonl"
            projection_report["documents"][0]["canonical_markdown_path"] = str(canonical_path)
            projection_report["documents"][0]["document_units_path"] = str(document_units_path)
            _write_json(projection_dir / "projection-report.json", projection_report)
            canonical_path.write_text("# 学校简介\n\n中央民族大学学校简介。", encoding="utf-8")
            _write_jsonl(document_units_path, [_document_units_row()])
            _write_json(replay_input_dir / "source-truth-bundle.json", _bundle_payload())
            _write_json(
                replay_input_dir
                / "source-assets"
                / "owasset_doc_1"
                / "owver_doc_1"
                / "source-truth"
                / "page-manifest.json",
                _page_manifest(),
            )
            _write_jsonl(
                replay_input_dir
                / "source-assets"
                / "owasset_doc_1"
                / "owver_doc_1"
                / "source-truth"
                / "content-blocks.jsonl",
                [
                    {"rowId": "title-1", "textRaw": "学校简介"},
                    {"rowId": "p-1", "textRaw": "中央民族大学学校简介。"},
                ],
            )
            object_store = _FakeObjectStore(
                objects={
                    (
                        "campus-rag-source",
                        "official_web/owasset_doc_1/undated/owver_doc_1/provider/cheerio-basic/page-extraction.json",
                    ): json.dumps({"title": "学校简介"}, ensure_ascii=False).encode("utf-8")
                }
            )
            document_registry = InMemoryDocumentRegistry((_existing_record(),))
            raw_asset_registry = InMemoryRawAssetRegistry((_existing_raw_asset_record(),))

            report = worker.import_projection_output(
                work_dir=work_dir,
                projection_output_dir=projection_dir,
                replay_input_dir=replay_input_dir,
                source_object_store=object_store,
                derived_object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                object_store_settings=worker.ObjectStoreSettings(
                    endpoint="http://localhost:9000",
                    access_key="minioadmin",
                    secret_key="minioadmin",
                    bucket_source="campus-rag-source",
                    bucket_derived="campus-rag-derived",
                    secure=False,
                ),
                scope_refresh=("official_web", "muc_public_pages"),
                require_promotable=True,
            )

        self.assertEqual(report.success_count, 1)
        records = document_registry.list_by_scope("official_web", "muc_public_pages")
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].document_id, "official_web:muc_public_pages:article_detail:doc-1")
        raw_records = raw_asset_registry.list_by_scope("official_web", "muc_public_pages")
        self.assertEqual(len(raw_records), 1)
        self.assertEqual(raw_records[0].raw_asset_id, "owasset_doc_1")

    def test_import_projection_output_filters_mixed_replay_to_requested_scope_refresh(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_dir = root / "projection-output"
            replay_input_dir = root / "replay-input"
            work_dir = root / "work"

            stable_canonical_path = projection_dir / "stable-reference.md"
            stable_units_path = projection_dir / "stable-reference.jsonl"
            bridge_canonical_path = projection_dir / "bridge.md"
            bridge_units_path = projection_dir / "bridge.jsonl"

            stable_document = _projection_document(
                document_id="official_web:stable_reference:article_detail:stable-doc",
                version_id="owdocver:stable-doc",
                title="学校简介",
                normalized_canonical_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                raw_asset_id="owasset_stable_doc",
                raw_version_id="owver_stable_doc",
                canonical_markdown_path=str(stable_canonical_path),
                document_units_path=str(stable_units_path),
            )
            stable_document["target_collection"] = "stable_reference"
            stable_document["routing_route_id"] = "stable-reference-bootstrap"

            bridge_document = _projection_document(
                document_id="official_web:muc_public_pages:article_detail:bridge-doc",
                version_id="owdocver:bridge-doc",
                title="校园新闻",
                normalized_canonical_url="https://news.muc.edu.cn/info/1011/61874.htm",
                raw_asset_id="owasset_bridge_doc",
                raw_version_id="owver_bridge_doc",
                canonical_markdown_path=str(bridge_canonical_path),
                document_units_path=str(bridge_units_path),
            )

            projection_report = {
                "schemaVersion": "official_web_projection_replay_report.v1",
                "siteId": "muc_public",
                "crawlRunId": "subset-run-001",
                "outputDir": "/tmp/replay",
                "projectionOutputDir": "/tmp/projection",
                "generatedAt": "2026-04-03T00:00:00+00:00",
                "counts": {"pages_seen": 2, "emitted_documents": 2, "manual_review_pages": 0},
                "documents": [stable_document, bridge_document],
                "manual_review_pages": [],
            }
            _write_json(projection_dir / "projection-report.json", projection_report)

            stable_canonical_path.write_text("# 学校简介\n\n中央民族大学学校简介。", encoding="utf-8")
            bridge_canonical_path.write_text("# 校园新闻\n\n学校召开专题工作会议。", encoding="utf-8")
            _write_jsonl(
                stable_units_path,
                [
                    _document_units_row_for(
                        document_id="official_web:stable_reference:article_detail:stable-doc",
                        version_id="owdocver:stable-doc",
                        source_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        title="学校简介",
                    )
                ],
            )
            _write_jsonl(
                bridge_units_path,
                [
                    _document_units_row_for(
                        document_id="official_web:muc_public_pages:article_detail:bridge-doc",
                        version_id="owdocver:bridge-doc",
                        source_url="https://news.muc.edu.cn/info/1011/61874.htm",
                        title="校园新闻",
                    )
                ],
            )
            _write_json(
                replay_input_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "muc_public",
                    "crawlRunId": "subset-run-001",
                    "generatedAt": "2026-04-03T00:00:00+00:00",
                    "pages": [
                        {
                            "rawAssetId": "owasset_stable_doc",
                            "rawVersionId": "owver_stable_doc",
                            "normalizedCanonicalUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                            "pageFamily": "article_detail",
                            "providerExtractionObjectKey": (
                                "official_web/owasset_stable_doc/undated/owver_stable_doc/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_stable_doc/undated/owver_stable_doc/capture/response.html"
                            ),
                            "responseBodyHash": "sha256:body-stable",
                            "blockCount": 1,
                        },
                        {
                            "rawAssetId": "owasset_bridge_doc",
                            "rawVersionId": "owver_bridge_doc",
                            "normalizedCanonicalUrl": "https://news.muc.edu.cn/info/1011/61874.htm",
                            "pageFamily": "article_detail",
                            "providerExtractionObjectKey": (
                                "official_web/owasset_bridge_doc/undated/owver_bridge_doc/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_bridge_doc/undated/owver_bridge_doc/capture/response.html"
                            ),
                            "responseBodyHash": "sha256:body-bridge",
                            "blockCount": 1,
                        },
                    ],
                },
            )

            object_store = _FakeObjectStore(
                objects={
                    (
                        "campus-rag-source",
                        "official_web/owasset_stable_doc/undated/owver_stable_doc/provider/cheerio-basic/page-extraction.json",
                    ): json.dumps({"title": "学校简介"}, ensure_ascii=False).encode("utf-8"),
                    (
                        "campus-rag-source",
                        "official_web/owasset_bridge_doc/undated/owver_bridge_doc/provider/cheerio-basic/page-extraction.json",
                    ): json.dumps({"title": "校园新闻"}, ensure_ascii=False).encode("utf-8"),
                }
            )
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()

            report = worker.import_projection_output(
                work_dir=work_dir,
                projection_output_dir=projection_dir,
                replay_input_dir=replay_input_dir,
                source_object_store=object_store,
                derived_object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                object_store_settings=worker.ObjectStoreSettings(
                    endpoint="http://localhost:9000",
                    access_key="minioadmin",
                    secret_key="minioadmin",
                    bucket_source="campus-rag-source",
                    bucket_derived="campus-rag-derived",
                    secure=False,
                ),
                scope_refresh=("official_web", "stable_reference"),
                require_promotable=True,
            )

        self.assertEqual(report.success_count, 1)
        stable_records = document_registry.list_by_scope("official_web", "stable_reference")
        self.assertEqual(len(stable_records), 1)
        self.assertEqual(stable_records[0].document_id, "official_web:stable_reference:article_detail:stable-doc")
        self.assertEqual(len(document_registry.list_by_scope("official_web", "muc_public_pages")), 0)
        stable_raw_records = raw_asset_registry.list_by_scope("official_web", "stable_reference")
        self.assertEqual(len(stable_raw_records), 1)
        self.assertEqual(stable_raw_records[0].raw_asset_id, "owasset_stable_doc")
        self.assertEqual(len(raw_asset_registry.list_by_scope("official_web", "muc_public_pages")), 0)

    def test_import_projection_output_rejects_non_promotable_documents_when_required(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_dir = root / "projection-output"
            replay_input_dir = root / "replay-input"
            work_dir = root / "work"
            projection_report = _projection_report()
            projection_report["documents"][0]["serving_intent"] = "pending_review"
            projection_report["documents"][0]["promotion_block_reason"] = "manual_review_pending"
            canonical_path = projection_dir / "canonical.md"
            document_units_path = projection_dir / "document-units.jsonl"
            projection_report["documents"][0]["canonical_markdown_path"] = str(canonical_path)
            projection_report["documents"][0]["document_units_path"] = str(document_units_path)
            _write_json(projection_dir / "projection-report.json", projection_report)
            canonical_path.write_text("# 学校简介\n\n中央民族大学学校简介。", encoding="utf-8")
            _write_jsonl(document_units_path, [_document_units_row()])
            _write_json(replay_input_dir / "source-truth-bundle.json", _bundle_payload())
            object_store = _FakeObjectStore()

            with self.assertRaisesRegex(ValueError, "non-promotable"):
                worker.import_projection_output(
                    work_dir=work_dir,
                    projection_output_dir=projection_dir,
                    replay_input_dir=replay_input_dir,
                    source_object_store=object_store,
                    derived_object_store=object_store,
                    document_registry=InMemoryDocumentRegistry(),
                    raw_asset_registry=InMemoryRawAssetRegistry(),
                    object_store_settings=worker.ObjectStoreSettings(
                        endpoint="http://localhost:9000",
                        access_key="minioadmin",
                        secret_key="minioadmin",
                        bucket_source="campus-rag-source",
                        bucket_derived="campus-rag-derived",
                        secure=False,
                    ),
                    scope_refresh=("official_web", "muc_public_pages"),
                    require_promotable=True,
                )

    def test_import_projection_output_skips_audit_only_documents_when_required(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_dir = root / "projection-output"
            replay_input_dir = root / "replay-input"
            work_dir = root / "work"

            promotable_canonical_path = projection_dir / "promotable.md"
            promotable_units_path = projection_dir / "promotable.jsonl"
            audit_only_canonical_path = projection_dir / "audit-only.md"
            audit_only_units_path = projection_dir / "audit-only.jsonl"

            projection_report = {
                "schemaVersion": "official_web_projection_replay_report.v1",
                "siteId": "muc_public",
                "crawlRunId": "subset-run-001",
                "outputDir": "/tmp/replay",
                "projectionOutputDir": "/tmp/projection",
                "generatedAt": "2026-04-03T00:00:00+00:00",
                "counts": {"pages_seen": 2, "emitted_documents": 2, "manual_review_pages": 0},
                "documents": [
                    _projection_document(
                        document_id="official_web:muc_public_pages:article_detail:doc-1",
                        version_id="owdocver:doc-1",
                        title="学校简介",
                        normalized_canonical_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        raw_asset_id="owasset_doc_1",
                        raw_version_id="owver_doc_1",
                        canonical_markdown_path=str(promotable_canonical_path),
                        document_units_path=str(promotable_units_path),
                    ),
                    _projection_document(
                        document_id="official_web:muc_public_pages:article_detail:doc-audit-only",
                        version_id="owdocver:doc-audit-only",
                        title="中央民族大学公开招聘及公示信息",
                        normalized_canonical_url="https://xxgk.muc.edu.cn/info/1297/5711.htm",
                        raw_asset_id="owasset_doc_2",
                        raw_version_id="owver_doc_2",
                        canonical_markdown_path=str(audit_only_canonical_path),
                        document_units_path=str(audit_only_units_path),
                        serving_intent="audit_only",
                        promotion_block_reason="low_value_public_notice_audit_only",
                    ),
                ],
                "manual_review_pages": [],
            }
            _write_json(projection_dir / "projection-report.json", projection_report)
            promotable_canonical_path.write_text("# 学校简介\n\n中央民族大学学校简介。", encoding="utf-8")
            audit_only_canonical_path.write_text("# 招聘公示\n\n中央民族大学公开招聘及公示信息。", encoding="utf-8")
            _write_jsonl(
                promotable_units_path,
                [
                    _document_units_row_for(
                        document_id="official_web:muc_public_pages:article_detail:doc-1",
                        version_id="owdocver:doc-1",
                        source_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        title="学校简介",
                    )
                ],
            )
            audit_only_row = _document_units_row_for(
                document_id="official_web:muc_public_pages:article_detail:doc-audit-only",
                version_id="owdocver:doc-audit-only",
                source_url="https://xxgk.muc.edu.cn/info/1297/5711.htm",
                title="中央民族大学公开招聘及公示信息",
            )
            audit_only_row["metadata"]["serving_intent"] = "audit_only"
            audit_only_row["metadata"]["promotion_block_reason"] = "low_value_public_notice_audit_only"
            _write_jsonl(audit_only_units_path, [audit_only_row])
            _write_json(
                replay_input_dir / "source-truth-bundle.json",
                {
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
                            "providerExtractionObjectKey": (
                                "official_web/owasset_doc_1/undated/owver_doc_1/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_doc_1/undated/owver_doc_1/capture/response.html"
                            ),
                            "responseBodyHash": "sha256:body-1",
                        },
                        {
                            "rawAssetId": "owasset_doc_2",
                            "rawVersionId": "owver_doc_2",
                            "normalizedCanonicalUrl": "https://xxgk.muc.edu.cn/info/1297/5711.htm",
                            "pageFamily": "article_detail",
                            "providerExtractionObjectKey": (
                                "official_web/owasset_doc_2/undated/owver_doc_2/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_doc_2/undated/owver_doc_2/capture/response.html"
                            ),
                            "responseBodyHash": "sha256:body-2",
                        },
                    ],
                },
            )
            _write_json(
                replay_input_dir
                / "source-assets"
                / "owasset_doc_1"
                / "owver_doc_1"
                / "provider"
                / "cheerio-basic"
                / "page-extraction.json",
                {"title": "学校简介"},
            )
            _write_json(
                replay_input_dir
                / "source-assets"
                / "owasset_doc_2"
                / "owver_doc_2"
                / "provider"
                / "cheerio-basic"
                / "page-extraction.json",
                {"title": "中央民族大学公开招聘及公示信息"},
            )
            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()

            report = worker.import_projection_output(
                work_dir=work_dir,
                projection_output_dir=projection_dir,
                replay_input_dir=replay_input_dir,
                source_object_store=object_store,
                derived_object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                object_store_settings=worker.ObjectStoreSettings(
                    endpoint="http://localhost:9000",
                    access_key="minioadmin",
                    secret_key="minioadmin",
                    bucket_source="campus-rag-source",
                    bucket_derived="campus-rag-derived",
                    secure=False,
                ),
                scope_refresh=("official_web", "muc_public_pages"),
                require_promotable=True,
            )

        self.assertEqual(report.success_count, 1)
        self.assertEqual(report.skipped_count, 1)
        self.assertEqual(
            report.skipped_document_ids,
            ("official_web:muc_public_pages:article_detail:doc-audit-only",),
        )
        records = document_registry.list_by_scope("official_web", "muc_public_pages")
        self.assertEqual(
            [record.document_id for record in records],
            ["official_web:muc_public_pages:article_detail:doc-1"],
        )

    def test_import_projection_output_scope_refresh_drops_existing_audit_only_truth(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_dir = root / "projection-output"
            replay_input_dir = root / "replay-input"
            work_dir = root / "work"

            promotable_canonical_path = projection_dir / "promotable.md"
            promotable_units_path = projection_dir / "promotable.jsonl"
            audit_only_canonical_path = projection_dir / "audit-only.md"
            audit_only_units_path = projection_dir / "audit-only.jsonl"

            projection_report = {
                "schemaVersion": "official_web_projection_replay_report.v1",
                "siteId": "muc_public",
                "crawlRunId": "subset-run-001",
                "outputDir": "/tmp/replay",
                "projectionOutputDir": "/tmp/projection",
                "generatedAt": "2026-04-03T00:00:00+00:00",
                "counts": {"pages_seen": 2, "emitted_documents": 2, "manual_review_pages": 0},
                "documents": [
                    _projection_document(
                        document_id="official_web:muc_public_pages:article_detail:doc-1",
                        version_id="owdocver:doc-1",
                        title="学校简介",
                        normalized_canonical_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        raw_asset_id="owasset_doc_1",
                        raw_version_id="owver_doc_1",
                        canonical_markdown_path=str(promotable_canonical_path),
                        document_units_path=str(promotable_units_path),
                    ),
                    _projection_document(
                        document_id="official_web:muc_public_pages:article_detail:doc-audit-only",
                        version_id="owdocver:doc-audit-only",
                        title="中央民族大学公开招聘及公示信息",
                        normalized_canonical_url="https://xxgk.muc.edu.cn/info/1297/5711.htm",
                        raw_asset_id="owasset_doc_2",
                        raw_version_id="owver_doc_2",
                        canonical_markdown_path=str(audit_only_canonical_path),
                        document_units_path=str(audit_only_units_path),
                        serving_intent="audit_only",
                        promotion_block_reason="low_value_public_notice_audit_only",
                    ),
                ],
                "manual_review_pages": [],
            }
            _write_json(projection_dir / "projection-report.json", projection_report)
            promotable_canonical_path.write_text("# 学校简介\n\n中央民族大学学校简介。", encoding="utf-8")
            audit_only_canonical_path.write_text("# 招聘公示\n\n中央民族大学公开招聘及公示信息。", encoding="utf-8")
            _write_jsonl(
                promotable_units_path,
                [
                    _document_units_row_for(
                        document_id="official_web:muc_public_pages:article_detail:doc-1",
                        version_id="owdocver:doc-1",
                        source_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        title="学校简介",
                    )
                ],
            )
            audit_only_row = _document_units_row_for(
                document_id="official_web:muc_public_pages:article_detail:doc-audit-only",
                version_id="owdocver:doc-audit-only",
                source_url="https://xxgk.muc.edu.cn/info/1297/5711.htm",
                title="中央民族大学公开招聘及公示信息",
            )
            audit_only_row["metadata"]["serving_intent"] = "audit_only"
            audit_only_row["metadata"]["promotion_block_reason"] = "low_value_public_notice_audit_only"
            _write_jsonl(audit_only_units_path, [audit_only_row])
            _write_json(
                replay_input_dir / "source-truth-bundle.json",
                {
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
                            "providerExtractionObjectKey": (
                                "official_web/owasset_doc_1/undated/owver_doc_1/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_doc_1/undated/owver_doc_1/capture/response.html"
                            ),
                            "responseBodyHash": "sha256:body-1",
                        },
                        {
                            "rawAssetId": "owasset_doc_2",
                            "rawVersionId": "owver_doc_2",
                            "normalizedCanonicalUrl": "https://xxgk.muc.edu.cn/info/1297/5711.htm",
                            "pageFamily": "article_detail",
                            "providerExtractionObjectKey": (
                                "official_web/owasset_doc_2/undated/owver_doc_2/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_doc_2/undated/owver_doc_2/capture/response.html"
                            ),
                            "responseBodyHash": "sha256:body-2",
                        },
                    ],
                },
            )
            _write_json(
                replay_input_dir
                / "source-assets"
                / "owasset_doc_1"
                / "owver_doc_1"
                / "provider"
                / "cheerio-basic"
                / "page-extraction.json",
                {"title": "学校简介"},
            )
            _write_json(
                replay_input_dir
                / "source-assets"
                / "owasset_doc_2"
                / "owver_doc_2"
                / "provider"
                / "cheerio-basic"
                / "page-extraction.json",
                {"title": "中央民族大学公开招聘及公示信息"},
            )
            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()

            worker.import_projection_output(
                work_dir=work_dir,
                projection_output_dir=projection_dir,
                replay_input_dir=replay_input_dir,
                source_object_store=object_store,
                derived_object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                object_store_settings=worker.ObjectStoreSettings(
                    endpoint="http://localhost:9000",
                    access_key="minioadmin",
                    secret_key="minioadmin",
                    bucket_source="campus-rag-source",
                    bucket_derived="campus-rag-derived",
                    secure=False,
                ),
                scope_refresh=("official_web", "muc_public_pages"),
                require_promotable=True,
            )
            promotable_record = document_registry.list_by_scope("official_web", "muc_public_pages")[0]
            audit_only_record = replace(
                promotable_record,
                document_id="official_web:muc_public_pages:article_detail:doc-audit-only",
                version_id="owdocver:doc-audit-only",
                source_uri="https://xxgk.muc.edu.cn/info/1297/5711.htm",
                content_hash="sha256:audit-only-stale",
            )
            document_registry.upsert(audit_only_record)

            report = worker.import_projection_output(
                work_dir=work_dir,
                projection_output_dir=projection_dir,
                replay_input_dir=replay_input_dir,
                source_object_store=object_store,
                derived_object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                object_store_settings=worker.ObjectStoreSettings(
                    endpoint="http://localhost:9000",
                    access_key="minioadmin",
                    secret_key="minioadmin",
                    bucket_source="campus-rag-source",
                    bucket_derived="campus-rag-derived",
                    secure=False,
                ),
                scope_refresh=("official_web", "muc_public_pages"),
                require_promotable=True,
            )

        self.assertEqual(report.success_count, 0)
        self.assertEqual(report.skipped_count, 2)
        records = document_registry.list_by_scope("official_web", "muc_public_pages")
        self.assertEqual(
            [record.document_id for record in records],
            ["official_web:muc_public_pages:article_detail:doc-1"],
        )

    def test_import_projection_output_merges_cross_host_equivalent_documents_into_single_scope_truth(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_dir = root / "projection-output"
            replay_input_dir = root / "replay-input"
            work_dir = root / "work"
            semantic_hash = "sha256:semantic-duplicate"

            news_canonical_path = projection_dir / "news-canonical.md"
            news_units_path = projection_dir / "news-document-units.jsonl"
            xxgk_canonical_path = projection_dir / "xxgk-canonical.md"
            xxgk_units_path = projection_dir / "xxgk-document-units.jsonl"

            projection_report = {
                "schemaVersion": "official_web_projection_replay_report.v1",
                "siteId": "muc_public",
                "crawlRunId": "subset-run-001",
                "outputDir": "/tmp/replay",
                "projectionOutputDir": "/tmp/projection",
                "generatedAt": "2026-04-03T00:00:00+00:00",
                "counts": {"pages_seen": 2, "emitted_documents": 2, "manual_review_pages": 0},
                "documents": [
                    _projection_document(
                        document_id="official_web:muc_public_pages:article_detail:news-doc",
                        version_id="owdocver:news-doc",
                        title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                        normalized_canonical_url="https://news.muc.edu.cn/info/1011/61874.htm",
                        raw_asset_id="owasset_news_doc",
                        raw_version_id="owver_news_doc",
                        canonical_markdown_path=str(news_canonical_path),
                        document_units_path=str(news_units_path),
                    ),
                    _projection_document(
                        document_id="official_web:muc_public_pages:article_detail:xxgk-doc",
                        version_id="owdocver:xxgk-doc",
                        title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                        normalized_canonical_url="https://xxgk.muc.edu.cn/info/1362/28641.htm",
                        raw_asset_id="owasset_xxgk_doc",
                        raw_version_id="owver_xxgk_doc",
                        canonical_markdown_path=str(xxgk_canonical_path),
                        document_units_path=str(xxgk_units_path),
                    ),
                ],
                "manual_review_pages": [],
            }
            _write_json(projection_dir / "projection-report.json", projection_report)
            news_canonical_path.write_text("# 标题\n\n同文内容。", encoding="utf-8")
            xxgk_canonical_path.write_text("# 标题\n\n同文内容。", encoding="utf-8")
            _write_jsonl(
                news_units_path,
                [
                    _document_units_row_for(
                        document_id="official_web:muc_public_pages:article_detail:news-doc",
                        version_id="owdocver:news-doc",
                        source_url="https://news.muc.edu.cn/info/1011/61874.htm",
                        title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                        semantic_content_hash=semantic_hash,
                    )
                ],
            )
            _write_jsonl(
                xxgk_units_path,
                [
                    _document_units_row_for(
                        document_id="official_web:muc_public_pages:article_detail:xxgk-doc",
                        version_id="owdocver:xxgk-doc",
                        source_url="https://xxgk.muc.edu.cn/info/1362/28641.htm",
                        title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                        semantic_content_hash=semantic_hash,
                    )
                ],
            )
            _write_json(
                replay_input_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "muc_public",
                    "crawlRunId": "subset-run-001",
                    "generatedAt": "2026-04-03T00:00:00+00:00",
                    "pages": [
                        {
                            "rawAssetId": "owasset_news_doc",
                            "rawVersionId": "owver_news_doc",
                            "normalizedCanonicalUrl": "https://news.muc.edu.cn/info/1011/61874.htm",
                            "pageFamily": "article_detail",
                            "providerExtractionObjectKey": (
                                "official_web/owasset_news_doc/undated/owver_news_doc/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_news_doc/undated/owver_news_doc/capture/response.html"
                            ),
                            "responseBodyHash": "sha256:body-news",
                            "blockCount": 1,
                        },
                        {
                            "rawAssetId": "owasset_xxgk_doc",
                            "rawVersionId": "owver_xxgk_doc",
                            "normalizedCanonicalUrl": "https://xxgk.muc.edu.cn/info/1362/28641.htm",
                            "pageFamily": "article_detail",
                            "providerExtractionObjectKey": (
                                "official_web/owasset_xxgk_doc/undated/owver_xxgk_doc/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_xxgk_doc/undated/owver_xxgk_doc/capture/response.html"
                            ),
                            "responseBodyHash": "sha256:body-xxgk",
                            "blockCount": 1,
                        },
                    ],
                },
            )
            object_store = _FakeObjectStore(
                objects={
                    (
                        "campus-rag-source",
                        "official_web/owasset_news_doc/undated/owver_news_doc/provider/cheerio-basic/page-extraction.json",
                    ): json.dumps({"title": "同文"}, ensure_ascii=False).encode("utf-8"),
                    (
                        "campus-rag-source",
                        "official_web/owasset_xxgk_doc/undated/owver_xxgk_doc/provider/cheerio-basic/page-extraction.json",
                    ): json.dumps({"title": "同文"}, ensure_ascii=False).encode("utf-8"),
                }
            )
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()

            report = worker.import_projection_output(
                work_dir=work_dir,
                projection_output_dir=projection_dir,
                replay_input_dir=replay_input_dir,
                source_object_store=object_store,
                derived_object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                object_store_settings=worker.ObjectStoreSettings(
                    endpoint="http://localhost:9000",
                    access_key="minioadmin",
                    secret_key="minioadmin",
                    bucket_source="campus-rag-source",
                    bucket_derived="campus-rag-derived",
                    secure=False,
                ),
                scope_refresh=("official_web", "muc_public_pages"),
                require_promotable=True,
            )

        self.assertEqual(report.success_count, 1)
        self.assertEqual(report.skipped_count, 1)
        records = document_registry.list_by_scope("official_web", "muc_public_pages")
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].document_id, "official_web:muc_public_pages:article_detail:news-doc")
        self.assertEqual(len(records[0].source_observations), 2)
        self.assertEqual(
            {observation.source_uri for observation in records[0].source_observations},
            {
                "https://news.muc.edu.cn/info/1011/61874.htm",
                "https://xxgk.muc.edu.cn/info/1362/28641.htm",
            },
        )
        raw_records = raw_asset_registry.list_by_scope("official_web", "muc_public_pages")
        self.assertEqual(len(raw_records), 2)


class OfficialWebProjectionImportWorkerCliTest(unittest.TestCase):
    def test_main_passes_cli_args_into_import_projection_output(self) -> None:
        fake_report = ImportReport(
            import_mode="official_web_source_truth_replay",
            success_count=1,
            skipped_count=0,
            failed_count=0,
            raw_uploaded_count=0,
            raw_reused_count=0,
            document_ids=("official_web:muc_public_pages:article_detail:doc-1",),
            created_document_ids=("official_web:muc_public_pages:article_detail:doc-1",),
            updated_document_ids=(),
            skipped_document_ids=(),
            unresolved_source_pdfs=(),
            errors=(),
            report_path="/tmp/work/import-reports/official-web-import.json",
        )
        with (
            patch("campus_ingestion_worker.official_web_projection_import.load_worker_env"),
            patch(
                "campus_ingestion_worker.official_web_projection_import._resolve_object_store_settings"
            ) as resolve_settings,
            patch(
                "campus_ingestion_worker.official_web_projection_import.build_document_registry_from_env"
            ) as build_document_registry,
            patch(
                "campus_ingestion_worker.official_web_projection_import.build_raw_asset_registry_from_env"
            ) as build_raw_asset_registry,
            patch(
                "campus_ingestion_worker.official_web_projection_import.import_projection_output"
            ) as import_projection_output,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            resolve_settings.return_value = worker.ObjectStoreSettings(
                endpoint="http://localhost:9000",
                access_key="minioadmin",
                secret_key="minioadmin",
                bucket_source="campus-rag-source",
                bucket_derived="campus-rag-derived",
                secure=False,
            )
            build_document_registry.return_value = Mock()
            build_raw_asset_registry.return_value = Mock()
            import_projection_output.return_value = fake_report
            worker.main(
                [
                    "--projection-output-dir",
                    "/tmp/projection-output",
                    "--replay-input-dir",
                    "/tmp/replay-input",
                    "--work-dir",
                    "/tmp/work",
                    "--corpus",
                    "official_web",
                    "--collection",
                    "muc_public_pages",
                    "--require-promotable",
                ]
            )

        self.assertEqual(
            import_projection_output.call_args.kwargs["scope_refresh"],
            ("official_web", "muc_public_pages"),
        )
        self.assertTrue(import_projection_output.call_args.kwargs["require_promotable"])
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["success_count"], 1)


if __name__ == "__main__":
    unittest.main()
