from __future__ import annotations

import copy
import json
import unittest

from campus_ingestion_core.collected_notice_regulation_manual_review_admission import (
    PHASE_11_ID,
    build_manual_review_regulation_admission,
)


class CollectedNoticeRegulationManualReviewAdmissionTests(unittest.TestCase):
    def test_explicit_resolution_admits_ready_manual_review_rows(self) -> None:
        result = build_manual_review_regulation_admission(
            candidate_audit=_candidate_audit(),
            owner_text_execution_report=_owner_text_report(),
            resolutions={
                "481": {
                    "target_collection": "scoped_rules",
                    "decision_source": "operator_review",
                    "rationale": "program-specific graduate admission rule",
                },
                "619": {
                    "target_collection": "institutional_rules",
                    "decision_source": "operator_review",
                    "rationale": "university-wide student organization rule",
                },
            },
            generated_at="2026-05-02T00:00:00+00:00",
        )

        report = result["resolution_report"]
        self.assertEqual(report["phase"], PHASE_11_ID)
        self.assertEqual(report["selected_notice_ids"], ["481", "619"])
        self.assertEqual(
            report["selected_counts_by_collection"],
            {"institutional_rules": 1, "scoped_rules": 1},
        )
        self.assertFalse(report["query_serving_opened"])
        self.assertFalse(report["rag_release_opened"])

        manifest = result["admission_manifest"]
        self.assertEqual(manifest["counts"]["downstream_admitted"], 2)
        by_notice = {entry["source_notice_id"]: entry for entry in manifest["entries"]}
        self.assertEqual(by_notice["481"]["consumption_class"], "downstream_admitted")
        self.assertEqual(by_notice["481"]["regulation_admission_class"], "scoped_rules_candidate")
        self.assertEqual(by_notice["481"]["target_collection"], "scoped_rules")
        self.assertNotIn("481", by_notice["481"]["target_identity_preview"])
        self.assertEqual(
            by_notice["481"]["manual_review_resolution"]["source_admission_class"],
            "manual_review",
        )
        self.assertEqual(
            by_notice["619"]["regulation_admission_class"],
            "institutional_rules_candidate",
        )
        self.assertEqual(by_notice["619"]["target_collection"], "institutional_rules")

        audit_by_notice = {
            row["source_notice_id"]: row for row in result["candidate_audit"]["candidates"]
        }
        self.assertEqual(audit_by_notice["481"]["owner_text_status"], "ready")
        self.assertEqual(audit_by_notice["619"]["target_collection"], "institutional_rules")

    def test_resolution_requires_manual_review_and_ready_owner_text(self) -> None:
        audit = _candidate_audit()
        audit["candidates"][0]["regulation_admission_class"] = "needs_multimodal"
        with self.assertRaisesRegex(ValueError, "must be manual_review"):
            build_manual_review_regulation_admission(
                candidate_audit=audit,
                owner_text_execution_report=_owner_text_report(),
                resolutions={"481": {"target_collection": "scoped_rules"}},
            )

        owner_text_report = _owner_text_report()
        owner_text_report["attempt_results"][0]["owner_text_status"] = "not_ready"
        with self.assertRaisesRegex(ValueError, "owner_text_status=ready"):
            build_manual_review_regulation_admission(
                candidate_audit=_candidate_audit(),
                owner_text_execution_report=owner_text_report,
                resolutions={"481": {"target_collection": "scoped_rules"}},
            )


def _candidate_audit() -> dict[str, object]:
    return {
        "schema_version": "collected_notice_regulation_candidate_audit.v1",
        "generated_at": "2026-05-02T00:00:00+00:00",
        "mode": "dry_run",
        "write_enabled": False,
        "target": "regulation",
        "candidates": [
            _manual_candidate(
                notice_id="481",
                title="中央民族大学接收校内外优秀应届本科毕业生免试攻读博士研究生工作办法（试行）",
            ),
            _manual_candidate(notice_id="619", title="中央民族大学学生社团管理办法"),
        ],
    }


def _manual_candidate(*, notice_id: str, title: str) -> dict[str, object]:
    return {
        "source_notice_id": notice_id,
        "source_surface": "file_release",
        "source_document_id": f"file-release:muc_internal_portal:{notice_id}",
        "searchable_unit_id": f"searchable:file_release:muc_internal_portal:{notice_id}",
        "title": title,
        "regulation_title_normalized": title,
        "issuing_org": "中央民族大学",
        "candidate_key": None,
        "regulation_admission_class": "manual_review",
        "consumption_class": "defer",
        "target_collection": None,
        "target_identity_preview": None,
        "reason_codes": [
            "regulation_candidate_requires_manual_review",
            "owner_text_recovered",
        ],
        "owner_text_status": "ready",
        "source_object_refs": [_source_ref(notice_id, "released_file")],
        "source_url": f"https://my.muc.edu.cn/file/{notice_id}.pdf",
    }


def _owner_text_report() -> dict[str, object]:
    return {
        "schema_version": "collected_notice_regulation_owner_text_execution_report.v1",
        "attempt_results": [
            _owner_text_result(
                notice_id="481",
                title="中央民族大学接收校内外优秀应届本科毕业生免试攻读博士研究生工作办法（试行）",
            ),
            _owner_text_result(notice_id="619", title="中央民族大学学生社团管理办法"),
        ],
    }


def _owner_text_result(*, notice_id: str, title: str) -> dict[str, object]:
    return {
        "status": "succeeded",
        "source_notice_id": notice_id,
        "searchable_unit_id": f"searchable:file_release:muc_internal_portal:{notice_id}",
        "title": title,
        "owner_text_status": "ready",
        "owner_text_length": 100,
        "owner_text_sha256": f"sha256:{notice_id}",
        "provider": "fixture",
        "model": "fixture",
        "written_refs": {"searchable_merge_input": _source_ref(notice_id, "owner_text")},
    }


def _source_ref(source_notice_id: str, role: str) -> dict[str, object]:
    return {
        "bucket": "campus-rag-source",
        "key": f"source/{source_notice_id}/{role}.json",
        "role": role,
    }


class FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = copy.deepcopy(objects or {})
        self.puts: list[tuple[str, str, bytes, str]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data
        self.puts.append((bucket, key, data, content_type))


def object_store_with_manual_review_sources() -> FakeObjectStore:
    objects: dict[tuple[str, str], bytes] = {}
    for notice_id, title in (
        (
            "481",
            "中央民族大学接收校内外优秀应届本科毕业生免试攻读博士研究生工作办法（试行）",
        ),
        ("619", "中央民族大学学生社团管理办法"),
    ):
        released = _source_ref(notice_id, "released_file")
        owner_text = _source_ref(notice_id, "owner_text")
        objects[(str(released["bucket"]), str(released["key"]))] = b"%PDF-fixture"
        objects[(str(owner_text["bucket"]), str(owner_text["key"]))] = (
            json.dumps(
                {
                    "schema_version": "regulation_owner_text_searchable_merge_input_v1",
                    "owner_text_ready": True,
                    "owner_text": f"{title}\n\n第一条 为测试人工复核规章准入，制定本办法。\n\n第二条 本办法适用于相关工作。",
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")
    return FakeObjectStore(objects)


__all__ = [
    "FakeObjectStore",
    "object_store_with_manual_review_sources",
    "_candidate_audit",
    "_owner_text_report",
]


if __name__ == "__main__":
    unittest.main()
