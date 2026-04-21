from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_worker.official_web_historical_backfill import (
    OfficialWebHistoricalBackfillSettings,
    backfill_historical_handoff_record,
    inventory_historical_handoff_record,
)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_text(path: Path, payload: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(payload, encoding="utf-8")


def _handoff_record(
    *, event_id: str, run_id: str, site_id: str, scheduler_run_key: str
) -> dict[str, object]:
    return {
        "schemaVersion": "official_web_handoff_dispatch.v1",
        "dispatchRef": "owdispatch_test_01",
        "eventId": event_id,
        "receivedAt": "2026-04-01T16:59:56.929507+00:00",
        "payload": {
            "artifacts": [],
            "collectorVersion": "official-web-collector@0.1.0",
            "configVersion": "muc_public.v1",
            "crawlPolicyVersion": "muc_public_crawl_policy_v1",
            "eventId": event_id,
            "eventType": "official_web.run.completed",
            "finishedAt": "2026-04-01T13:04:44.730Z",
            "hostSet": ["news.muc.edu.cn"],
            "pageChanges": [
                {
                    "changeStatus": "changed",
                    "normalizedCanonicalUrl": "https://news.muc.edu.cn/",
                    "observedAt": "2026-04-01T13:04:38.088Z",
                    "pageFamily": "generic_content_page",
                    "rawAssetId": "owasset_2dba630bed6e86ebf7aadd14",
                    "rawVersionId": "owver_33e64dacedd143f278947cd6",
                }
            ],
            "pageChangeSummary": {
                "changedPages": 1,
                "deletedPages": 0,
                "failedFetchPages": 0,
                "newPages": 0,
                "notModifiedPages": 0,
            },
            "runId": run_id,
            "runIntent": "baseline",
            "schedulerRunKey": scheduler_run_key,
            "seedSet": ["https://news.muc.edu.cn/"],
            "siteId": site_id,
            "sourceChannel": "official_web",
            "startedAt": "2026-04-01T13:04:33.011Z",
            "status": "completed",
            "summary": {
                "failureCount": 0,
                "pagesNormalized": 1,
            },
            "triggerType": "manual",
        },
        "processingStatus": "failed",
        "processingAttemptCount": 1,
        "processingStartedAt": "2026-04-01T19:37:20.777252+00:00",
        "processedAt": "2026-04-01T19:37:20.879611+00:00",
        "lastError": {
            "code": "missing_source_truth_bundle",
            "message": "required object not found",
            "occurredAt": "2026-04-01T19:37:20.879263+00:00",
        },
        "executionReportPath": None,
        "projectionOutputDir": None,
        "replayInputDir": None,
    }


def _local_output_payload(
    *, site_id: str, run_id: str
) -> tuple[dict[str, object], dict[str, object]]:
    bundle = {
        "schemaVersion": "official_web_source_truth_bundle.v1",
        "sourceChannel": "official_web",
        "generatedAt": "2026-04-01T13:04:44.730Z",
        "siteId": site_id,
        "crawlRunId": run_id,
        "pages": [
            {
                "rawAssetId": "owasset_2dba630bed6e86ebf7aadd14",
                "rawVersionId": "owver_33e64dacedd143f278947cd6",
                "normalizedCanonicalUrl": "https://news.muc.edu.cn/",
                "pageFamily": "generic_content_page",
                "pageManifestObjectKey": "official_web/owasset_2dba630bed6e86ebf7aadd14/undated/owver_33e64dacedd143f278947cd6/source-truth/page-manifest.json",
                "contentBlocksObjectKey": "official_web/owasset_2dba630bed6e86ebf7aadd14/undated/owver_33e64dacedd143f278947cd6/source-truth/content-blocks.jsonl",
                "providerExtractionObjectKey": "official_web/owasset_2dba630bed6e86ebf7aadd14/undated/owver_33e64dacedd143f278947cd6/provider/cheerio-basic/page-extraction.json",
                "discoveredLinksObjectKey": "official_web/owasset_2dba630bed6e86ebf7aadd14/undated/owver_33e64dacedd143f278947cd6/provider/cheerio-basic/discovered-links.jsonl",
                "responseHtmlObjectKey": "official_web/owasset_2dba630bed6e86ebf7aadd14/undated/owver_33e64dacedd143f278947cd6/capture/response.html",
                "responseBodyHash": "837353390e50576f8ba082af2ab12cd71fb6eee914424e59efddb03cfd01bede",
                "blockCount": 2,
            }
        ],
    }
    manifest = {
        "schemaVersion": "official_web_page_manifest.v1",
        "sourceChannel": "official_web",
        "siteId": site_id,
        "host": "news.muc.edu.cn",
        "rawAssetId": "owasset_2dba630bed6e86ebf7aadd14",
        "rawVersionId": "owver_33e64dacedd143f278947cd6",
        "requestedUrl": "https://news.muc.edu.cn/",
        "finalUrl": "https://news.muc.edu.cn/",
        "declaredCanonicalUrl": "https://news.muc.edu.cn/",
        "normalizedCanonicalUrl": "https://news.muc.edu.cn/",
        "urlIdentityBasis": "declared_canonical",
        "fetchedAt": "2026-04-01T13:04:38.088Z",
        "httpStatus": 200,
        "contentType": "text/html",
        "etag": None,
        "lastModified": None,
        "redirectChain": [],
        "responseBodyHash": "837353390e50576f8ba082af2ab12cd71fb6eee914424e59efddb03cfd01bede",
        "retainedSnapshotHash": "snapshot-001",
        "fetcherName": "collector-test",
        "fetcherVersion": "1.0",
        "parserName": "cheerio-basic",
        "parserVersion": "1.0",
        "pageTitleRaw": "中央民族大学新闻网",
        "pageTitleNormalized": "中央民族大学新闻网",
        "languageHint": "zh-CN",
        "pageFamily": "generic_content_page",
        "pageFamilyConfidence": 0.99,
        "pageFamilyReason": "test-fixture",
        "mainContentHash": "main-001",
        "blockCount": 2,
        "mainContentBlockCount": 2,
        "navigationBlockCount": 0,
        "boilerplateBlockCount": 0,
        "discoveredFromUrl": None,
        "discoveryMethod": "seed",
        "crawlRunId": run_id,
        "hostPolicyVersion": "muc_public_hosts_v1",
        "crawlPolicyVersion": "muc_public_crawl_policy_v1",
        "credentialsMode": "public",
    }
    return bundle, manifest


class FakeBackfillObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = dict(objects or {})
        self.put_requests: list[tuple[str, str]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        try:
            return self.objects[(bucket, key)]
        except KeyError as exc:
            raise FileNotFoundError(f"missing object: {bucket}/{key}") from exc

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.put_requests.append((bucket, key))
        self.objects[(bucket, key)] = data


class OfficialWebHistoricalBackfillTest(unittest.TestCase):
    def test_inventory_marks_missing_bucket_artifacts_as_recoverable_when_local_output_exists(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            record_path = inbox_dir / "owevt_completed_history.json"
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_history",
                    run_id="owrun_history_001",
                    site_id="muc_public",
                    scheduler_run_key="history-001",
                ),
            )
            local_output_dir = root / "official-web-history-001"
            bundle, manifest = _local_output_payload(
                site_id="muc_public", run_id="owrun_history_001"
            )
            _write_json(local_output_dir / "crawl-run.json", {"crawlRunId": "owrun_history_001"})
            _write_json(local_output_dir / "source-truth-bundle.json", bundle)
            _write_json(
                local_output_dir
                / "source-assets"
                / "owasset_2dba630bed6e86ebf7aadd14"
                / "owver_33e64dacedd143f278947cd6"
                / "source-truth"
                / "page-manifest.json",
                manifest,
            )
            _write_text(
                local_output_dir
                / "source-assets"
                / "owasset_2dba630bed6e86ebf7aadd14"
                / "owver_33e64dacedd143f278947cd6"
                / "source-truth"
                / "content-blocks.jsonl",
                "{}\n",
            )

            result = inventory_historical_handoff_record(
                record_path=record_path,
                settings=OfficialWebHistoricalBackfillSettings(
                    local_output_dirs=(local_output_dir,),
                    source_bucket="campus-rag-source",
                ),
                object_store=FakeBackfillObjectStore(),
            )

            self.assertEqual(result.inventory_status, "recoverable_local_output")
            self.assertEqual(result.run_id, "owrun_history_001")
            self.assertEqual(Path(result.local_output_dir or ""), local_output_dir)
            self.assertIn(
                "official_web/muc_public/runs/owrun_history_001/source-truth-bundle.json",
                result.missing_object_keys,
            )

    def test_backfill_uploads_run_and_source_assets_and_updates_record_artifacts(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            record_path = inbox_dir / "owevt_completed_history.json"
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_history",
                    run_id="owrun_history_001",
                    site_id="muc_public",
                    scheduler_run_key="history-001",
                ),
            )
            local_output_dir = root / "official-web-history-001"
            bundle, manifest = _local_output_payload(
                site_id="muc_public", run_id="owrun_history_001"
            )
            _write_json(local_output_dir / "crawl-run.json", {"crawlRunId": "owrun_history_001"})
            _write_json(local_output_dir / "host-summary.json", {"hosts": []})
            _write_text(local_output_dir / "url-results.jsonl", "{}\n")
            _write_text(local_output_dir / "failures.jsonl", "")
            _write_json(local_output_dir / "source-truth-bundle.json", bundle)
            _write_json(local_output_dir / "quality-audit.json", {"pages": []})
            _write_text(local_output_dir / "page-observations.jsonl", "{}\n")
            source_asset_dir = (
                local_output_dir
                / "source-assets"
                / "owasset_2dba630bed6e86ebf7aadd14"
                / "owver_33e64dacedd143f278947cd6"
            )
            _write_text(source_asset_dir / "capture" / "response.html", "<html>ok</html>")
            _write_json(
                source_asset_dir / "capture" / "response-headers.json",
                {"content-type": "text/html"},
            )
            _write_json(
                source_asset_dir / "capture" / "fetch-metadata.json",
                {"requestedUrl": "https://news.muc.edu.cn/"},
            )
            _write_json(
                source_asset_dir / "provider" / "cheerio-basic" / "page-extraction.json",
                {"title": "中央民族大学新闻网"},
            )
            _write_text(
                source_asset_dir / "provider" / "cheerio-basic" / "discovered-links.jsonl", "{}\n"
            )
            _write_json(source_asset_dir / "source-truth" / "page-manifest.json", manifest)
            _write_text(source_asset_dir / "source-truth" / "content-blocks.jsonl", "{}\n")

            object_store = FakeBackfillObjectStore()
            result = backfill_historical_handoff_record(
                record_path=record_path,
                settings=OfficialWebHistoricalBackfillSettings(
                    local_output_dirs=(local_output_dir,),
                    source_bucket="campus-rag-source",
                ),
                object_store=object_store,
            )

            self.assertEqual(result.backfill_status, "uploaded")
            self.assertIn(
                (
                    "campus-rag-source",
                    "official_web/muc_public/runs/owrun_history_001/source-truth-bundle.json",
                ),
                object_store.put_requests,
            )
            self.assertIn(
                (
                    "campus-rag-source",
                    "official_web/owasset_2dba630bed6e86ebf7aadd14/undated/owver_33e64dacedd143f278947cd6/source-truth/page-manifest.json",
                ),
                object_store.put_requests,
            )

            persisted = json.loads(record_path.read_text(encoding="utf-8"))
            artifact_types = {
                artifact["artifactType"] for artifact in persisted["payload"]["artifacts"]
            }
            self.assertIn("source_truth_bundle", artifact_types)
            self.assertIn("page_observations", artifact_types)
