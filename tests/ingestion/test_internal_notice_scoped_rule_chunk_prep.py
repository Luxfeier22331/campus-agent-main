from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_core.internal_notice_scoped_rule_chunk_prep import (
    prepare_scoped_rule_chunks,
)
from campus_ingestion_core.models import DocumentRegistryRecord


class _FakeObjectStore:
    def __init__(self, *, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = dict(objects or {})

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]


def _record(*, document_id: str, version_id: str, units_key: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="current-effective",
        version_id=version_id,
        source_uri=f"campusrag://promotion/internal_notice_scoped_rules/{document_id}",
        content_hash=f"sha256:{document_id}",
        corpus="regulations",
        collection="scoped_rules",
        cleaning_policy_version="scoped_rules_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-11T10:00:00+00:00",
        parser_version="internal_notice_scoped_rule_materialization_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="manual_curated",
        is_current=True,
        document_units_object_key=units_key,
        canonical_markdown_object_key=units_key.replace("document-units.jsonl", "canonical.md"),
        processed_object_keys=(units_key,),
        import_source="internal_notice_scoped_rule_materialization",
        published_date="2026-04-11",
    )


def _scoped_rule_rows(
    *,
    document_id: str,
    version_id: str,
    title: str,
    document_nature: str,
    source_notice_ids: tuple[str, ...],
    source_notice_release_time: str,
    cycle_year: str | None,
    body_blocks: tuple[str, ...],
) -> bytes:
    base_metadata: dict[str, object] = {
        "title": title,
        "content_kind": "scoped_rule",
        "document_nature": document_nature,
        "promotion_source_collection": "campus_notices/internal_notice",
        "source_notice_ids": list(source_notice_ids),
        "source_notice_release_time": source_notice_release_time,
        "regulation_title_normalized": title,
        "cycle_year": cycle_year,
    }
    root_unit_id = f"{document_id}:root"
    rows = [
        _row(
            document_id=document_id,
            version_id=version_id,
            row_id=f"{document_id}:row-0001",
            row_type="heading",
            clean_text=title,
            unit_type="scoped_rule_heading",
            root_unit_id=root_unit_id,
            metadata={
                **base_metadata,
                "detail_label": "标题",
                "section_path": [title],
                "content_role": "scoped_rule_title",
            },
        )
    ]
    current_section = [title]
    for index, block in enumerate(body_blocks, start=2):
        row_type = "heading" if block.startswith("## ") else "paragraph"
        clean_text = block[3:].strip() if row_type == "heading" else block
        if row_type == "heading":
            current_section = [title, clean_text]
        rows.append(
            _row(
                document_id=document_id,
                version_id=version_id,
                row_id=f"{document_id}:row-{index:04d}",
                row_type=row_type,
                clean_text=clean_text,
                unit_type="scoped_rule_block",
                root_unit_id=root_unit_id,
                metadata={
                    **base_metadata,
                    "detail_label": "正文",
                    "section_path": list(current_section),
                    "content_role": "scoped_rule_body",
                },
            )
        )
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows).encode("utf-8")


def _row(
    *,
    document_id: str,
    version_id: str,
    row_id: str,
    row_type: str,
    clean_text: str,
    unit_type: str,
    root_unit_id: str,
    metadata: dict[str, object],
) -> dict[str, object]:
    return {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": row_id,
        "row_id": row_id,
        "row_type": row_type,
        "clean_text": clean_text,
        "source_pdf": "source.pdf",
        "source_url": f"https://portal.example.edu/{document_id}",
        "source": {"id": f"https://portal.example.edu/{document_id}"},
        "page_start": 1,
        "page_end": 2,
        "entitlement_groups": ["campus_members"],
        "visibility_scope": "campus",
        "visibility_level": "restricted",
        "policy_projection_version": "phase1-authorization-projection-v1",
        "unit_type": unit_type,
        "root_unit_id": root_unit_id,
        "metadata": metadata,
    }


class ScopedRuleChunkPrepTest(unittest.TestCase):
    def test_prepare_scoped_rule_chunks_emits_local_only_artifacts_and_validation(self) -> None:
        annual_record = _record(
            document_id="institutional_regulation:muc:推免工作实施细则:abc12345",
            version_id="sha256:annual:1",
            units_key="regulations/documents/scoped_rules/annual-rule/document-units.jsonl",
        )
        seasonal_record = _record(
            document_id="institutional_regulation:muc:暑假实验室安全管理规定:def67890",
            version_id="sha256:seasonal:1",
            units_key="regulations/documents/scoped_rules/seasonal-rule/document-units.jsonl",
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-rag-derived",
                    annual_record.document_units_object_key or "",
                ): _scoped_rule_rows(
                    document_id=annual_record.document_id,
                    version_id=annual_record.version_id,
                    title="新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
                    document_nature="annual_cycle_rule",
                    source_notice_ids=("351907",),
                    source_notice_release_time="2026-04-01 12:00",
                    cycle_year="2026",
                    body_blocks=(
                        "## 第一条",
                        "为规范推荐2026届本科生免试攻读研究生工作，制定本细则。",
                        "## 第二条",
                        "本细则适用于新闻与传播学院相关学生。",
                    ),
                ),
                (
                    "campus-rag-derived",
                    seasonal_record.document_units_object_key or "",
                ): _scoped_rule_rows(
                    document_id=seasonal_record.document_id,
                    version_id=seasonal_record.version_id,
                    title="生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                    document_nature="time_bound_operational_rule",
                    source_notice_ids=("191176", "191177"),
                    source_notice_release_time="2021-07-01 08:00",
                    cycle_year="2021",
                    body_blocks=(
                        "## 第一条",
                        "为加强暑假期间实验室安全管理，制定本规定。",
                        "## 第二条",
                        "暑假期间所有实验室须执行值班制度，并落实安全巡查。",
                    ),
                ),
            }
        )

        with TemporaryDirectory() as temp_dir:
            report = prepare_scoped_rule_chunks(
                records=(annual_record, seasonal_record),
                object_store=object_store,
                output_dir=Path(temp_dir),
            )

            self.assertTrue(report.passed)
            self.assertEqual(report.prepared_document_count, 2)
            self.assertGreater(report.total_unit_count, 4)
            self.assertGreater(report.total_chunk_count, 2)

            manifest = json.loads(Path(report.manifest_path).read_text(encoding="utf-8"))
            self.assertEqual(manifest["target_collection"], "scoped_rules")
            self.assertEqual(manifest["prepared_document_count"], 2)

            validation = json.loads(Path(report.validation_summary_path).read_text(encoding="utf-8"))
            self.assertTrue(validation["passed"])
            self.assertEqual(validation["missing_cycle_year_count"], 0)
            self.assertEqual(validation["wrapper_notice_leak_chunk_count"], 0)
            self.assertEqual(validation["front_matter_leak_chunk_count"], 0)

            document_reports = [
                json.loads(line)
                for line in Path(report.document_reports_path).read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertEqual(len(document_reports), 2)
            annual_report = next(
                item
                for item in document_reports
                if item["document_nature"] == "annual_cycle_rule"
            )
            self.assertTrue(annual_report["passed"])
            self.assertEqual(annual_report["missing_cycle_year_count"], 0)
            self.assertEqual(annual_report["missing_projection_metadata_count"], 0)

            annual_chunks_path = Path(temp_dir) / annual_report["chunk_catalog_path"]
            annual_chunks = [
                json.loads(line)
                for line in annual_chunks_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertTrue(
                any(chunk["metadata"].get("content_role") == "scoped_rule_title" for chunk in annual_chunks)
            )
            self.assertTrue(
                all(chunk["collection"] == "scoped_rules" for chunk in annual_chunks)
            )
            self.assertTrue(
                any(
                    chunk["metadata"].get("document_nature") == "annual_cycle_rule"
                    and chunk["metadata"].get("cycle_year") == "2026"
                    for chunk in annual_chunks
                )
            )

    def test_prepare_scoped_rule_chunks_flags_missing_cycle_year_for_annual_cycle_rule(self) -> None:
        annual_record = _record(
            document_id="institutional_regulation:muc:推免工作实施细则:missing-year",
            version_id="sha256:annual:missing-year",
            units_key="regulations/documents/scoped_rules/missing-year/document-units.jsonl",
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-rag-derived",
                    annual_record.document_units_object_key or "",
                ): _scoped_rule_rows(
                    document_id=annual_record.document_id,
                    version_id=annual_record.version_id,
                    title="新闻与传播学院推荐本科生免试攻读研究生工作实施细则",
                    document_nature="annual_cycle_rule",
                    source_notice_ids=("351907",),
                    source_notice_release_time="2026-04-01 12:00",
                    cycle_year=None,
                    body_blocks=(
                        "## 第一条",
                        "为规范推荐本科生免试攻读研究生工作，制定本细则。",
                    ),
                )
            }
        )

        with TemporaryDirectory() as temp_dir:
            report = prepare_scoped_rule_chunks(
                records=(annual_record,),
                object_store=object_store,
                output_dir=Path(temp_dir),
            )

            self.assertFalse(report.passed)
            validation = json.loads(Path(report.validation_summary_path).read_text(encoding="utf-8"))
            self.assertFalse(validation["passed"])
            self.assertEqual(validation["missing_cycle_year_count"], 1)
            self.assertEqual(
                validation["failed_document_ids"],
                [annual_record.document_id],
            )


if __name__ == "__main__":
    unittest.main()
