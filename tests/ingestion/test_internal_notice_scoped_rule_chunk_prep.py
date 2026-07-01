from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.internal_notice_scoped_rule_chunk_prep import (
    _build_document_report,
    prepare_scoped_rule_chunks,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process_shared import IndexableChunk


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
        source_uri=f"campus-agent://promotion/synthetic_notice_scoped_rules/{document_id}",
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


def _source_notice_record(*, notice_id: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=f"notice:example_internal_portal:{notice_id}",
        revision_track="source-faithful",
        version_id=f"sha256:{notice_id}:source-faithful",
        source_uri=f"https://portal.example.edu/notices/{notice_id}",
        content_hash=f"sha256:{notice_id}",
        corpus="campus_notices",
        collection="internal_notice",
        cleaning_policy_version="authenticated_notice_projection_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-10T00:00:00+00:00",
        parser_version="authenticated_notice_source_projection_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=True,
        document_units_object_key=(
            f"campus_notices/documents/internal_notice/{notice_id}/document-units.jsonl"
        ),
        canonical_markdown_object_key=(
            f"campus_notices/documents/internal_notice/{notice_id}/canonical.md"
        ),
        processed_object_keys=(
            f"campus_notices/documents/internal_notice/{notice_id}/canonical.md",
            f"campus_notices/documents/internal_notice/{notice_id}/document-units.jsonl",
        ),
        import_source="authenticated_notice_source_projection",
        published_date="2026-04-10",
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
    school_unit_name: str | None = None,
    campus_site: str | None = None,
    force_status: str | None = None,
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
        "school_unit_name": school_unit_name,
        "campus_site": campus_site,
        "force_status": force_status,
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


def _chunk(
    *,
    record: DocumentRegistryRecord,
    order: int,
    content_role: str,
    display_text: str,
    text: str | None = None,
    provision_label: str | None = None,
) -> IndexableChunk:
    anchor: dict[str, object] = {"section_path": ["三、申请条件"]}
    if provision_label:
        anchor["provision_label"] = provision_label
    return IndexableChunk(
        document_id=record.document_id,
        revision_track=record.revision_track,
        version_id=record.version_id,
        chunk_id=f"{record.document_id}:{record.version_id}:chunk-{order:04d}",
        chunk_order=order,
        corpus=record.corpus,
        collection=record.collection,
        source_uri=record.source_uri,
        canonical_url=record.source_uri,
        latest_url=record.source_uri,
        source_chunk_id=None,
        status=record.status,
        anchor=anchor,
        text=text or f"标题：历史专项规则\n章节：三、申请条件\n{display_text}",
        source_channel=record.source_channel,
        is_current=record.is_current,
        parser_version=record.parser_version,
        embedding_model=record.embedding_model,
        entitlement_groups=record.entitlement_groups,
        visibility_scope=record.visibility_scope,
        visibility_level=record.visibility_level,
        metadata={
            "content_role": content_role,
            "title": "历史专项规则",
            "document_nature": "time_bound_operational_rule",
            "promotion_source_collection": "campus_notices/internal_notice",
            "regulation_title_normalized": "历史专项规则",
            "source_notice_ids": ["351907"],
            "source_notice_release_time": "2026-04-01 12:00",
            "display_text": display_text,
            "contextualized_text": content_role != "scoped_rule_title",
            "final_token_count": 80,
            **({"provision_label": provision_label} if provision_label else {}),
        },
    )


class ScopedRuleChunkPrepTest(unittest.TestCase):
    def test_document_report_flags_adjacent_overlap_and_coarse_provision_label(
        self,
    ) -> None:
        record = _record(
            document_id="institutional_regulation:example:历史专项规则:chunk-quality",
            version_id="sha256:scoped:chunk-quality",
            units_key="regulations/documents/scoped_rules/chunk-quality/document-units.jsonl",
        )
        unit_rows = [
            {
                "metadata": {
                    "title": "历史专项规则",
                    "document_nature": "time_bound_operational_rule",
                    "source_notice_ids": ["351907"],
                    "source_notice_release_time": "2026-04-01 12:00",
                    "promotion_source_collection": "campus_notices/internal_notice",
                    "regulation_title_normalized": "历史专项规则",
                }
            }
        ]
        chunks = (
            _chunk(
                record=record,
                order=1,
                content_role="scoped_rule_title",
                display_text="历史专项规则",
                text="历史专项规则",
            ),
            _chunk(
                record=record,
                order=2,
                content_role="scoped_rule_body",
                display_text=(
                    "1. 第一项要求。\n2. 第二项要求。\n3. 以排名前3发明人获得至少1项授权专利。"
                ),
                provision_label="1.",
            ),
            _chunk(
                record=record,
                order=3,
                content_role="scoped_rule_body",
                display_text=("3. 以排名前3发明人获得至少1项授权专利。\n4. 其他科研成果。"),
                provision_label="3.",
            ),
        )

        with TemporaryDirectory() as temp_dir:
            report = _build_document_report(
                record=record,
                title="历史专项规则",
                unit_rows=unit_rows,
                chunks=chunks,
                relative_root=Path(temp_dir),
                document_units_path=Path(temp_dir) / "document-units.jsonl",
                chunk_catalog_path=Path(temp_dir) / "chunks.jsonl",
            )

        self.assertFalse(report.passed)
        self.assertEqual(report.adjacent_body_overlap_chunk_count, 1)
        self.assertEqual(report.coarse_provision_label_chunk_count, 2)
        self.assertIn("adjacent_body_overlap", report.issues)
        self.assertIn("coarse_provision_label", report.issues)

    def test_prepare_scoped_rule_chunks_ignores_source_notice_records(self) -> None:
        source_notice = _source_notice_record(notice_id="187233")

        with TemporaryDirectory() as temp_dir:
            report = prepare_scoped_rule_chunks(
                records=(source_notice,),
                object_store=_FakeObjectStore(),
                output_dir=Path(temp_dir),
            )

            self.assertTrue(report.passed)
            self.assertEqual(report.prepared_document_count, 0)
            self.assertEqual(report.total_unit_count, 0)
            self.assertEqual(report.total_chunk_count, 0)
            self.assertEqual(report.prepared_documents, ())

            manifest = json.loads(Path(report.manifest_path).read_text(encoding="utf-8"))
            self.assertEqual(manifest["target_corpus"], "regulations")
            self.assertEqual(manifest["target_collection"], "scoped_rules")
            self.assertEqual(manifest["prepared_document_count"], 0)
            self.assertEqual(manifest["documents"], [])

    def test_prepare_scoped_rule_chunks_emits_local_only_artifacts_and_validation(self) -> None:
        annual_record = _record(
            document_id="institutional_regulation:example:推免工作实施细则:abc12345",
            version_id="sha256:annual:1",
            units_key="regulations/documents/scoped_rules/annual-rule/document-units.jsonl",
        )
        seasonal_record = _record(
            document_id="institutional_regulation:example:暑假实验室安全管理规定:def67890",
            version_id="sha256:seasonal:1",
            units_key="regulations/documents/scoped_rules/seasonal-rule/document-units.jsonl",
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-agent-derived",
                    annual_record.document_units_object_key or "",
                ): _scoped_rule_rows(
                    document_id=annual_record.document_id,
                    version_id=annual_record.version_id,
                    title="示例传媒学院推荐2026届本科生免试攻读研究生工作实施细则",
                    document_nature="annual_cycle_rule",
                    source_notice_ids=("351907",),
                    source_notice_release_time="2026-04-01 12:00",
                    cycle_year="2026",
                    school_unit_name="示例传媒学院",
                    body_blocks=(
                        "## 第一条",
                        "为规范推荐2026届本科生免试攻读研究生工作，制定本细则。",
                        "## 第二条",
                        "本细则适用于示例传媒学院相关学生。",
                        "附件：推荐免试攻读研究生申请材料清单",
                    ),
                ),
                (
                    "campus-agent-derived",
                    seasonal_record.document_units_object_key or "",
                ): _scoped_rule_rows(
                    document_id=seasonal_record.document_id,
                    version_id=seasonal_record.version_id,
                    title="示例生命学院关于2021年暑假期间实验室安全管理规定",
                    document_nature="time_bound_operational_rule",
                    source_notice_ids=("191176", "191177"),
                    source_notice_release_time="2021-07-01 08:00",
                    cycle_year="2021",
                    school_unit_name="示例生命学院",
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

            validation = json.loads(
                Path(report.validation_summary_path).read_text(encoding="utf-8")
            )
            self.assertTrue(validation["passed"])
            self.assertEqual(validation["missing_cycle_year_count"], 0)
            self.assertEqual(validation["missing_school_unit_name_count"], 0)
            self.assertEqual(validation["wrapper_notice_leak_chunk_count"], 0)
            self.assertEqual(validation["front_matter_leak_chunk_count"], 0)

            document_reports = [
                json.loads(line)
                for line in Path(report.document_reports_path)
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            self.assertEqual(len(document_reports), 2)
            annual_report = next(
                item for item in document_reports if item["document_nature"] == "annual_cycle_rule"
            )
            self.assertTrue(annual_report["passed"])
            self.assertEqual(annual_report["missing_cycle_year_count"], 0)
            self.assertEqual(annual_report["missing_school_unit_name_count"], 0)
            self.assertEqual(annual_report["missing_projection_metadata_count"], 0)

            annual_chunks_path = Path(temp_dir) / annual_report["chunk_catalog_path"]
            annual_chunks = [
                json.loads(line)
                for line in annual_chunks_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertTrue(
                any(
                    chunk["metadata"].get("content_role") == "scoped_rule_title"
                    for chunk in annual_chunks
                )
            )
            self.assertTrue(all(chunk["collection"] == "scoped_rules" for chunk in annual_chunks))
            self.assertTrue(
                any(
                    chunk["metadata"].get("document_nature") == "annual_cycle_rule"
                    and chunk["metadata"].get("cycle_year") == "2026"
                    for chunk in annual_chunks
                )
            )

    def test_prepare_scoped_rule_chunks_flags_missing_cycle_year_for_annual_cycle_rule(
        self,
    ) -> None:
        annual_record = _record(
            document_id="institutional_regulation:example:推免工作实施细则:missing-year",
            version_id="sha256:annual:missing-year",
            units_key="regulations/documents/scoped_rules/missing-year/document-units.jsonl",
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-agent-derived",
                    annual_record.document_units_object_key or "",
                ): _scoped_rule_rows(
                    document_id=annual_record.document_id,
                    version_id=annual_record.version_id,
                    title="示例传媒学院推荐本科生免试攻读研究生工作实施细则",
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
            validation = json.loads(
                Path(report.validation_summary_path).read_text(encoding="utf-8")
            )
            self.assertFalse(validation["passed"])
            self.assertEqual(validation["missing_cycle_year_count"], 1)
            self.assertEqual(
                validation["failed_document_ids"],
                [annual_record.document_id],
            )

    def test_prepare_scoped_rule_chunks_flags_missing_school_unit_name_for_annual_cycle_rule(
        self,
    ) -> None:
        annual_record = _record(
            document_id="institutional_regulation:example:推免工作实施细则:missing-school-unit",
            version_id="sha256:annual:missing-school-unit",
            units_key="regulations/documents/scoped_rules/missing-school-unit/document-units.jsonl",
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-agent-derived",
                    annual_record.document_units_object_key or "",
                ): _scoped_rule_rows(
                    document_id=annual_record.document_id,
                    version_id=annual_record.version_id,
                    title="示例大学2026届推荐本科生免试攻读研究生工作实施细则",
                    document_nature="annual_cycle_rule",
                    source_notice_ids=("351907",),
                    source_notice_release_time="2026-04-01 12:00",
                    cycle_year="2026",
                    school_unit_name=None,
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
            validation = json.loads(
                Path(report.validation_summary_path).read_text(encoding="utf-8")
            )
            self.assertFalse(validation["passed"])
            self.assertEqual(validation["missing_school_unit_name_count"], 1)
            self.assertEqual(
                validation["failed_document_ids"],
                [annual_record.document_id],
            )

    def test_prepare_scoped_rule_chunks_blocks_generated_at_release_time(self) -> None:
        scoped_record = _record(
            document_id="institutional_regulation:example:历史专项规则:generated-at-release-time",
            version_id="sha256:scoped:generated-at-release-time",
            units_key="regulations/documents/scoped_rules/generated-at/document-units.jsonl",
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-agent-derived",
                    scoped_record.document_units_object_key or "",
                ): _scoped_rule_rows(
                    document_id=scoped_record.document_id,
                    version_id=scoped_record.version_id,
                    title="历史专项规则",
                    document_nature="time_bound_operational_rule",
                    source_notice_ids=("351907",),
                    source_notice_release_time="2026-05-02T00:00:00+00:00",
                    cycle_year="2026",
                    school_unit_name="示例传媒学院",
                    body_blocks=(
                        "## 第一条",
                        "为规范历史专项规则处理流程，制定本规则。",
                    ),
                )
            }
        )

        with TemporaryDirectory() as temp_dir:
            report = prepare_scoped_rule_chunks(
                records=(scoped_record,),
                object_store=object_store,
                output_dir=Path(temp_dir),
            )

            self.assertFalse(report.passed)
            validation = json.loads(
                Path(report.validation_summary_path).read_text(encoding="utf-8")
            )
            self.assertFalse(validation["passed"])
            self.assertEqual(validation["generated_at_release_time_count"], 1)
            self.assertEqual(validation["failed_document_ids"], [scoped_record.document_id])

    def test_prepare_scoped_rule_chunks_blocks_html_and_body_like_section_path(self) -> None:
        scoped_record = _record(
            document_id="institutional_regulation:example:历史专项规则:html-section-path",
            version_id="sha256:scoped:html-section-path",
            units_key="regulations/documents/scoped_rules/html-section-path/document-units.jsonl",
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-agent-derived",
                    scoped_record.document_units_object_key or "",
                ): _scoped_rule_rows(
                    document_id=scoped_record.document_id,
                    version_id=scoped_record.version_id,
                    title="历史专项规则",
                    document_nature="time_bound_operational_rule",
                    source_notice_ids=("351907",),
                    source_notice_release_time="2026-04-01 12:00",
                    cycle_year="2026",
                    school_unit_name="示例传媒学院",
                    body_blocks=(
                        "## （一）应遵守学校纪律要求；",
                        "申请者应按要求提交材料。<table><tr><td>材料</td></tr></table>",
                    ),
                )
            }
        )

        with TemporaryDirectory() as temp_dir:
            report = prepare_scoped_rule_chunks(
                records=(scoped_record,),
                object_store=object_store,
                output_dir=Path(temp_dir),
            )

            self.assertFalse(report.passed)
            validation = json.loads(
                Path(report.validation_summary_path).read_text(encoding="utf-8")
            )
            self.assertFalse(validation["passed"])
            self.assertEqual(validation.get("html_tag_chunk_count"), 1)
            self.assertGreaterEqual(validation.get("body_like_section_path_chunk_count"), 1)
            self.assertEqual(validation["failed_document_ids"], [scoped_record.document_id])


if __name__ == "__main__":
    unittest.main()
