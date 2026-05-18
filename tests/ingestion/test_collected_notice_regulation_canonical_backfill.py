from __future__ import annotations

import copy
import json
import unittest

from campus_ingestion_core.collected_notice_regulation_canonical_backfill import (
    PHASE_13_ID,
    CollectedNoticeRegulationCanonicalBackfillRequest,
    backfill_collected_notice_regulation_canonical,
)
from campus_ingestion_core.collected_notice_regulation_text_normalization import (
    REGULATION_CANONICAL_NORMALIZER_VERSION,
)

from tests.ingestion.test_collected_notice_regulation_first_batch_promotion import (
    _candidate_audit as _first_batch_candidate_audit,
)
from tests.ingestion.test_collected_notice_regulation_first_batch_promotion import (
    _source_ref as _first_batch_source_ref,
)
from tests.ingestion.test_collected_notice_regulation_manual_review_admission import (
    _candidate_audit as _manual_review_candidate_audit,
)
from tests.ingestion.test_collected_notice_regulation_manual_review_admission import (
    _owner_text_report,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry


class CollectedNoticeRegulationCanonicalBackfillTests(unittest.TestCase):
    def test_backfill_rematerializes_historical_batches_with_current_cleaning_provenance(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        object_store = _FakeObjectStore(_historical_source_objects())

        report = backfill_collected_notice_regulation_canonical(
            request=CollectedNoticeRegulationCanonicalBackfillRequest(
                first_batch_candidate_audit=_historical_first_batch_candidate_audit(),
                first_batch_admission_manifest=_first_batch_admission_manifest(
                    ("594", "620", "481")
                ),
                manual_review_candidate_audit=_manual_review_candidate_audit(),
                manual_review_owner_text_execution_report=_owner_text_report(),
                manual_review_resolutions={
                    "481": "scoped_rules",
                    "619": "institutional_rules",
                },
                first_batch_notice_ids=("594", "620"),
                execute=True,
            ),
            env=_object_store_env(),
            object_store=object_store,
            document_registry=registry,
            raw_asset_registry=InMemoryRawAssetRegistry(),
            generated_at="2026-05-02T00:00:00+00:00",
        )

        self.assertEqual(
            report["schema_version"], "collected_notice_regulation_canonical_backfill.v1"
        )
        self.assertEqual(report["phase"], PHASE_13_ID)
        self.assertEqual(report["mode"], "execute")
        self.assertTrue(report["write_enabled"])
        self.assertEqual(report["selected_notice_ids"], ["481", "594", "619", "620"])
        self.assertEqual(report["materialized_document_count"], 4)
        self.assertFalse(report["query_serving_opened"])
        self.assertFalse(report["rag_release_opened"])
        self.assertEqual(
            [batch["batch_id"] for batch in report["batches"]],
            ["first_batch", "manual_review"],
        )

        records = registry.list_by_scope(
            "regulations", "institutional_rules"
        ) + registry.list_by_scope("regulations", "scoped_rules")
        self.assertEqual(len(records), 4)
        for record in records:
            rows = object_store.get_bytes(
                bucket="campus-rag-derived",
                key=record.document_units_object_key or "",
            )
            first_row = json.loads(rows.decode("utf-8").splitlines()[0])
            metadata = first_row["metadata"]
            self.assertEqual(
                metadata["normalizer_version"],
                REGULATION_CANONICAL_NORMALIZER_VERSION,
            )
            self.assertEqual(metadata["normalization_quality"]["quality_verdict"], "passed")
            self.assertEqual(
                metadata["cleaning_policy_version"],
                f"{record.collection}_cleaning_v1",
            )
            if "481" in metadata["source_notice_ids"]:
                self.assertEqual(
                    metadata["source_notice_release_time"],
                    "2024-01-09 13:55:34",
                )


def _first_batch_admission_manifest(notice_ids: tuple[str, ...]) -> dict[str, object]:
    audit = _historical_first_batch_candidate_audit()
    selected = {
        str(row["source_notice_id"]): row
        for row in audit["candidates"]
        if str(row.get("source_notice_id")) in set(notice_ids)
    }
    entries = [copy.deepcopy(selected[notice_id]) for notice_id in notice_ids]
    for entry in entries:
        entry["target"] = "regulation"
        if entry["source_notice_id"] == "481":
            entry["published_at"] = "2024-01-09 13:55:34"
            entry["body_excerpt"] = (
                "中央民族大学接收校内外优秀应届本科毕业生免试攻读博士研究生工作办法（试行）\n"
                "发布时间：2024-01-09 13:55:34\n"
                "第一条 为测试历史规章 canonical 回填，制定本办法。"
            )
    return {
        "schema_version": "collected_notice_consumer_admission.v1",
        "mode": "dry_run",
        "write_enabled": False,
        "target": "regulation",
        "entries": entries,
    }


def _historical_first_batch_candidate_audit() -> dict[str, object]:
    audit = _first_batch_candidate_audit()
    target_ids = {
        "594": "institutional_regulation:muc:first-batch-alpha:f16e569519f7",
        "620": "institutional_regulation:muc:first-batch-beta:1bc08d61fc1d",
    }
    for row in audit["candidates"]:
        notice_id = str(row.get("source_notice_id") or "")
        if notice_id in target_ids:
            row["target_identity_preview"] = target_ids[notice_id]
    return audit


def _historical_source_objects() -> dict[tuple[str, str], bytes]:
    objects: dict[tuple[str, str], bytes] = {}
    titles = {
        "594": "测试规章 594",
        "620": "测试规章 620",
        "481": "中央民族大学接收校内外优秀应届本科毕业生免试攻读博士研究生工作办法（试行）",
        "619": "中央民族大学学生社团管理办法",
    }
    for notice_id, title in titles.items():
        released_ref = _source_ref(notice_id, "released_file")
        owner_text_ref = _source_ref(notice_id, "owner_text")
        objects[(str(released_ref["bucket"]), str(released_ref["key"]))] = b"%PDF-fixture"
        objects[(str(owner_text_ref["bucket"]), str(owner_text_ref["key"]))] = (
            json.dumps(
                {
                    "schema_version": "regulation_owner_text_searchable_merge_input_v1",
                    "owner_text_ready": True,
                    "owner_text": (
                        f"{title}\n\n"
                        "第一条 为测试历史规章 canonical 回填，制定本办法。\n\n"
                        "第二条 本办法适用于相关管理工作。"
                    ),
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")
    return objects


def _source_ref(source_notice_id: str, role: str) -> dict[str, object]:
    if source_notice_id in {"594", "620"}:
        return _first_batch_source_ref(source_notice_id, role)
    return {
        "bucket": "campus-rag-source",
        "key": f"source/{source_notice_id}/{role}.json",
        "role": role,
    }


def _object_store_env() -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORE_SECRET_KEY": "minioadmin",
        "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
        "EMBEDDING_MODEL": "mock-embedding-8d",
    }


class _FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = copy.deepcopy(objects or {})
        self.puts: list[tuple[str, str, bytes, str]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data
        self.puts.append((bucket, key, data, content_type))


if __name__ == "__main__":
    unittest.main()
