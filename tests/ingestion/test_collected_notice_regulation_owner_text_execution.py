from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_ingestion_core.collected_notice_regulation_owner_text_execution import (
    PHASE_06_R1B_ID,
    execute_collected_notice_regulation_owner_text_attempts,
)
from campus_ingestion_core.raw_ingestion_online_ocr import OnlineOcrProviderResult


def _provider_response_bytes(text: str) -> bytes:
    return (
        json.dumps(
            {
                "result": {
                    "layoutParsingResults": [
                        {"markdown": {"text": line}} for line in text.splitlines() if line.strip()
                    ]
                }
            },
            ensure_ascii=False,
        )
        + "\n"
    ).encode("utf-8")


def _attempt(*, notice_id: str = "620") -> dict[str, object]:
    prefix = f"authenticated_notice_portal/file-release-{notice_id}/2024/sha256-test"
    return {
        "attempt_id": f"notice-mm:{notice_id}:owner-text:attempt:1",
        "candidate_id": f"notice-mm:{notice_id}",
        "source_notice_id": notice_id,
        "source_surface": "file_release",
        "searchable_unit_id": f"searchable:file_release:muc_internal_portal:{notice_id}",
        "source_document_id": f"file-release:muc_internal_portal:{notice_id}",
        "title": "中央民族大学测试管理办法",
        "regulation_title_normalized": "中央民族大学测试管理办法",
        "candidate_key": f"regulation-candidate:institutional_rules:{notice_id}",
        "target_collection": "institutional_rules",
        "media_ref_id": f"file_release:{notice_id}",
        "media_kind": "pdf",
        "processing_family": "internal_notice_multimodal",
        "priority": "high",
        "state": "planned",
        "action": "recover_regulation_owner_text",
        "source_object_ref": {
            "bucket": "campus-rag-source",
            "key": f"{prefix}/capture/source.pdf",
            "role": "released_file",
            "mime_type": "application/pdf",
            "sha256": "sha256-test",
        },
        "normalized_output_refs": {
            "provider_response": {
                "bucket": "campus-rag-source",
                "key": f"{prefix}/provider/notice-multimodal-v1/provider-response.jsonl",
                "role": "provider_response",
            },
            "plain_text": {
                "bucket": "campus-rag-source",
                "key": f"{prefix}/source-truth/visual-text.jsonl",
                "role": "plain_text",
            },
            "layout_elements": {
                "bucket": "campus-rag-source",
                "key": f"{prefix}/source-truth/layout-elements.jsonl",
                "role": "layout_elements",
            },
            "searchable_merge_input": {
                "bucket": "campus-rag-source",
                "key": f"{prefix}/source-truth/searchable-merge-input.json",
                "role": "searchable_merge_input",
            },
        },
    }


class CollectedNoticeRegulationOwnerTextExecutionTests(unittest.TestCase):
    def test_execute_attempt_writes_owner_text_outputs_and_report(self) -> None:
        attempt = _attempt()
        object_store = _FakeObjectStore(
            {
                (
                    "campus-rag-source",
                    attempt["source_object_ref"]["key"],  # type: ignore[index]
                ): b"%PDF fake bytes"
            }
        )
        ocr_client = _FakeOcrClient(
            _provider_response_bytes(
                "第一条 为规范学校测试管理工作，制定本办法。\n第二条 本办法适用于中央民族大学。"
            )
        )

        report = execute_collected_notice_regulation_owner_text_attempts(
            attempt_plan={"attempts": [attempt]},
            object_store=object_store,
            online_ocr_clients={"mineru_api": ocr_client},
            execute=True,
            generated_at="2026-04-29T00:00:00+00:00",
        )

        self.assertEqual(report["phase"], PHASE_06_R1B_ID)
        self.assertTrue(report["write_enabled"])
        self.assertTrue(report["provider_calls_enabled"])
        self.assertEqual(report["counts"]["succeeded_count"], 1)
        self.assertEqual(report["counts"]["failed_count"], 0)
        result = report["attempt_results"][0]
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["provider"], "mineru_api")
        self.assertEqual(result["owner_text_status"], "ready")
        self.assertGreater(result["owner_text_length"], 20)
        self.assertEqual(ocr_client.calls[0].name, "source.pdf")
        closeout = report["media_extraction_closeout_result_manifest"]
        self.assertEqual(
            closeout["schema_version"], "notice_media_extraction_closeout_result_manifest.v1"
        )
        self.assertEqual(closeout["results"][0]["candidate_id"], attempt["candidate_id"])
        self.assertEqual(closeout["results"][0]["status"], "completed")

        writes = object_store.writes_by_key()
        provider_key = attempt["normalized_output_refs"]["provider_response"]["key"]  # type: ignore[index]
        owner_text_key = attempt["normalized_output_refs"]["plain_text"]["key"]  # type: ignore[index]
        layout_key = attempt["normalized_output_refs"]["layout_elements"]["key"]  # type: ignore[index]
        merge_key = attempt["normalized_output_refs"]["searchable_merge_input"]["key"]  # type: ignore[index]
        self.assertIn(provider_key, writes)
        self.assertIn(owner_text_key, writes)
        self.assertIn(layout_key, writes)
        self.assertIn(merge_key, writes)
        owner_row = json.loads(writes[owner_text_key].decode("utf-8").splitlines()[0])
        self.assertEqual(owner_row["schema_version"], "regulation_owner_text_v1")
        self.assertIn("第一条", owner_row["text"])
        merge_payload = json.loads(writes[merge_key].decode("utf-8"))
        self.assertTrue(merge_payload["owner_text_ready"])
        self.assertEqual(merge_payload["candidate_id"], "notice-mm:620")

    def test_dry_run_does_not_call_provider_or_write_objects(self) -> None:
        attempt = _attempt()
        object_store = _FakeObjectStore({})
        ocr_client = _FakeOcrClient(_provider_response_bytes("第一条 文本。"))

        report = execute_collected_notice_regulation_owner_text_attempts(
            attempt_plan={"attempts": [attempt]},
            object_store=object_store,
            online_ocr_clients={"mineru_api": ocr_client},
            execute=False,
            generated_at="2026-04-29T00:00:00+00:00",
        )

        self.assertFalse(report["write_enabled"])
        self.assertFalse(report["provider_calls_enabled"])
        self.assertEqual(report["counts"]["planned_count"], 1)
        self.assertEqual(report["counts"]["succeeded_count"], 0)
        self.assertEqual(ocr_client.calls, [])
        self.assertEqual(object_store.writes, [])

    def test_execute_records_failed_attempt_without_writing_success_outputs(self) -> None:
        attempt = _attempt(notice_id="621")
        object_store = _FakeObjectStore(
            {
                (
                    "campus-rag-source",
                    attempt["source_object_ref"]["key"],  # type: ignore[index]
                ): b"%PDF fake bytes"
            }
        )

        report = execute_collected_notice_regulation_owner_text_attempts(
            attempt_plan={"attempts": [attempt]},
            object_store=object_store,
            online_ocr_clients={"mineru_api": _FailingOcrClient(RuntimeError("provider down"))},
            execute=True,
            generated_at="2026-04-29T00:00:00+00:00",
        )

        self.assertEqual(report["counts"]["succeeded_count"], 0)
        self.assertEqual(report["counts"]["failed_count"], 1)
        result = report["attempt_results"][0]
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error_type"], "RuntimeError")
        self.assertIn("provider down", result["error"])
        self.assertEqual(object_store.writes, [])


class _FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self.objects = objects
        self.writes: list[tuple[str, str, bytes, str]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.writes.append((bucket, key, data, content_type))

    def writes_by_key(self) -> dict[str, bytes]:
        return {key: data for _, key, data, _ in self.writes}


class _FakeOcrClient:
    def __init__(self, provider_response_bytes: bytes) -> None:
        self.provider_response_bytes = provider_response_bytes
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=self.provider_response_bytes,
            metadata={"provider": "mineru_api", "state": "done"},
        )

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=self.provider_response_bytes,
            metadata={"provider": "mineru_api", "state": "done"},
        )


class _FailingOcrClient:
    def __init__(self, exc: Exception) -> None:
        self.exc = exc

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        raise self.exc

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        raise self.exc


if __name__ == "__main__":
    unittest.main()
