from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from campus_ingestion_core.campusrag_ingestion_support import ImportReport
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.official_web_chunking_audit import OfficialWebProjectionChunkingAuditReport
from campus_ingestion_core.official_web_projection import (
    OfficialWebProjectionReplayReport,
    OfficialWebProjectionValidationReport,
)
from campus_ingestion_worker.official_web_handoff_consumer import (
    OfficialWebHandoffConsumeResult,
    OfficialWebHandoffConsumerSettings,
    consume_handoff_record,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def _declarations_payload() -> dict[str, object]:
    return {
        "schema_version": "official_web_projection_declarations.v1",
        "site_id": "campus_public",
        "projection_policy_version": "campus_public_projection_v1",
        "declarations": [
            {
                "declaration_id": "article-detail-primary",
                "page_family": "article_detail",
                "target_corpus": "official_web",
                "target_collection": "muc_public_pages",
                "projection_family": "content_document",
                "document_kind": "article",
                "action": "emit_document",
            }
        ],
    }


def _block(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    row_id: str,
    row_index: int,
    block_order: int,
    block_role: str,
    text: str,
) -> dict[str, object]:
    return {
        "schemaVersion": "official_web_content_block.v1",
        "rawAssetId": raw_asset_id,
        "rawVersionId": raw_version_id,
        "rowId": row_id,
        "rowIndex": row_index,
        "blockOrder": block_order,
        "blockRole": block_role,
        "headingLevel": 1 if block_role in {"title", "heading"} else None,
        "domPath": None,
        "parentHeadingPath": [],
        "listLevel": None,
        "tableId": None,
        "tableRowIndex": None,
        "tableColIndex": None,
        "textRaw": text,
        "textNormalized": text,
        "htmlFragment": None,
        "linkTarget": None,
        "linkText": None,
        "tableHtml": None,
        "tableCells": None,
        "isNavigation": False,
        "isBoilerplate": False,
        "isMainContent": True,
        "isRepeatedCandidate": False,
        "mainContentScore": 1.0,
        "titleCandidateScore": 1.0 if block_role == "title" else 0.0,
        "sectionHint": None,
        "classificationConfidence": 0.99,
        "classificationReason": "test",
        "parentHeadingHint": None,
    }


def _page_manifest_payload(
    *,
    site_id: str,
    raw_asset_id: str,
    raw_version_id: str,
    normalized_canonical_url: str,
    page_family: str,
    page_title: str,
) -> dict[str, object]:
    return {
        "schemaVersion": "official_web_page_manifest.v1",
        "sourceChannel": "official_web",
        "siteId": site_id,
        "host": "www.example.edu",
        "rawAssetId": raw_asset_id,
        "rawVersionId": raw_version_id,
        "requestedUrl": normalized_canonical_url,
        "finalUrl": normalized_canonical_url,
        "declaredCanonicalUrl": normalized_canonical_url,
        "normalizedCanonicalUrl": normalized_canonical_url,
        "urlIdentityBasis": "declared_canonical",
        "fetchedAt": "2026-03-31T09:00:00.000Z",
        "httpStatus": 200,
        "contentType": "text/html",
        "etag": None,
        "lastModified": None,
        "redirectChain": [],
        "responseBodyHash": f"hash-{raw_asset_id}",
        "retainedSnapshotHash": f"snapshot-{raw_asset_id}",
        "fetcherName": "collector-test",
        "fetcherVersion": "1.0",
        "parserName": "cheerio-basic",
        "parserVersion": "1.0",
        "pageTitleRaw": page_title,
        "pageTitleNormalized": page_title,
        "languageHint": "zh-CN",
        "pageFamily": page_family,
        "pageFamilyConfidence": 0.99,
        "pageFamilyReason": "test-fixture",
        "mainContentHash": f"main-{raw_asset_id}",
        "blockCount": 2,
        "mainContentBlockCount": 2,
        "navigationBlockCount": 0,
        "boilerplateBlockCount": 0,
        "discoveredFromUrl": None,
        "discoveryMethod": "seed",
        "crawlRunId": "owrun_projection_001",
        "hostPolicyVersion": "campus_public_hosts_v1",
        "crawlPolicyVersion": "campus_public_crawl_policy_v1",
        "credentialsMode": "public",
    }


def _bundle_payload(
    *,
    site_id: str = "campus_public",
    run_id: str = "owrun_projection_001",
    raw_asset_id: str = "owasset_article_001",
    raw_version_id: str = "owver_article_001",
    normalized_canonical_url: str = "https://www.example.edu/news/1",
) -> dict[str, object]:
    return {
        "schemaVersion": "official_web_source_truth_bundle.v1",
        "sourceChannel": "official_web",
        "siteId": site_id,
        "crawlRunId": run_id,
        "generatedAt": "2026-03-31T09:00:00.000Z",
        "pages": [
            {
                "rawAssetId": raw_asset_id,
                "rawVersionId": raw_version_id,
                "normalizedCanonicalUrl": normalized_canonical_url,
                "pageFamily": "article_detail",
                "pageManifestObjectKey": f"official_web/{raw_asset_id}/undated/{raw_version_id}/source-truth/page-manifest.json",
                "contentBlocksObjectKey": f"official_web/{raw_asset_id}/undated/{raw_version_id}/source-truth/content-blocks.jsonl",
                "providerExtractionObjectKey": f"official_web/{raw_asset_id}/undated/{raw_version_id}/provider/cheerio-basic/page-extraction.json",
                "discoveredLinksObjectKey": f"official_web/{raw_asset_id}/undated/{raw_version_id}/provider/cheerio-basic/discovered-links.jsonl",
                "responseHtmlObjectKey": f"official_web/{raw_asset_id}/undated/{raw_version_id}/capture/response.html",
                "responseBodyHash": f"hash-{raw_asset_id}",
                "blockCount": 2,
            }
        ],
    }


def _handoff_record(
    *,
    event_id: str,
    run_id: str,
    site_id: str,
    artifacts: list[dict[str, object]] | None = None,
    host_set: list[str] | None = None,
    seed_set: list[str] | None = None,
    pages_normalized: int = 1,
) -> dict[str, object]:
    return {
        "schemaVersion": "official_web_handoff_dispatch.v1",
        "dispatchRef": "owdispatch_test_01",
        "eventId": event_id,
        "receivedAt": "2026-04-01T16:59:56.929507+00:00",
        "payload": {
            "artifacts": artifacts or [],
            "collectorVersion": "official-web-collector@0.1.0",
            "configVersion": "campus_public.v1",
            "crawlPolicyVersion": "campus_public_crawl_policy_v1",
            "eventId": event_id,
            "eventType": "official_web.run.completed",
            "finishedAt": "2026-03-31T09:17:32.000Z",
            "hostSet": host_set or ["www.example.edu"],
            "pageChanges": [],
            "pageChangeSummary": {
                "newPages": 1,
                "changedPages": 0,
                "deletedPages": 0,
                "failedFetchPages": 0,
                "notModifiedPages": 0,
            },
            "runId": run_id,
            "runIntent": "baseline",
            "schedulerRunKey": "manual-2026-03-31T09:00:00.000Z",
            "seedSet": seed_set or ["https://www.example.edu/"],
            "siteId": site_id,
            "sourceChannel": "official_web",
            "startedAt": "2026-03-31T09:00:01.000Z",
            "status": "completed",
            "summary": {
                "failureCount": 0,
                "pagesNormalized": pages_normalized,
            },
            "triggerType": "manual",
        },
    }


class FakeReplayObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self._objects = dict(objects)
        self.requests: list[tuple[str, str]] = []
        self.put_requests: list[tuple[str, str]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        self.requests.append((bucket, key))
        try:
            return self._objects[(bucket, key)]
        except KeyError as exc:
            raise FileNotFoundError(f"missing object: {bucket}/{key}") from exc

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.put_requests.append((bucket, key))
        self._objects[(bucket, key)] = data


class FakeExecutionStatusReporter:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def report(self, *, run_id: str, payload: dict[str, object]) -> None:
        self.calls.append({"run_id": run_id, "payload": dict(payload)})


class OfficialWebHandoffConsumerTest(unittest.TestCase):
    def test_consume_handoff_record_stages_projection_outputs_without_persisting_registry_by_default(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_success.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            bundle = _bundle_payload()
            manifest_key = bundle["pages"][0]["pageManifestObjectKey"]
            blocks_key = bundle["pages"][0]["contentBlocksObjectKey"]
            provider_key = bundle["pages"][0]["providerExtractionObjectKey"]
            bundle_key = "official_web/campus_public/runs/owrun_projection_001/source-truth-bundle.json"
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_success",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                ),
            )
            object_store = FakeReplayObjectStore(
                {
                    ("campus-rag-source", bundle_key): json.dumps(bundle).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(manifest_key),
                    ): json.dumps(
                        _page_manifest_payload(
                            site_id="campus_public",
                            raw_asset_id="owasset_article_001",
                            raw_version_id="owver_article_001",
                            normalized_canonical_url="https://www.example.edu/news/1",
                            page_family="article_detail",
                            page_title="新闻详情",
                        ),
                        ensure_ascii=False,
                    ).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(blocks_key),
                    ): (
                        json.dumps(
                            _block(
                                raw_asset_id="owasset_article_001",
                                raw_version_id="owver_article_001",
                                row_id="title-1",
                                row_index=0,
                                block_order=0,
                                block_role="title",
                                text="新闻详情",
                            ),
                            ensure_ascii=False,
                        )
                        + "\n"
                        + json.dumps(
                            _block(
                                raw_asset_id="owasset_article_001",
                                raw_version_id="owver_article_001",
                                row_id="p-1",
                                row_index=1,
                                block_order=1,
                                block_role="paragraph",
                                text="中央民族大学召开专题工作会议。",
                            ),
                            ensure_ascii=False,
                        )
                        + "\n"
                    ).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(provider_key),
                    ): json.dumps({"title": "新闻详情"}, ensure_ascii=False).encode("utf-8"),
                }
            )
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()
            reporter = FakeExecutionStatusReporter()

            result = consume_handoff_record(
                record_path=record_path,
                settings=OfficialWebHandoffConsumerSettings(
                    inbox_dir=inbox_dir,
                    execution_root_dir=execution_root_dir,
                    source_bucket="campus-rag-source",
                ),
                object_store=object_store,
                declarations_path=declarations_path,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                derived_object_store=object_store,
                status_reporter=reporter,
            )

            self.assertEqual(result.status, "staged")
            raw_records = raw_asset_registry.list_by_scope("official_web", "muc_public_pages")
            self.assertEqual(len(raw_records), 0)

            documents = document_registry.list_by_scope("official_web", "muc_public_pages")
            self.assertEqual(len(documents), 0)
            self.assertEqual(object_store.put_requests, [])

            self.assertEqual([call["payload"]["status"] for call in reporter.calls], ["running", "staged"])
            execution_report = json.loads(Path(result.execution_report_path or "").read_text(encoding="utf-8"))

    def test_consume_handoff_record_blocks_promote_when_projection_documents_are_audit_only(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_audit_only.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            bundle = _bundle_payload()
            manifest_key = bundle["pages"][0]["pageManifestObjectKey"]
            blocks_key = bundle["pages"][0]["contentBlocksObjectKey"]
            provider_key = bundle["pages"][0]["providerExtractionObjectKey"]
            bundle_key = "official_web/campus_public/runs/owrun_projection_001/source-truth-bundle.json"
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_audit_only",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                ),
            )
            object_store = FakeReplayObjectStore(
                {
                    ("campus-rag-source", bundle_key): json.dumps(bundle).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(manifest_key),
                    ): json.dumps(
                        _page_manifest_payload(
                            site_id="campus_public",
                            raw_asset_id="owasset_article_001",
                            raw_version_id="owver_article_001",
                            normalized_canonical_url="https://www.example.edu/news/1",
                            page_family="article_detail",
                            page_title="新闻详情",
                        ),
                        ensure_ascii=False,
                    ).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(blocks_key),
                    ): (
                        json.dumps(
                            _block(
                                raw_asset_id="owasset_article_001",
                                raw_version_id="owver_article_001",
                                row_id="title-1",
                                row_index=0,
                                block_order=0,
                                block_role="title",
                                text="新闻详情",
                            ),
                            ensure_ascii=False,
                        )
                        + "\n"
                        + json.dumps(
                            _block(
                                raw_asset_id="owasset_article_001",
                                raw_version_id="owver_article_001",
                                row_id="p-1",
                                row_index=1,
                                block_order=1,
                                block_role="paragraph",
                                text="中央民族大学召开专题工作会议。",
                            ),
                            ensure_ascii=False,
                        )
                        + "\n"
                    ).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(provider_key),
                    ): json.dumps({"title": "新闻详情"}, ensure_ascii=False).encode("utf-8"),
                }
            )
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()

            with (
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer.replay_official_web_source_truth_local",
                    return_value=OfficialWebProjectionReplayReport(
                        schema_version="official_web_projection_replay_report.v1",
                        site_id="campus_public",
                        crawl_run_id="owrun_projection_001",
                        output_dir=str(execution_root_dir / "input"),
                        projection_output_dir=str(execution_root_dir / "projection"),
                        generated_at="2026-04-03T00:00:00+00:00",
                        counts={"pages_seen": 1, "emitted_documents": 1, "manual_review_pages": 0},
                        documents=[
                            {
                                "document_id": "official_web:muc_public:article_detail:test-audit-only",
                                "version_id": "owdocver:test-audit-only",
                                "title": "新闻详情",
                                "declaration_id": "article-detail-primary",
                                "page_family": "article_detail",
                                "projection_family": "content_document",
                                "document_kind": "article",
                                "target_corpus": "official_web",
                                "target_collection": "muc_public_pages",
                                "normalized_canonical_url": "https://www.example.edu/news/1",
                                "raw_asset_id": "owasset_article_001",
                                "raw_version_id": "owver_article_001",
                                "unit_count": 1,
                                "canonical_markdown_path": str(root / "placeholder.md"),
                                "document_units_path": str(root / "placeholder.jsonl"),
                                "serving_intent": "audit_only",
                                "promotion_block_reason": "manual_review_pending",
                            }
                        ],
                        manual_review_pages=[],
                    ),
                ),
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer.validate_official_web_projection_output",
                    return_value=OfficialWebProjectionValidationReport(
                        schema_version="official_web_projection_validation_report.v1",
                        valid=True,
                        projection_output_dir=str(execution_root_dir / "projection"),
                        issues=[],
                        counts={"documents": 1, "errors": 0, "warnings": 0},
                    ),
                ),
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer.audit_official_web_projection_chunking",
                    return_value=OfficialWebProjectionChunkingAuditReport(
                        schema_version="official_web_projection_chunking_audit.v1",
                        projection_output_dir=str(execution_root_dir / "projection"),
                        passed=True,
                        document_count=1,
                        total_units=1,
                        total_chunks=1,
                        issue_counts={},
                        documents=(),
                    ),
                ),
            ):
                result = consume_handoff_record(
                    record_path=record_path,
                    settings=OfficialWebHandoffConsumerSettings(
                        inbox_dir=inbox_dir,
                        execution_root_dir=execution_root_dir,
                        source_bucket="campus-rag-source",
                        promote_import=True,
                        minimum_promote_pages=1,
                        minimum_seed_coverage_ratio=0.0,
                        minimum_host_coverage_ratio=0.0,
                    ),
                    object_store=object_store,
                    declarations_path=declarations_path,
                    document_registry=document_registry,
                    raw_asset_registry=raw_asset_registry,
                    derived_object_store=object_store,
                )

            self.assertEqual(result.status, "staged")
            execution_report = json.loads(Path(result.execution_report_path or "").read_text(encoding="utf-8"))
            blocked_codes = {
                item["code"]
                for item in execution_report["promotion"]["blockedChecks"]
            }
            self.assertIn("promotable_documents_present", blocked_codes)
            self.assertEqual(execution_report["status"], "staged")
            self.assertIsNone(execution_report["import"])
            self.assertTrue(execution_report["validation"]["valid"])
            self.assertIsNotNone(execution_report["chunkAudit"])
            self.assertEqual(execution_report["promotion"]["decision"], "blocked")
            self.assertFalse(execution_report["promotion"]["eligible"])

    def test_consume_handoff_record_blocks_promote_when_projection_documents_have_unknown_serving_intent(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_unknown_intent.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            bundle = _bundle_payload()
            manifest_key = bundle["pages"][0]["pageManifestObjectKey"]
            blocks_key = bundle["pages"][0]["contentBlocksObjectKey"]
            provider_key = bundle["pages"][0]["providerExtractionObjectKey"]
            bundle_key = "official_web/campus_public/runs/owrun_projection_001/source-truth-bundle.json"
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_unknown_intent",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                ),
            )
            object_store = FakeReplayObjectStore(
                {
                    ("campus-rag-source", bundle_key): json.dumps(bundle).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(manifest_key),
                    ): json.dumps(
                        _page_manifest_payload(
                            site_id="campus_public",
                            raw_asset_id="owasset_article_001",
                            raw_version_id="owver_article_001",
                            normalized_canonical_url="https://www.example.edu/news/1",
                            page_family="article_detail",
                            page_title="新闻详情",
                        ),
                        ensure_ascii=False,
                    ).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(blocks_key),
                    ): (
                        json.dumps(
                            _block(
                                raw_asset_id="owasset_article_001",
                                raw_version_id="owver_article_001",
                                row_id="title-1",
                                row_index=0,
                                block_order=0,
                                block_role="title",
                                text="新闻详情",
                            ),
                            ensure_ascii=False,
                        )
                        + "\n"
                        + json.dumps(
                            _block(
                                raw_asset_id="owasset_article_001",
                                raw_version_id="owver_article_001",
                                row_id="p-1",
                                row_index=1,
                                block_order=1,
                                block_role="paragraph",
                                text="中央民族大学召开专题工作会议。",
                            ),
                            ensure_ascii=False,
                        )
                        + "\n"
                    ).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(provider_key),
                    ): json.dumps({"title": "新闻详情"}, ensure_ascii=False).encode("utf-8"),
                }
            )
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()

            with (
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer.replay_official_web_source_truth_local",
                    return_value=OfficialWebProjectionReplayReport(
                        schema_version="official_web_projection_replay_report.v1",
                        site_id="campus_public",
                        crawl_run_id="owrun_projection_001",
                        output_dir=str(execution_root_dir / "input"),
                        projection_output_dir=str(execution_root_dir / "projection"),
                        generated_at="2026-04-03T00:00:00+00:00",
                        counts={"pages_seen": 1, "emitted_documents": 1, "manual_review_pages": 0},
                        documents=[
                            {
                                "document_id": "official_web:muc_public:article_detail:test-unknown-intent",
                                "version_id": "owdocver:test-unknown-intent",
                                "title": "新闻详情",
                                "declaration_id": "article-detail-primary",
                                "page_family": "article_detail",
                                "projection_family": "content_document",
                                "document_kind": "article",
                                "target_corpus": "official_web",
                                "target_collection": "muc_public_pages",
                                "normalized_canonical_url": "https://www.example.edu/news/1",
                                "raw_asset_id": "owasset_article_001",
                                "raw_version_id": "owver_article_001",
                                "unit_count": 1,
                                "canonical_markdown_path": str(root / "placeholder.md"),
                                "document_units_path": str(root / "placeholder.jsonl"),
                            }
                        ],
                        manual_review_pages=[],
                    ),
                ),
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer.validate_official_web_projection_output",
                    return_value=OfficialWebProjectionValidationReport(
                        schema_version="official_web_projection_validation_report.v1",
                        valid=True,
                        projection_output_dir=str(execution_root_dir / "projection"),
                        issues=[],
                        counts={"documents": 1, "errors": 0, "warnings": 0},
                    ),
                ),
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer.audit_official_web_projection_chunking",
                    return_value=OfficialWebProjectionChunkingAuditReport(
                        schema_version="official_web_projection_chunking_audit.v1",
                        projection_output_dir=str(execution_root_dir / "projection"),
                        passed=True,
                        document_count=1,
                        total_units=1,
                        total_chunks=1,
                        issue_counts={},
                        documents=(),
                    ),
                ),
            ):
                result = consume_handoff_record(
                    record_path=record_path,
                    settings=OfficialWebHandoffConsumerSettings(
                        inbox_dir=inbox_dir,
                        execution_root_dir=execution_root_dir,
                        source_bucket="campus-rag-source",
                        promote_import=True,
                        minimum_promote_pages=1,
                        minimum_seed_coverage_ratio=0.0,
                        minimum_host_coverage_ratio=0.0,
                    ),
                    object_store=object_store,
                    declarations_path=declarations_path,
                    document_registry=document_registry,
                    raw_asset_registry=raw_asset_registry,
                    derived_object_store=object_store,
                )

            self.assertEqual(result.status, "staged")
            execution_report = json.loads(Path(result.execution_report_path or "").read_text(encoding="utf-8"))
            blocked_codes = {
                item["code"]
                for item in execution_report["promotion"]["blockedChecks"]
            }
            self.assertIn("recognized_serving_intent", blocked_codes)
            self.assertEqual(
                execution_report["coverage"]["documentServingIntentCounts"]["unknown"],
                1,
            )
            self.assertEqual(execution_report["promotion"]["decision"], "blocked")
            self.assertFalse(execution_report["promotion"]["eligible"])

    def test_consume_handoff_record_promotes_when_projection_contains_mixed_promotable_and_audit_only_documents(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_mixed_truth.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            bundle = _bundle_payload()
            manifest_key = bundle["pages"][0]["pageManifestObjectKey"]
            blocks_key = bundle["pages"][0]["contentBlocksObjectKey"]
            provider_key = bundle["pages"][0]["providerExtractionObjectKey"]
            bundle_key = "official_web/campus_public/runs/owrun_projection_001/source-truth-bundle.json"
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_mixed_truth",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                ),
            )
            object_store = FakeReplayObjectStore(
                {
                    ("campus-rag-source", bundle_key): json.dumps(bundle).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(manifest_key),
                    ): json.dumps(
                        _page_manifest_payload(
                            site_id="campus_public",
                            raw_asset_id="owasset_article_001",
                            raw_version_id="owver_article_001",
                            normalized_canonical_url="https://www.example.edu/news/1",
                            page_family="article_detail",
                            page_title="新闻详情",
                        ),
                        ensure_ascii=False,
                    ).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(blocks_key),
                    ): (
                        json.dumps(
                            _block(
                                raw_asset_id="owasset_article_001",
                                raw_version_id="owver_article_001",
                                row_id="title-1",
                                row_index=0,
                                block_order=0,
                                block_role="title",
                                text="新闻详情",
                            ),
                            ensure_ascii=False,
                        )
                        + "\n"
                        + json.dumps(
                            _block(
                                raw_asset_id="owasset_article_001",
                                raw_version_id="owver_article_001",
                                row_id="p-1",
                                row_index=1,
                                block_order=1,
                                block_role="paragraph",
                                text="中央民族大学召开专题工作会议。",
                            ),
                            ensure_ascii=False,
                        )
                        + "\n"
                    ).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(provider_key),
                    ): json.dumps({"title": "新闻详情"}, ensure_ascii=False).encode("utf-8"),
                }
            )

            with (
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer.replay_official_web_source_truth_local",
                    return_value=OfficialWebProjectionReplayReport(
                        schema_version="official_web_projection_replay_report.v1",
                        site_id="campus_public",
                        crawl_run_id="owrun_projection_001",
                        output_dir=str(execution_root_dir / "input"),
                        projection_output_dir=str(execution_root_dir / "projection"),
                        generated_at="2026-04-03T00:00:00+00:00",
                        counts={"pages_seen": 2, "emitted_documents": 2, "manual_review_pages": 0},
                        documents=[
                            {
                                "document_id": "official_web:muc_public:article_detail:promotable",
                                "version_id": "owdocver:promotable",
                                "title": "新闻详情",
                                "declaration_id": "article-detail-primary",
                                "page_family": "article_detail",
                                "projection_family": "content_document",
                                "document_kind": "article",
                                "target_corpus": "official_web",
                                "target_collection": "muc_public_pages",
                                "normalized_canonical_url": "https://www.example.edu/news/1",
                                "raw_asset_id": "owasset_article_001",
                                "raw_version_id": "owver_article_001",
                                "unit_count": 1,
                                "canonical_markdown_path": str(root / "promotable.md"),
                                "document_units_path": str(root / "promotable.jsonl"),
                                "serving_intent": "promotable",
                                "promotion_block_reason": None,
                            },
                            {
                                "document_id": "official_web:muc_public:listing_page:audit-only",
                                "version_id": "owdocver:audit-only",
                                "title": "新闻网",
                                "declaration_id": "listing-page-primary",
                                "page_family": "listing_page",
                                "projection_family": "content_document",
                                "document_kind": "listing",
                                "target_corpus": "official_web",
                                "target_collection": "muc_public_pages",
                                "normalized_canonical_url": "https://www.example.edu/news/",
                                "raw_asset_id": "owasset_listing_001",
                                "raw_version_id": "owver_listing_001",
                                "unit_count": 1,
                                "canonical_markdown_path": str(root / "audit-only.md"),
                                "document_units_path": str(root / "audit-only.jsonl"),
                                "serving_intent": "audit_only",
                                "promotion_block_reason": "listing_page_audit_only",
                            },
                        ],
                        manual_review_pages=[],
                    ),
                ),
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer.validate_official_web_projection_output",
                    return_value=OfficialWebProjectionValidationReport(
                        schema_version="official_web_projection_validation_report.v1",
                        valid=True,
                        projection_output_dir=str(execution_root_dir / "projection"),
                        issues=[],
                        counts={"documents": 2, "errors": 0, "warnings": 0},
                    ),
                ),
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer.audit_official_web_projection_chunking",
                    return_value=OfficialWebProjectionChunkingAuditReport(
                        schema_version="official_web_projection_chunking_audit.v1",
                        projection_output_dir=str(execution_root_dir / "projection"),
                        passed=True,
                        document_count=2,
                        total_units=2,
                        total_chunks=2,
                        issue_counts={},
                        documents=(),
                    ),
                ),
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer._persist_projection_output",
                    return_value=ImportReport(
                        import_mode="official_web_source_truth_replay",
                        success_count=1,
                        skipped_count=1,
                        failed_count=0,
                        raw_uploaded_count=1,
                        raw_reused_count=0,
                        document_ids=("official_web:muc_public:article_detail:promotable",),
                        unresolved_source_pdfs=(),
                        errors=(),
                        report_path=str(root / "import-report.json"),
                        created_document_ids=("official_web:muc_public:article_detail:promotable",),
                        skipped_document_ids=("official_web:muc_public:listing_page:audit-only",),
                    ),
                ) as persist_projection_output,
            ):
                result = consume_handoff_record(
                    record_path=record_path,
                    settings=OfficialWebHandoffConsumerSettings(
                        inbox_dir=inbox_dir,
                        execution_root_dir=execution_root_dir,
                        source_bucket="campus-rag-source",
                        promote_import=True,
                        minimum_promote_pages=1,
                        minimum_seed_coverage_ratio=0.0,
                        minimum_host_coverage_ratio=0.0,
                    ),
                    object_store=object_store,
                    declarations_path=declarations_path,
                    document_registry=InMemoryDocumentRegistry(),
                    raw_asset_registry=InMemoryRawAssetRegistry(),
                    derived_object_store=object_store,
                )

            self.assertEqual(result.status, "promoted")
            persist_projection_output.assert_called_once()
            execution_report = json.loads(Path(result.execution_report_path or "").read_text(encoding="utf-8"))
            self.assertEqual(execution_report["promotion"]["decision"], "promoted")
            self.assertTrue(execution_report["promotion"]["eligible"])
            self.assertEqual(
                execution_report["coverage"]["documentServingIntentCounts"],
                {"promotable": 1, "audit_only": 1},
            )
            self.assertEqual(execution_report["import"]["success_count"], 1)
            self.assertEqual(execution_report["import"]["skipped_count"], 1)

    def test_consume_handoff_record_promotes_registry_outputs_when_explicitly_enabled(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_success.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            bundle = _bundle_payload()
            manifest_key = bundle["pages"][0]["pageManifestObjectKey"]
            blocks_key = bundle["pages"][0]["contentBlocksObjectKey"]
            provider_key = bundle["pages"][0]["providerExtractionObjectKey"]
            bundle_key = "official_web/campus_public/runs/owrun_projection_001/source-truth-bundle.json"
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_success",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                ),
            )
            object_store = FakeReplayObjectStore(
                {
                    ("campus-rag-source", bundle_key): json.dumps(bundle).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(manifest_key),
                    ): json.dumps(
                        _page_manifest_payload(
                            site_id="campus_public",
                            raw_asset_id="owasset_article_001",
                            raw_version_id="owver_article_001",
                            normalized_canonical_url="https://www.example.edu/news/1",
                            page_family="article_detail",
                            page_title="新闻详情",
                        ),
                        ensure_ascii=False,
                    ).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(blocks_key),
                    ): (
                        json.dumps(
                            _block(
                                raw_asset_id="owasset_article_001",
                                raw_version_id="owver_article_001",
                                row_id="title-1",
                                row_index=0,
                                block_order=0,
                                block_role="title",
                                text="新闻详情",
                            ),
                            ensure_ascii=False,
                        )
                        + "\n"
                        + json.dumps(
                            _block(
                                raw_asset_id="owasset_article_001",
                                raw_version_id="owver_article_001",
                                row_id="p-1",
                                row_index=1,
                                block_order=1,
                                block_role="paragraph",
                                text="中央民族大学召开专题工作会议。",
                            ),
                            ensure_ascii=False,
                        )
                        + "\n"
                    ).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(provider_key),
                    ): json.dumps({"title": "新闻详情"}, ensure_ascii=False).encode("utf-8"),
                }
            )
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()

            result = consume_handoff_record(
                record_path=record_path,
                settings=OfficialWebHandoffConsumerSettings(
                    inbox_dir=inbox_dir,
                    execution_root_dir=execution_root_dir,
                    source_bucket="campus-rag-source",
                    promote_import=True,
                    minimum_promote_pages=1,
                ),
                object_store=object_store,
                derived_object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                declarations_path=declarations_path,
            )

            self.assertIsInstance(result, OfficialWebHandoffConsumeResult)
            self.assertEqual(result.status, "promoted")
            self.assertEqual(result.attempt_count, 1)
            self.assertTrue(Path(result.execution_report_path or "").exists())
            self.assertTrue(Path(result.projection_output_dir or "").exists())
            self.assertTrue(Path(result.replay_input_dir or "").exists())
            self.assertEqual(object_store.requests[0], ("campus-rag-source", bundle_key))

            persisted = json.loads(record_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["processingStatus"], "promoted")
            self.assertEqual(persisted["processingAttemptCount"], 1)
            self.assertIsNone(persisted["lastError"])
            self.assertEqual(persisted["projectionOutputDir"], result.projection_output_dir)
            self.assertEqual(persisted["executionReportPath"], result.execution_report_path)

            execution_report = json.loads(Path(result.execution_report_path or "").read_text(encoding="utf-8"))
            self.assertEqual(execution_report["status"], "promoted")
            self.assertEqual(execution_report["bundleObjectKey"], bundle_key)
            self.assertTrue(execution_report["validation"]["valid"])
            self.assertEqual(execution_report["import"]["success_count"], 1)
            self.assertEqual(execution_report["promotion"]["decision"], "promoted")

            raw_records = raw_asset_registry.list_by_scope("official_web", "muc_public_pages")
            self.assertEqual(len(raw_records), 1)
            self.assertIsInstance(raw_records[0], RawAssetRecord)
            self.assertEqual(
                raw_records[0].object_key,
                "official_web/owasset_article_001/undated/owver_article_001/capture/response.html",
            )

            documents = document_registry.list_by_scope("official_web", "muc_public_pages")
            self.assertEqual(len(documents), 1)
            self.assertIsInstance(documents[0], DocumentRegistryRecord)
            self.assertEqual(documents[0].source_channel, "official_web")
            self.assertTrue(documents[0].is_current)
            self.assertIsNotNone(documents[0].canonical_markdown_object_key)
            self.assertIsNotNone(documents[0].document_units_object_key)

    def test_consume_handoff_record_keeps_low_coverage_batch_staged_when_promote_requested(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_low_coverage.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            bundle = _bundle_payload()
            manifest_key = bundle["pages"][0]["pageManifestObjectKey"]
            blocks_key = bundle["pages"][0]["contentBlocksObjectKey"]
            provider_key = bundle["pages"][0]["providerExtractionObjectKey"]
            bundle_key = "official_web/campus_public/runs/owrun_projection_001/source-truth-bundle.json"
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_low_coverage",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                    host_set=["www.example.edu", "news.example.edu"],
                    seed_set=[
                        "https://www.example.edu/",
                        "https://www.example.edu/news/",
                        "https://news.example.edu/",
                        "https://news.example.edu/list/",
                    ],
                    pages_normalized=1,
                ),
            )
            object_store = FakeReplayObjectStore(
                {
                    ("campus-rag-source", bundle_key): json.dumps(bundle).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(manifest_key),
                    ): json.dumps(
                        _page_manifest_payload(
                            site_id="campus_public",
                            raw_asset_id="owasset_article_001",
                            raw_version_id="owver_article_001",
                            normalized_canonical_url="https://www.example.edu/news/1",
                            page_family="article_detail",
                            page_title="新闻详情",
                        ),
                        ensure_ascii=False,
                    ).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(blocks_key),
                    ): (
                        json.dumps(
                            _block(
                                raw_asset_id="owasset_article_001",
                                raw_version_id="owver_article_001",
                                row_id="title-1",
                                row_index=0,
                                block_order=0,
                                block_role="title",
                                text="新闻详情",
                            ),
                            ensure_ascii=False,
                        )
                        + "\n"
                        + json.dumps(
                            _block(
                                raw_asset_id="owasset_article_001",
                                raw_version_id="owver_article_001",
                                row_id="p-1",
                                row_index=1,
                                block_order=1,
                                block_role="paragraph",
                                text="中央民族大学召开专题工作会议。",
                            ),
                            ensure_ascii=False,
                        )
                        + "\n"
                    ).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(provider_key),
                    ): json.dumps({"title": "新闻详情"}, ensure_ascii=False).encode("utf-8"),
                }
            )
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()
            reporter = FakeExecutionStatusReporter()

            result = consume_handoff_record(
                record_path=record_path,
                settings=OfficialWebHandoffConsumerSettings(
                    inbox_dir=inbox_dir,
                    execution_root_dir=execution_root_dir,
                    source_bucket="campus-rag-source",
                    promote_import=True,
                ),
                object_store=object_store,
                declarations_path=declarations_path,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                derived_object_store=object_store,
                status_reporter=reporter,
            )

            self.assertEqual(result.status, "staged")
            self.assertEqual(tuple(document_registry.list_by_scope("official_web", "muc_public_pages")), ())
            self.assertEqual(tuple(raw_asset_registry.list_by_scope("official_web", "muc_public_pages")), ())
            self.assertEqual([call["payload"]["status"] for call in reporter.calls], ["running", "staged"])
            self.assertEqual(reporter.calls[-1]["payload"]["errorCode"], "promotion_blocked")

            execution_report = json.loads(Path(result.execution_report_path or "").read_text(encoding="utf-8"))
            self.assertEqual(execution_report["status"], "staged")
            self.assertIsNone(execution_report["import"])
            self.assertEqual(execution_report["promotion"]["decision"], "blocked")
            self.assertFalse(execution_report["promotion"]["eligible"])
            blocked_codes = {item["code"] for item in execution_report["promotion"]["blockedChecks"]}
            self.assertIn("minimum_promote_pages", blocked_codes)
            self.assertIn("seed_coverage_ratio", blocked_codes)

    def test_consume_handoff_record_marks_failure_when_bundle_is_missing(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_missing_bundle.json"
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_missing_bundle",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                ),
            )

            result = consume_handoff_record(
                record_path=record_path,
                settings=OfficialWebHandoffConsumerSettings(
                    inbox_dir=inbox_dir,
                    execution_root_dir=execution_root_dir,
                    source_bucket="campus-rag-source",
                ),
                object_store=FakeReplayObjectStore({}),
            )

            self.assertEqual(result.status, "failed")
            self.assertEqual(result.attempt_count, 1)
            self.assertEqual(result.error["code"], "missing_source_truth_bundle")

            persisted = json.loads(record_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["processingStatus"], "failed")
            self.assertEqual(persisted["processingAttemptCount"], 1)
            self.assertEqual(persisted["lastError"]["code"], "missing_source_truth_bundle")
            self.assertTrue(Path(persisted["executionReportPath"]).exists())

    def test_consume_handoff_record_marks_failure_when_page_artifact_is_missing(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_missing_page_artifact.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            bundle = _bundle_payload()
            bundle_key = "official_web/campus_public/runs/owrun_projection_001/source-truth-bundle.json"
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_missing_page_artifact",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                ),
            )

            result = consume_handoff_record(
                record_path=record_path,
                settings=OfficialWebHandoffConsumerSettings(
                    inbox_dir=inbox_dir,
                    execution_root_dir=execution_root_dir,
                    source_bucket="campus-rag-source",
                ),
                object_store=FakeReplayObjectStore(
                    {
                        ("campus-rag-source", bundle_key): json.dumps(bundle).encode("utf-8"),
                    }
                ),
                declarations_path=declarations_path,
            )

            self.assertEqual(result.status, "failed")
            self.assertEqual(result.error["code"], "missing_page_manifest")

            persisted = json.loads(record_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["processingStatus"], "failed")
            self.assertEqual(persisted["lastError"]["code"], "missing_page_manifest")

    def test_consume_handoff_record_skips_when_event_already_staged(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_skip.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            bundle = _bundle_payload()
            manifest_key = bundle["pages"][0]["pageManifestObjectKey"]
            blocks_key = bundle["pages"][0]["contentBlocksObjectKey"]
            provider_key = bundle["pages"][0]["providerExtractionObjectKey"]
            bundle_key = "official_web/campus_public/runs/owrun_projection_001/source-truth-bundle.json"
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_skip",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                ),
            )
            object_store = FakeReplayObjectStore(
                {
                    ("campus-rag-source", bundle_key): json.dumps(bundle).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(manifest_key),
                    ): json.dumps(
                        _page_manifest_payload(
                            site_id="campus_public",
                            raw_asset_id="owasset_article_001",
                            raw_version_id="owver_article_001",
                            normalized_canonical_url="https://www.example.edu/news/1",
                            page_family="article_detail",
                            page_title="新闻详情",
                        ),
                        ensure_ascii=False,
                    ).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(blocks_key),
                    ): (
                        json.dumps(
                            _block(
                                raw_asset_id="owasset_article_001",
                                raw_version_id="owver_article_001",
                                row_id="title-1",
                                row_index=0,
                                block_order=0,
                                block_role="title",
                                text="新闻详情",
                            ),
                            ensure_ascii=False,
                        )
                        + "\n"
                        + json.dumps(
                            _block(
                                raw_asset_id="owasset_article_001",
                                raw_version_id="owver_article_001",
                                row_id="p-1",
                                row_index=1,
                                block_order=1,
                                block_role="paragraph",
                                text="中央民族大学召开专题工作会议。",
                            ),
                            ensure_ascii=False,
                        )
                        + "\n"
                    ).encode("utf-8"),
                    (
                        "campus-rag-source",
                        str(provider_key),
                    ): json.dumps({"title": "新闻详情"}, ensure_ascii=False).encode("utf-8"),
                }
            )
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()

            first = consume_handoff_record(
                record_path=record_path,
                settings=OfficialWebHandoffConsumerSettings(
                    inbox_dir=inbox_dir,
                    execution_root_dir=execution_root_dir,
                    source_bucket="campus-rag-source",
                ),
                object_store=object_store,
                derived_object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                declarations_path=declarations_path,
            )
            request_count = len(object_store.requests)

            second = consume_handoff_record(
                record_path=record_path,
                settings=OfficialWebHandoffConsumerSettings(
                    inbox_dir=inbox_dir,
                    execution_root_dir=execution_root_dir,
                    source_bucket="campus-rag-source",
                ),
                object_store=object_store,
                declarations_path=declarations_path,
            )

            self.assertEqual(first.status, "staged")
            self.assertEqual(second.status, "skipped")
            self.assertEqual(second.attempt_count, 1)
            self.assertEqual(len(object_store.requests), request_count)

            persisted = json.loads(record_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["processingStatus"], "staged")
            self.assertEqual(persisted["processingAttemptCount"], 1)


if __name__ == "__main__":
    unittest.main()
