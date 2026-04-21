from __future__ import annotations

import json
from pathlib import Path


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


def _bundle_key(*, site_id: str = "campus_public", run_id: str = "owrun_projection_001") -> str:
    return f"official_web/{site_id}/runs/{run_id}/source-truth-bundle.json"


def _standard_bundle_objects(
    *,
    bundle: dict[str, object],
    bucket: str = "campus-rag-source",
    site_id: str = "campus_public",
    page_title: str = "新闻详情",
    paragraph_text: str = "中央民族大学召开专题工作会议。",
) -> dict[tuple[str, str], bytes]:
    page = bundle["pages"][0]
    assert isinstance(page, dict)
    raw_asset_id = str(page["rawAssetId"])
    raw_version_id = str(page["rawVersionId"])
    normalized_canonical_url = str(page["normalizedCanonicalUrl"])
    manifest_key = str(page["pageManifestObjectKey"])
    blocks_key = str(page["contentBlocksObjectKey"])
    provider_key = str(page["providerExtractionObjectKey"])
    return {
        (bucket, _bundle_key(site_id=site_id, run_id=str(bundle["crawlRunId"]))): json.dumps(
            bundle
        ).encode("utf-8"),
        (
            bucket,
            manifest_key,
        ): json.dumps(
            _page_manifest_payload(
                site_id=site_id,
                raw_asset_id=raw_asset_id,
                raw_version_id=raw_version_id,
                normalized_canonical_url=normalized_canonical_url,
                page_family="article_detail",
                page_title=page_title,
            ),
            ensure_ascii=False,
        ).encode("utf-8"),
        (
            bucket,
            blocks_key,
        ): (
            json.dumps(
                _block(
                    raw_asset_id=raw_asset_id,
                    raw_version_id=raw_version_id,
                    row_id="title-1",
                    row_index=0,
                    block_order=0,
                    block_role="title",
                    text=page_title,
                ),
                ensure_ascii=False,
            )
            + "\n"
            + json.dumps(
                _block(
                    raw_asset_id=raw_asset_id,
                    raw_version_id=raw_version_id,
                    row_id="p-1",
                    row_index=1,
                    block_order=1,
                    block_role="paragraph",
                    text=paragraph_text,
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8"),
        (bucket, provider_key): json.dumps({"title": page_title}, ensure_ascii=False).encode(
            "utf-8"
        ),
    }
