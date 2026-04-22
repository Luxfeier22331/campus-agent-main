from __future__ import annotations

import hashlib
import json

from campus_ingestion_core.chunking import CURRICULUM_CLEANING_POLICY_VERSION
from campus_ingestion_core.curriculum_budget_evaluation_shared import (
    _DEFAULT_EMBEDDING_MODEL,
    _DEFAULT_LAYOUT_FIXTURE_PATH,
    _DEFAULT_RUNTIME_TITLES,
    _DEFAULT_SAMPLE_INDEX_PATH,
    _DEFAULT_SPLIT_MANIFEST_PATH,
    _REPO_ROOT,
    CurriculumBudgetEvaluationDocument,
    CurriculumBudgetProbeCase,
)
from campus_ingestion_core.curriculum_chunk_units import _looks_like_curriculum_structure_heading
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.raw_ingestion import (
    _build_split_manifest_document_input,
    _load_layout_elements_rows,
)
from campus_ingestion_core.split_manifest import load_split_manifest


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
    manifest = load_split_manifest(
        _DEFAULT_SPLIT_MANIFEST_PATH,
        expected_corpus="curriculum",
        expected_collection="curriculum_plan",
    )
    layout_rows = _load_layout_elements_rows(_DEFAULT_LAYOUT_FIXTURE_PATH.read_bytes())
    raw_asset_record = RawAssetRecord(
        raw_asset_id="asset:curriculum-plan-2022",
        raw_version_id="sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67",
        corpus="curriculum",
        collection="curriculum_plan",
        raw_source_uri="file:///tmp/curriculum-plan-2022.pdf",
        content_hash="0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67",
        source_filename="curriculum-plan-2022.pdf",
        object_key="official_pdf/curriculum-plan/2022/sha256/test/capture/curriculum-plan-2022.pdf",
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
            provider_response_key="official_pdf/curriculum-plan/2022/sha256/test/provider/vlm/provider-response.jsonl",
            layout_elements_key="official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
            default_visibility_scope=None,
            corpus="curriculum",
            collection="curriculum_plan",
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
            parser_version="mineru-vlm-adapted-v1",
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
    if title == "国际经济与贸易本科人才培养方案":
        return (
            CurriculumBudgetProbeCase(
                case_id="trade-elective-module",
                query="国际贸易概论属于哪个模块",
                expected_keywords=("国际贸易概论", "模块一:国际经贸类"),
                required_headings=("五、课程设置和修读建议", "2. 专业选修课程"),
                preferred_unit_type="table_unit",
            ),
            CurriculumBudgetProbeCase(
                case_id="trade-advanced-micro",
                query="高级微观经济学在哪个建议课程清单里",
                expected_keywords=("高级微观经济学", "建议课程清单"),
                required_headings=("五、课程设置和修读建议", "(三)个性化培养"),
                preferred_unit_type="table_unit",
            ),
        )
    if title == "经济学拔尖人才创新班人才培养方案":
        return (
            CurriculumBudgetProbeCase(
                case_id="economics-history-module",
                query="中国近现代经济史属于哪个模块",
                expected_keywords=("中国近现代经济史", "模块一:经济史及世界经济"),
                required_headings=("五、课程设置和修读建议", "2. 专业选修课程"),
                preferred_unit_type="table_unit",
            ),
            CurriculumBudgetProbeCase(
                case_id="economics-experimental",
                query="实验经济学在哪个建议课程清单里",
                expected_keywords=("实验经济学", "建议续深造学生选修期"),
                required_headings=("五、课程设置和修读建议", "(三)个性化培养"),
                preferred_unit_type="table_unit",
            ),
        )
    return ()


def _default_historical_probe_cases(
    *,
    title: str,
    label: str,
) -> tuple[CurriculumBudgetProbeCase, ...]:
    if title == "中央民族大学通识课程综合素养课建设方案":
        return (
            CurriculumBudgetProbeCase(
                case_id="narrative-five-categories",
                query="综合素养课分为哪五大类",
                expected_keywords=("五大类", "科学素养类", "劳动教育类"),
                required_headings=("二、课程设计", "(一)课程内容"),
                preferred_unit_type="section_text",
            ),
        )
    if title == "中央民族大学通识课程思想政治理论课教学计划":
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
