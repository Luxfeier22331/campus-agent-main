from __future__ import annotations

import hashlib
import json

from campus_ingestion_core.chunking import CURRICULUM_CLEANING_POLICY_VERSION
from campus_ingestion_core.curriculum_budget_evaluation_shared import (
    _DEFAULT_EMBEDDING_MODEL,
    _DEFAULT_LAYOUT_FIXTURE_PATH,
    _DEFAULT_RUNTIME_TITLES,
    _DEFAULT_SAMPLE_INDEX_PATH,
    _REPO_ROOT,
    CurriculumBudgetEvaluationDocument,
    CurriculumBudgetProbeCase,
)
from campus_ingestion_core.curriculum_chunk_units import _looks_like_curriculum_structure_heading
from campus_ingestion_core.file_asset_routing import MINERU_ADAPTED_PARSER_VERSION
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.raw_ingestion_split_manifest import (
    _build_split_manifest_document_input,
    _load_layout_elements_rows,
)
from campus_ingestion_core.raw_ingestion_split_manifest_curriculum import (
    CURRICULUM_SPLIT_MANIFEST_ROW_POLICY,
)
from campus_ingestion_core.split_manifest import SplitManifest, SplitManifestDocument


def load_runtime_curriculum_budget_evaluation_documents() -> tuple[
    CurriculumBudgetEvaluationDocument, ...
]:
    return _load_runtime_fixture_documents()


def load_historical_curriculum_budget_evaluation_documents() -> tuple[
    CurriculumBudgetEvaluationDocument, ...
]:
    return _load_historical_sample_documents()


def load_default_curriculum_budget_evaluation_documents(
    *,
    include_historical: bool = False,
) -> tuple[CurriculumBudgetEvaluationDocument, ...]:
    runtime_documents = _load_runtime_fixture_documents()
    if not include_historical:
        return runtime_documents
    historical_documents = _load_historical_sample_documents()
    return (*runtime_documents, *historical_documents)


def _load_runtime_fixture_documents() -> tuple[CurriculumBudgetEvaluationDocument, ...]:
    manifest = SplitManifest(
        manifest_version="curriculum_plan_split_manifest_synthetic_fixture_v1",
        corpus="curriculum",
        collection="curriculum_plan",
        raw_asset_id="asset:synthetic-curriculum-plan",
        documents=(
            SplitManifestDocument(
                document_id="curriculum:示例公共事务本科人才培养方案",
                title="示例公共事务本科人才培养方案",
                page_start=278,
                page_end=288,
            ),
            SplitManifestDocument(
                document_id="curriculum:示例数据系统本科人才培养方案",
                title="示例数据系统本科人才培养方案",
                page_start=289,
                page_end=297,
            ),
        ),
    )
    layout_rows = _load_layout_elements_rows(_DEFAULT_LAYOUT_FIXTURE_PATH.read_bytes())
    raw_asset_record = RawAssetRecord(
        raw_asset_id="asset:synthetic-curriculum-plan",
        raw_version_id="sha256:synthetic-curriculum-plan-fixture",
        corpus="curriculum",
        collection="curriculum_plan",
        raw_source_uri="file:///tmp/synthetic-curriculum-plan.pdf",
        content_hash="synthetic-curriculum-plan-fixture",
        source_filename="synthetic-curriculum-plan.pdf",
        object_key="official_pdf/curriculum-plan/synthetic/sha256/test/capture/synthetic-curriculum-plan.pdf",
        ingestion_timestamp="2026-03-27T12:00:00+00:00",
        import_source="raw_online_ocr",
    )
    documents: list[CurriculumBudgetEvaluationDocument] = []
    for title in _DEFAULT_RUNTIME_TITLES:
        manifest_document = next(item for item in manifest.documents if item.title == title)
        document_input = _build_split_manifest_document_input(
            raw_asset_record=raw_asset_record,
            manifest_version=manifest.manifest_version,
            manifest_document=manifest_document,
            structured_rows=layout_rows,
            provider_response_key="official_pdf/curriculum-plan/synthetic/sha256/test/provider/vlm/provider-response.jsonl",
            layout_elements_key="official_pdf/curriculum-plan/synthetic/sha256/test/source-truth/layout-elements.jsonl",
            default_visibility_scope=None,
            corpus="curriculum",
            collection="curriculum_plan",
            row_policy=CURRICULUM_SPLIT_MANIFEST_ROW_POLICY,
        )
        entitlement_groups = tuple(document_input.metadata.get("entitlement_groups") or ())
        visibility_scope = (
            str(document_input.metadata["visibility_scope"])
            if document_input.metadata.get("visibility_scope") is not None
            else None
        )
        record = DocumentRegistryRecord(
            document_id=manifest_document.document_id,
            revision_track="source-faithful",
            version_id=str(document_input.metadata["version_id"]),
            source_uri=str(
                document_input.metadata.get("source_url")
                or document_input.metadata.get("source_id")
                or ""
            ),
            content_hash=hashlib.sha256(document_input.document_units_bytes).hexdigest(),
            corpus="curriculum",
            collection="curriculum_plan",
            cleaning_policy_version=CURRICULUM_CLEANING_POLICY_VERSION,
            entitlement_groups=entitlement_groups,
            visibility_scope=visibility_scope,
            visibility_level=str(document_input.metadata.get("visibility_level") or ""),
            status=str(document_input.metadata.get("status") or "active"),
            ingestion_timestamp="2026-03-27T12:00:00+00:00",
            parser_version=MINERU_ADAPTED_PARSER_VERSION,
            embedding_model=_DEFAULT_EMBEDDING_MODEL,
            source_channel="pdf_ocr",
            is_current=True,
            document_units_object_key=(
                f"curriculum/documents/{manifest_document.document_id}/document-units.jsonl"
            ),
            processed_object_keys=(
                f"curriculum/documents/{manifest_document.document_id}/document-units.jsonl",
            ),
            import_source="raw_online_ocr",
        )
        documents.append(
            CurriculumBudgetEvaluationDocument(
                tier="runtime",
                label=title,
                title=title,
                record=record,
                structured_jsonl_bytes=document_input.document_units_bytes,
                probe_cases=_default_runtime_probe_cases(title),
            )
        )
    return tuple(documents)


def _load_historical_sample_documents() -> tuple[CurriculumBudgetEvaluationDocument, ...]:
    sample_index = json.loads(_DEFAULT_SAMPLE_INDEX_PATH.read_text(encoding="utf-8"))
    documents: list[CurriculumBudgetEvaluationDocument] = []
    for sample in list(sample_index.get("samples") or []):
        title = str(sample["title"])
        label = str(sample["label"])
        path = _REPO_ROOT / str(sample["path"])
        structured_jsonl_bytes = _normalize_historical_sample_bytes(
            path.read_bytes(),
            document_title=title,
        )
        record = DocumentRegistryRecord(
            document_id=str(sample["document_id"]),
            revision_track="source-faithful",
            version_id=str(sample["version_id"]),
            source_uri=str(sample["source_uri"]),
            content_hash=hashlib.sha256(structured_jsonl_bytes).hexdigest(),
            corpus="curriculum",
            collection="curriculum_plan",
            cleaning_policy_version=CURRICULUM_CLEANING_POLICY_VERSION,
            entitlement_groups=(),
            visibility_scope=None,
            status="active",
            ingestion_timestamp="2026-03-27T12:00:00+00:00",
            parser_version="provider-response-replay",
            embedding_model=_DEFAULT_EMBEDDING_MODEL,
            source_channel="pdf_ocr",
            is_current=True,
            document_units_object_key=str(sample["path"]),
            processed_object_keys=(str(sample["path"]),),
            import_source="provider_response_replay",
        )
        documents.append(
            CurriculumBudgetEvaluationDocument(
                tier="historical",
                label=label,
                title=title,
                record=record,
                structured_jsonl_bytes=structured_jsonl_bytes,
                probe_cases=_default_historical_probe_cases(title=title, label=label),
            )
        )
    return tuple(documents)


def _default_runtime_probe_cases(title: str) -> tuple[CurriculumBudgetProbeCase, ...]:
    if title == "示例公共事务本科人才培养方案":
        return (
            CurriculumBudgetProbeCase(
                case_id="synthetic-public-affairs-core-course",
                query="公共问题分析课程学分",
                expected_keywords=("公共问题分析", "2"),
                required_headings=("五、课程设置和修读建议", "2. 学科基础教育"),
                preferred_unit_type="table_unit",
            ),
            CurriculumBudgetProbeCase(
                case_id="synthetic-public-affairs-advanced-course",
                query="证据评估工作坊在哪个建议课程清单里",
                expected_keywords=("证据评估工作坊", "建议课程清单"),
                required_headings=("五、课程设置和修读建议", "(三)个性化培养"),
                preferred_unit_type="table_unit",
            ),
        )
    if title == "示例数据系统本科人才培养方案":
        return (
            CurriculumBudgetProbeCase(
                case_id="synthetic-data-systems-course",
                query="数据系统专题12在哪个课程表里",
                expected_keywords=("数据系统专题12", "课程号"),
                preferred_unit_type="table_unit",
            ),
            CurriculumBudgetProbeCase(
                case_id="synthetic-data-systems-practice",
                query="创新实践必修几学分",
                expected_keywords=("创新实践", "2学分"),
                required_headings=("3.创新创业实践",),
                preferred_unit_type="section_text",
            ),
        )
    return ()


def _default_historical_probe_cases(
    *,
    title: str,
    label: str,
) -> tuple[CurriculumBudgetProbeCase, ...]:
    if title == "示例大学通识课程综合素养课建设方案":
        return (
            CurriculumBudgetProbeCase(
                case_id="narrative-five-categories",
                query="综合素养课分为哪五大类",
                expected_keywords=("五大类", "科学素养类", "劳动教育类"),
                required_headings=("二、课程设计", "(一)课程内容"),
                preferred_unit_type="section_text",
            ),
        )
    if title == "示例大学通识课程思想政治理论课教学计划":
        return (
            CurriculumBudgetProbeCase(
                case_id="ideology-zhonghua-semester",
                query="中华民族共同体概论开设学期",
                expected_keywords=("中华民族共同体概论", "第4学期"),
                required_headings=("二、课程设计", "(三) 学时学分设置"),
                preferred_unit_type="table_unit",
            ),
        )
    if title == "财政学本科人才培养方案":
        return (
            CurriculumBudgetProbeCase(
                case_id="finance-advanced-econometrics",
                query="高级计量经济学在哪个建议课程清单里",
                expected_keywords=("高级计量经济学", "建议续深造学生选修"),
                required_headings=("五、课程设置和修读建议", "(三)个性化培养"),
                preferred_unit_type="table_unit",
            ),
        )
    if title == "孝通实验班本科人才培养方案":
        return (
            CurriculumBudgetProbeCase(
                case_id="xiaotong-aging-health-major",
                query="老龄化与健康在哪个专业名称下",
                expected_keywords=("老龄化与健康", "民族学、社会学类"),
                required_headings=("五、课程设置和修读建议", "(二)专业教育"),
                preferred_unit_type="table_unit",
            ),
        )
    if title == "中国少数民族语言文学本科人才培养方案":
        return (
            CurriculumBudgetProbeCase(
                case_id="minority-language-classical-chinese",
                query="古代汉语在哪个学科基础教育课程清单里",
                expected_keywords=("古代汉语", "课程清单如下"),
                required_headings=("五、课程设置和修读建议", "2. 学科基础教育"),
                preferred_unit_type="table_unit",
            ),
        )
    if title == "中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案":
        return (
            CurriculumBudgetProbeCase(
                case_id="minority-paleography-china-history",
                query="中国通史在哪个学科基础教育课程清单里",
                expected_keywords=("中国通史", "学科基础教育板块应修21学分"),
                required_headings=("五、课程设置和修读建议", "2. 学科基础教育"),
                preferred_unit_type="table_unit",
            ),
        )
    if label:
        return ()
    return ()


def _normalize_historical_sample_bytes(
    payload: bytes,
    *,
    document_title: str,
) -> bytes:
    normalized_rows: list[str] = []
    for index, line in enumerate(payload.decode("utf-8").splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            continue
        raw = json.loads(stripped)
        if str(raw.get("chunk_id") or "").strip() == "document-0000":
            continue
        if raw.get("row_id") and raw.get("row_type"):
            normalized_rows.append(json.dumps(raw, ensure_ascii=False))
            continue
        clean_text = str(raw.get("clean_text") or "").strip()
        chunk_id = (
            str(raw.get("chunk_id") or f"historical-{index:04d}").strip()
            or f"historical-{index:04d}"
        )
        row_id = f"{chunk_id}-row-{index:04d}"
        row_type = _infer_historical_row_type(clean_text=clean_text, document_title=document_title)
        normalized: dict[str, object] = {
            **raw,
            "row_id": row_id,
            "chunk_id": row_id,
            "row_type": row_type,
        }
        if row_type == "heading":
            normalized["heading_level"] = _infer_historical_heading_level(
                clean_text=clean_text,
                document_title=document_title,
            )
        elif row_type == "table":
            normalized["html"] = clean_text
            normalized["continuation_group_id"] = row_id
        normalized_rows.append(json.dumps(normalized, ensure_ascii=False))
    return ("\n".join(normalized_rows) + "\n").encode("utf-8")


def _infer_historical_row_type(*, clean_text: str, document_title: str) -> str:
    if not clean_text:
        return "paragraph"
    if clean_text.startswith("<table"):
        return "table"
    if clean_text == document_title:
        return "heading"
    if clean_text.isdigit() and len(clean_text) <= 4:
        return "page_number"
    if _looks_like_curriculum_structure_heading(clean_text):
        return "heading"
    return "paragraph"


def _infer_historical_heading_level(*, clean_text: str, document_title: str) -> int:
    if clean_text == document_title:
        return 1
    if clean_text.startswith(("（", "(")) or clean_text[:1].isdigit():
        return 3
    return 2


__all__ = [
    "load_default_curriculum_budget_evaluation_documents",
    "load_historical_curriculum_budget_evaluation_documents",
    "load_runtime_curriculum_budget_evaluation_documents",
]
