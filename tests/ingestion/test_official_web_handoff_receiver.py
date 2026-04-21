from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_worker.official_web_handoff_receiver import (
    OfficialWebHandoffReceiverSettings,
    OfficialWebHandoffServerSettings,
    create_app,
    dispatch_http_request,
)


def _handoff_payload(*, event_id: str = "owevt_completed_01HQ") -> dict[str, object]:
    return {
        "artifacts": [
            {
                "artifactType": "crawl_run_manifest",
                "byteSize": None,
                "contentSha256": "abc123",
                "objectKey": "official_web/www_muc_edu_cn/runs/owrun_01HQ/crawl-run.json",
                "recordCount": 1,
            }
        ],
        "collectorVersion": "official-web-collector@0.1.0",
        "configVersion": "git:abc1234",
        "crawlPolicyVersion": "2026-03-29",
        "eventId": event_id,
        "eventType": "official_web.run.completed",
        "finishedAt": "2026-03-29T08:17:32.000Z",
        "hostSet": ["www.muc.edu.cn"],
        "pageChangeSummary": {
            "changedPages": 0,
            "deletedPages": 0,
            "failedFetchPages": 0,
            "newPages": 1,
            "notModifiedPages": 0,
        },
        "pageChanges": [
            {
                "changeStatus": "new",
                "normalizedCanonicalUrl": "https://www.muc.edu.cn/admissions",
                "observedAt": "2026-03-29T08:17:32.000Z",
                "pageFamily": "article_detail",
                "rawAssetId": "raw_01",
                "rawVersionId": "rawv_01",
            }
        ],
        "runId": "owrun_01HQ",
        "runIntent": "baseline",
        "schedulerRunKey": "cron-2026-03-29T08:00:00.000Z",
        "seedSet": ["https://www.muc.edu.cn/"],
        "siteId": "www_muc_edu_cn",
        "sourceChannel": "official_web",
        "startedAt": "2026-03-29T08:00:01.000Z",
        "status": "completed",
        "summary": {
            "failureCount": 0,
            "pagesNormalized": 310,
        },
        "triggerType": "scheduled",
    }


class OfficialWebHandoffReceiverTest(unittest.TestCase):
    def test_handoff_route_returns_401_when_bearer_is_missing(self) -> None:
        with TemporaryDirectory() as temp_dir:
            app = create_app(
                settings=OfficialWebHandoffReceiverSettings(
                    bearer_token="handoff-secret",
                    inbox_dir=Path(temp_dir),
                )
            )

            response = dispatch_http_request(
                app,
                method="POST",
                path="/api/official-web/handoffs",
                headers={"content-type": "application/json"},
                raw_body=json.dumps(_handoff_payload()).encode("utf-8"),
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json_body["error"]["code"], "unauthorized")

    def test_handoff_route_accepts_payload_and_persists_dispatch_record(self) -> None:
        with TemporaryDirectory() as temp_dir:
            inbox_dir = Path(temp_dir) / "official-web-handoffs"
            app = create_app(
                settings=OfficialWebHandoffReceiverSettings(
                    bearer_token="handoff-secret",
                    inbox_dir=inbox_dir,
                )
            )

            response = dispatch_http_request(
                app,
                method="POST",
                path="/api/official-web/handoffs?debug=1",
                headers={
                    "authorization": "Bearer handoff-secret",
                    "content-type": "application/json",
                    "x-official-web-event-id": "owevt_completed_01HQ",
                },
                raw_body=json.dumps(_handoff_payload()).encode("utf-8"),
            )

            self.assertEqual(response.status_code, 202)
            self.assertEqual(response.json_body["status"], "accepted")
            self.assertRegex(response.json_body["dispatchRef"], r"^owdispatch_[a-z0-9]+$")

            dispatch_path = inbox_dir / "owevt_completed_01HQ.json"
            self.assertTrue(dispatch_path.exists())
            persisted = json.loads(dispatch_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["eventId"], "owevt_completed_01HQ")
            self.assertEqual(persisted["dispatchRef"], response.json_body["dispatchRef"])
            self.assertEqual(persisted["payload"]["runId"], "owrun_01HQ")
            self.assertEqual(persisted["payload"]["siteId"], "www_muc_edu_cn")
            self.assertEqual(persisted["processingStatus"], "pending")
            self.assertEqual(persisted["processingAttemptCount"], 0)
            self.assertIsNone(persisted["processedAt"])
            self.assertIsNone(persisted["lastError"])

    def test_handoff_route_is_idempotent_for_same_event_id(self) -> None:
        with TemporaryDirectory() as temp_dir:
            inbox_dir = Path(temp_dir) / "official-web-handoffs"
            app = create_app(
                settings=OfficialWebHandoffReceiverSettings(
                    bearer_token="handoff-secret",
                    inbox_dir=inbox_dir,
                )
            )
            body = json.dumps(_handoff_payload()).encode("utf-8")
            headers = {
                "authorization": "Bearer handoff-secret",
                "content-type": "application/json",
                "x-official-web-event-id": "owevt_completed_01HQ",
            }

            first = dispatch_http_request(
                app,
                method="POST",
                path="/api/official-web/handoffs",
                headers=headers,
                raw_body=body,
            )
            second = dispatch_http_request(
                app,
                method="POST",
                path="/api/official-web/handoffs",
                headers=headers,
                raw_body=body,
            )

            self.assertEqual(first.status_code, 202)
            self.assertEqual(second.status_code, 202)
            self.assertEqual(first.json_body["dispatchRef"], second.json_body["dispatchRef"])
            self.assertEqual(
                sorted(path.name for path in inbox_dir.glob("*.json")),
                ["owevt_completed_01HQ.json"],
            )

    def test_handoff_route_rejects_mismatched_event_id_header_without_persisting(self) -> None:
        with TemporaryDirectory() as temp_dir:
            inbox_dir = Path(temp_dir) / "official-web-handoffs"
            app = create_app(
                settings=OfficialWebHandoffReceiverSettings(
                    bearer_token="handoff-secret",
                    inbox_dir=inbox_dir,
                )
            )

            response = dispatch_http_request(
                app,
                method="POST",
                path="/api/official-web/handoffs",
                headers={
                    "authorization": "Bearer handoff-secret",
                    "content-type": "application/json",
                    "x-official-web-event-id": "owevt_header_mismatch",
                },
                raw_body=json.dumps(_handoff_payload()).encode("utf-8"),
            )

            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json_body["error"]["code"], "idempotency_conflict")
            self.assertEqual(list(inbox_dir.glob("*.json")), [])

    def test_invalid_json_returns_400_before_app_handler(self) -> None:
        with TemporaryDirectory() as temp_dir:
            app = create_app(
                settings=OfficialWebHandoffReceiverSettings(
                    bearer_token="handoff-secret",
                    inbox_dir=Path(temp_dir),
                )
            )

            response = dispatch_http_request(
                app,
                method="POST",
                path="/api/official-web/handoffs",
                headers={"authorization": "Bearer handoff-secret"},
                raw_body=b"{not-json",
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_json")

    def test_readyz_reports_handoff_receiver_configuration(self) -> None:
        with TemporaryDirectory() as temp_dir:
            app = create_app(
                settings=OfficialWebHandoffReceiverSettings(
                    bearer_token="handoff-secret",
                    inbox_dir=Path(temp_dir) / "inbox",
                )
            )

            response = dispatch_http_request(
                app,
                method="GET",
                path="/readyz",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body["status"], "ready")
        self.assertEqual(
            response.json_body["dependencies"]["officialWebHandoffToken"], "configured"
        )
        self.assertEqual(response.json_body["dependencies"]["officialWebInbox"], "configured")

    def test_server_settings_read_host_and_port_from_env(self) -> None:
        env = os.environ | {
            "INGESTION_WORKER_HTTP_HOST": "0.0.0.0",
            "INGESTION_WORKER_HTTP_PORT": "8789",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = OfficialWebHandoffServerSettings.from_env()

        self.assertEqual(settings.host, "0.0.0.0")
        self.assertEqual(settings.port, 8789)


if __name__ == "__main__":
    unittest.main()
