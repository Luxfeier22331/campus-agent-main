from __future__ import annotations

import json
import unittest

from campus_ingestion_core.historical_regulation_denominator_body_text_admission import (
    build_historical_regulation_body_text_owner_admission,
)


class HistoricalRegulationDenominatorBodyTextAdmissionTest(unittest.TestCase):
    def test_builds_owner_text_refs_from_normalized_notice_body_without_release_lane(
        self,
    ) -> None:
        object_store = _FakeObjectStore()

        result = build_historical_regulation_body_text_owner_admission(
            ready_candidates={
                "records": [
                    {
                        "source_notice_id": "354006",
                        "title": "中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则",
                        "target_collection": "scoped_rules",
                        "status": "ready_for_canonical_chunk_v9",
                    },
                    {
                        "source_notice_id": "187233",
                        "title": "关于修订《中央民族大学采购工作管理办法》的通知",
                        "target_collection": "",
                        "status": "needs_owner_text_recovery",
                    },
                ],
            },
            normalized_notice_bundle=[
                _normalized_notice(
                    notice_id="354006",
                    title="中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则",
                    organization_name="中华民族共同体学院",
                    release_time="2025-12-16 11:19",
                    html=(
                        "<p>根据《关于开展2026年“英才计划”硕博连读研究生招生工作的通知》，"
                        "本院制定本实施细则。</p>"
                        "<p><strong>一、招生专业</strong></p>"
                        "<p>我院中华民族共同体学专业招收硕博连读研究生。</p>"
                    ),
                ),
                _normalized_notice(
                    notice_id="187233",
                    title="关于修订《中央民族大学采购工作管理办法》的通知",
                    organization_name="采购与招标管理中心",
                    release_time="2021-03-02 10:00",
                    html="<p>该通知不应进入本次 ready admission。</p>",
                ),
            ],
            object_store=object_store,
            generated_at="2026-05-02T00:00:00+00:00",
        )

        self.assertEqual(result["schema_version"], "historical_regulation_body_text_admission.v1")
        self.assertEqual(result["selected_notice_ids"], ["354006"])
        self.assertFalse(result["serving_closed_assertion"]["embedding_opened"])
        self.assertFalse(result["candidate_store_noop_assertion"]["candidate_store_mutated"])
        admission = result["admission_manifest"]
        candidate_audit = result["candidate_audit"]
        self.assertEqual(admission["counts"]["downstream_admitted"], 1)
        entry = admission["entries"][0]
        self.assertEqual(entry["source_notice_id"], "354006")
        self.assertEqual(entry["target_collection"], "scoped_rules")
        self.assertEqual(entry["owner_text_status"], "ready")
        self.assertEqual(entry["document_nature"], "annual_cycle_rule")
        self.assertEqual(entry["cycle_year"], "2026")
        self.assertEqual(entry["school_unit_name"], "中华民族共同体学院")
        self.assertEqual(candidate_audit["candidate_count"], 1)
        self.assertEqual(
            candidate_audit["candidates"][0]["regulation_admission_class"],
            "scoped_rules_candidate",
        )

        ref = entry["owner_text_recovery"]["written_refs"]["searchable_merge_input"]
        self.assertEqual(ref["bucket"], "campus-rag-source")
        self.assertRegex(
            ref["key"],
            r"^authenticated_notice_portal/notice-354006/2025/"
            r"run14-policy-regulation-expanded/notice-354006/source-truth/"
            r"searchable-merge-input\.json$",
        )
        payload = json.loads(
            object_store.get_bytes(bucket=ref["bucket"], key=ref["key"]).decode("utf-8")
        )
        self.assertTrue(payload["owner_text_ready"])
        self.assertIn("一、招生专业", payload["owner_text"])
        self.assertNotIn("<p>", payload["owner_text"])
        self.assertNotIn("187233", json.dumps(admission, ensure_ascii=False))

    def test_fails_closed_when_ready_notice_body_is_empty(self) -> None:
        with self.assertRaisesRegex(ValueError, "owner text body is empty"):
            build_historical_regulation_body_text_owner_admission(
                ready_candidates={
                    "records": [
                        {
                            "source_notice_id": "354006",
                            "title": "中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则",
                            "target_collection": "scoped_rules",
                            "status": "ready_for_canonical_chunk_v9",
                        }
                    ]
                },
                normalized_notice_bundle=[
                    _normalized_notice(
                        notice_id="354006",
                        title="中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则",
                        organization_name="中华民族共同体学院",
                        release_time="2025-12-16 11:19",
                        html="",
                    )
                ],
                object_store=_FakeObjectStore(),
            )


def _normalized_notice(
    *,
    notice_id: str,
    title: str,
    organization_name: str,
    release_time: str,
    html: str,
) -> dict[str, object]:
    return {
        "notice_id": int(notice_id),
        "notice": {
            "notice_id": int(notice_id),
            "notice_title": title,
            "organization_name": organization_name,
            "notice_release_time": release_time,
            "notice_content": html,
            "notice_link": None,
        },
        "links": [],
        "notice_attachments": [],
        "attachments": [],
    }


class _FakeObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.puts: list[tuple[str, str, bytes, str]] = []

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data
        self.puts.append((bucket, key, data, content_type))

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]


if __name__ == "__main__":
    unittest.main()
