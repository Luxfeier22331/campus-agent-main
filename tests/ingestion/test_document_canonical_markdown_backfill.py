from __future__ import annotations

import json
import unittest
from dataclasses import replace

from campus_ingestion_core.document_canonical_markdown_backfill import (
    backfill_missing_canonical_markdown_from_document_units,
)
from campus_ingestion_core.models import DocumentRegistryRecord


class _FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self.objects = dict(objects)
        self.writes: dict[tuple[str, str], tuple[bytes, str]] = {}

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        try:
            return self.objects[(bucket, key)]
        except KeyError as exc:
            raise FileNotFoundError(key) from exc

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data
        self.writes[(bucket, key)] = (data, content_type)


class DocumentCanonicalMarkdownBackfillTest(unittest.TestCase):
    def test_backfills_missing_canonical_markdown_from_document_units(self) -> None:
        record = _make_record()
        store = _FakeObjectStore(
            {
                ("campus-agent-derived", record.document_units_object_key or ""): _units(
                    record=record,
                    title="示例大学丰台校区就医管理办法（暂行）",
                    body=("第一条 医疗服务保障由校医院负责。", "第二条 学生应按规定就医。"),
                )
            }
        )

        report = backfill_missing_canonical_markdown_from_document_units(
            bucket="campus-agent-derived",
            object_store=store,
            records=(record,),
        )

        target = ("campus-agent-derived", record.canonical_markdown_object_key or "")
        self.assertEqual(report.selected_record_count, 1)
        self.assertEqual(report.backfilled_count, 1)
        self.assertEqual(report.skipped_existing_count, 0)
        payload, content_type = store.writes[target]
        self.assertEqual(content_type, "text/markdown; charset=utf-8")
        self.assertEqual(
            payload.decode("utf-8"),
            "# 示例大学丰台校区就医管理办法（暂行）\n\n"
            "第一条 医疗服务保障由校医院负责。\n\n"
            "第二条 学生应按规定就医。\n",
        )

    def test_skips_records_that_already_have_canonical_markdown(self) -> None:
        record = _make_record()
        store = _FakeObjectStore(
            {
                ("campus-agent-derived", record.canonical_markdown_object_key or ""): (
                    "# 已存在\n\n正文。\n"
                ).encode(),
                ("campus-agent-derived", record.document_units_object_key or ""): _units(
                    record=record,
                    title="示例大学丰台校区就医管理办法（暂行）",
                    body=("第一条 正文。",),
                ),
            }
        )

        report = backfill_missing_canonical_markdown_from_document_units(
            bucket="campus-agent-derived",
            object_store=store,
            records=(record,),
        )

        self.assertEqual(report.backfilled_count, 0)
        self.assertEqual(report.skipped_existing_count, 1)
        self.assertEqual(store.writes, {})

    def test_fails_before_writing_when_required_record_keys_are_missing(self) -> None:
        valid_record = _make_record(document_id_suffix="valid")
        invalid_record = replace(
            _make_record(document_id_suffix="invalid"), canonical_markdown_object_key=None
        )
        store = _FakeObjectStore(
            {
                ("campus-agent-derived", valid_record.document_units_object_key or ""): _units(
                    record=valid_record,
                    title="有效制度",
                    body=("第一条 有效正文。",),
                )
            }
        )

        with self.assertRaisesRegex(ValueError, "canonical_markdown_object_key is required"):
            backfill_missing_canonical_markdown_from_document_units(
                bucket="campus-agent-derived",
                object_store=store,
                records=(valid_record, invalid_record),
            )

        self.assertEqual(store.writes, {})

    def test_fails_before_writing_when_document_units_are_missing(self) -> None:
        record = _make_record()
        store = _FakeObjectStore({})

        with self.assertRaisesRegex(ValueError, "document_units_object missing"):
            backfill_missing_canonical_markdown_from_document_units(
                bucket="campus-agent-derived",
                object_store=store,
                records=(record,),
            )

        self.assertEqual(store.writes, {})

    def test_fails_before_writing_when_units_have_no_body_text(self) -> None:
        record = _make_record()
        store = _FakeObjectStore(
            {
                ("campus-agent-derived", record.document_units_object_key or ""): _units(
                    record=record,
                    title="只有标题",
                    body=(),
                )
            }
        )

        with self.assertRaisesRegex(ValueError, "no canonical body units"):
            backfill_missing_canonical_markdown_from_document_units(
                bucket="campus-agent-derived",
                object_store=store,
                records=(record,),
            )

        self.assertEqual(store.writes, {})


def _make_record(document_id_suffix: str = "ff711d1185f9") -> DocumentRegistryRecord:
    document_id = (
        f"institutional_regulation:example:示例大学丰台校区就医管理办法-暂行:{document_id_suffix}"
    )
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="current-effective",
        version_id=f"sha256:{document_id_suffix}:effective-undated:revision-none",
        source_uri="campus-agent://regulations/institutional_rules/test",
        content_hash=f"sha256:{document_id_suffix}",
        corpus="regulations",
        collection="institutional_rules",
        cleaning_policy_version="institutional_rules_cleaning_v1",
        entitlement_groups=(),
        visibility_level="public",
        status="active",
        ingestion_timestamp="2026-05-18T00:00:00+00:00",
        parser_version="collected_notice_regulation_canonical_cleaning_v9",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=True,
        document_units_object_key=(
            "regulations/documents/institutional_rules/"
            f"示例大学丰台校区就医管理办法-暂行--{document_id_suffix[:8]}/"
            "current-effective/undated/document-units.jsonl"
        ),
        canonical_markdown_object_key=(
            "regulations/documents/institutional_rules/"
            f"示例大学丰台校区就医管理办法-暂行--{document_id_suffix[:8]}/"
            "current-effective/undated/canonical.md"
        ),
        import_source="index_release_registry_restore",
    )


def _units(
    *,
    record: DocumentRegistryRecord,
    title: str,
    body: tuple[str, ...],
) -> bytes:
    rows = [
        {
            "doc_id": record.document_id,
            "version_id": record.version_id,
            "chunk_id": "unit-0001",
            "clean_text": title,
            "root_unit_id": "root-title",
            "unit_type": "regulation_title",
            "anchor": {"section_path": [title]},
            "metadata": {
                "title": title,
                "normalization_quality": {"quality_verdict": "passed"},
                "promotion_class": "formal_regulation",
            },
        }
    ]
    for index, text in enumerate(body, start=2):
        rows.append(
            {
                "doc_id": record.document_id,
                "version_id": record.version_id,
                "chunk_id": f"unit-{index:04d}",
                "clean_text": text,
                "root_unit_id": f"root-{index:04d}",
                "unit_type": "regulation_body",
                "anchor": {"section_path": [title]},
                "metadata": {
                    "title": title,
                    "normalization_quality": {"quality_verdict": "passed"},
                    "promotion_class": "formal_regulation",
                },
            }
        )
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows).encode("utf-8")


if __name__ == "__main__":
    unittest.main()
