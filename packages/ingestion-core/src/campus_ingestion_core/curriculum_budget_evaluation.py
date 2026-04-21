from __future__ import annotations

import hashlib
import json
import math
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

from campus_ingestion_core.chunking import (
    CURRICULUM_CLEANING_POLICY_VERSION,
    ChunkProfile,
    CurriculumChunkingStrategy,
    build_chunk_text_context,
    build_curriculum_chunk_profile,
)
from campus_ingestion_core.curriculum_chunk_units import (
    _is_table_cue_row,
    _looks_like_curriculum_structure_heading,
    build_curriculum_structured_units,
    chunk_curriculum_unit,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.process import (
    _build_chunk_text,
    _ChunkCandidate,
    _ChunkMember,
    _merge_adjacent_curriculum_table_candidates,
    _merge_adjacent_short_textual_candidates,
)
from campus_ingestion_core.raw_ingestion import (
    _build_split_manifest_document_input,
    _load_layout_elements_rows,
)
from campus_ingestion_core.split_manifest import load_split_manifest

_REPO_ROOT = Path(__file__).resolve().parents[4]
_DEFAULT_SAMPLE_INDEX_PATH = (
    _REPO_ROOT / "configs/ingestion/curriculum/curriculum_plan/samples/index.json"
)
_DEFAULT_SPLIT_MANIFEST_PATH = (
    _REPO_ROOT / "configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json"
)
_DEFAULT_LAYOUT_FIXTURE_PATH = (
    _REPO_ROOT / "tests/fixtures/curriculum_plan/layout-elements.pages-278-297.jsonl"
)
_DEFAULT_RUNTIME_TITLES = (
    "国际经济与贸易本科人才培养方案",
    "经济学拔尖人才创新班人才培养方案",
)
_DEFAULT_EMBEDDING_MODEL = "Qwen3-Embedding-4B"


@dataclass(frozen=True, slots=True)
class CurriculumBudgetProfileSpec:
    chunk_size: int
    max_chunk_size: int
    chunk_overlap: int
    min_chunk_size: int


@dataclass(frozen=True, slots=True)
class CurriculumBudgetCandidate:
    name: str
    default_profile: CurriculumBudgetProfileSpec
    table_profile: CurriculumBudgetProfileSpec | None = None


@dataclass(frozen=True, slots=True)
class CurriculumBudgetEvaluationDocument:
    tier: str
    label: str
    title: str
    record: DocumentRegistryRecord
    structured_jsonl_bytes: bytes
    probe_cases: tuple["CurriculumBudgetProbeCase", ...] = ()


@dataclass(frozen=True, slots=True)
class CurriculumBudgetProbeCase:
    case_id: str
    query: str
    expected_keywords: tuple[str, ...]
    required_headings: tuple[str, ...] = ()
    preferred_unit_type: str | None = None


@dataclass(frozen=True, slots=True)
class CurriculumBudgetProbeResult:
    case_id: str
    query: str
    top_chunk_order: int | None
    top_unit_type: str | None
    top_score: float
    keyword_hit_count: int
    expected_keyword_count: int
    keyword_hit_at_1: bool
    keyword_hit_at_3: bool
    required_heading_hit_at_1: bool
    required_heading_hit_at_3: bool
    preferred_unit_type_hit_at_1: bool
    preferred_unit_type_hit_at_3: bool
    complete_hit_at_1: bool
    complete_hit_at_3: bool
    top_preview: str


@dataclass(frozen=True, slots=True)
class CurriculumBudgetProbeSummary:
    total_cases: int
    keyword_hit_at_1_count: int
    keyword_hit_at_3_count: int
    required_heading_hit_at_1_count: int
    required_heading_hit_at_3_count: int
    preferred_unit_type_hit_at_1_count: int
    preferred_unit_type_hit_at_3_count: int
    complete_hit_at_1_count: int
    complete_hit_at_3_count: int


@dataclass(frozen=True, slots=True)
class CurriculumBudgetTokenSummary:
    min: int
    p50: int
    p90: int
    p95: int
    p99: int
    max: int


@dataclass(frozen=True, slots=True)
class CurriculumBudgetIssueExample:
    chunk_order: int
    unit_type: str
    issue_types: tuple[str, ...]
    final_token_count: int
    budget_max: int
    preview: str


@dataclass(frozen=True, slots=True)
class CurriculumBudgetDocumentResult:
    tier: str
    label: str
    document_id: str
    title: str
    total_units: int
    total_chunks: int
    chunk_delta_vs_units: int
    oversize_chunk_count: int
    orphan_heading_only_count: int
    cue_only_chunk_count: int
    missing_top_parent_count: int
    missing_any_structural_heading_count: int
    unit_type_counts: dict[str, int]
    chunk_unit_type_counts: dict[str, int]
    display_tokens: CurriculumBudgetTokenSummary
    final_tokens: CurriculumBudgetTokenSummary
    probe_summary: CurriculumBudgetProbeSummary
    probe_results: tuple[CurriculumBudgetProbeResult, ...]
    issue_examples: tuple[CurriculumBudgetIssueExample, ...]


@dataclass(frozen=True, slots=True)
class CurriculumBudgetAggregate:
    document_count: int
    total_units: int
    total_chunks: int
    chunk_delta_vs_units: int
    oversize_chunk_count: int
    orphan_heading_only_count: int
    cue_only_chunk_count: int
    missing_top_parent_count: int
    missing_any_structural_heading_count: int
    display_tokens: CurriculumBudgetTokenSummary
    final_tokens: CurriculumBudgetTokenSummary
    probe_summary: CurriculumBudgetProbeSummary


@dataclass(frozen=True, slots=True)
class CurriculumBudgetCandidateResult:
    name: str
    default_profile: CurriculumBudgetProfileSpec
    table_profile: CurriculumBudgetProfileSpec | None
    aggregate: CurriculumBudgetAggregate
    tier_aggregates: dict[str, CurriculumBudgetAggregate]
    documents: tuple[CurriculumBudgetDocumentResult, ...]


@dataclass(frozen=True, slots=True)
class CurriculumBudgetEvaluationReport:
    generated_at: str
    document_count: int
    candidate_count: int
    candidates: tuple[CurriculumBudgetCandidateResult, ...]


@dataclass(frozen=True, slots=True)
class _EvaluatedDocument:
    result: CurriculumBudgetDocumentResult
    display_tokens: tuple[int, ...]
    final_tokens: tuple[int, ...]


def build_default_curriculum_budget_candidates() -> tuple[CurriculumBudgetCandidate, ...]:
    baseline = CurriculumBudgetProfileSpec(
        chunk_size=360,
        max_chunk_size=540,
        chunk_overlap=72,
        min_chunk_size=50,
    )
    return (
        CurriculumBudgetCandidate(name="baseline-uniform", default_profile=baseline),
        CurriculumBudgetCandidate(
            name="uniform-moderate",
            default_profile=CurriculumBudgetProfileSpec(
                chunk_size=384,
                max_chunk_size=576,
                chunk_overlap=64,
                min_chunk_size=64,
            ),
        ),
        CurriculumBudgetCandidate(
            name="uniform-large",
            default_profile=CurriculumBudgetProfileSpec(
                chunk_size=420,
                max_chunk_size=640,
                chunk_overlap=72,
                min_chunk_size=64,
            ),
        ),
        CurriculumBudgetCandidate(
            name="v2-table-balanced",
            default_profile=baseline,
            table_profile=CurriculumBudgetProfileSpec(
                chunk_size=420,
                max_chunk_size=640,
                chunk_overlap=72,
                min_chunk_size=64,
            ),
        ),
        CurriculumBudgetCandidate(
            name="v2-table-relaxed",
            default_profile=baseline,
            table_profile=CurriculumBudgetProfileSpec(
                chunk_size=480,
                max_chunk_size=720,
                chunk_overlap=96,
                min_chunk_size=64,
            ),
        ),
    )


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


def evaluate_curriculum_budget_candidates(
    *,
    output_dir: Path,
    candidates: Sequence[CurriculumBudgetCandidate] | None = None,
    documents: Sequence[CurriculumBudgetEvaluationDocument] | None = None,
) -> CurriculumBudgetEvaluationReport:
    runtime_candidates = tuple(candidates or build_default_curriculum_budget_candidates())
    runtime_documents = tuple(documents or load_default_curriculum_budget_evaluation_documents())
    results = tuple(
        _evaluate_candidate(candidate=candidate, documents=runtime_documents)
        for candidate in runtime_candidates
    )
    report = CurriculumBudgetEvaluationReport(
        generated_at=datetime.now(timezone.utc).isoformat(),
        document_count=len(runtime_documents),
        candidate_count=len(results),
        candidates=results,
    )
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    (output_path / "budget-eval-matrix.json").write_text(
        json.dumps(asdict(report), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output_path / "budget-eval-report.md").write_text(
        _render_budget_eval_report(report=report),
        encoding="utf-8",
    )
    return report


def _evaluate_candidate(
    *,
    candidate: CurriculumBudgetCandidate,
    documents: Sequence[CurriculumBudgetEvaluationDocument],
) -> CurriculumBudgetCandidateResult:
    evaluated_documents = tuple(
        _evaluate_document(candidate=candidate, document=document) for document in documents
    )
    document_results = tuple(item.result for item in evaluated_documents)
    tier_aggregates = {
        tier: _aggregate_evaluated_documents(
            tuple(item for item in evaluated_documents if item.result.tier == tier)
        )
        for tier in sorted({document.tier for document in document_results})
    }
    return CurriculumBudgetCandidateResult(
        name=candidate.name,
        default_profile=candidate.default_profile,
        table_profile=candidate.table_profile,
        aggregate=_aggregate_evaluated_documents(evaluated_documents),
        tier_aggregates=tier_aggregates,
        documents=document_results,
    )


def _evaluate_document(
    *,
    candidate: CurriculumBudgetCandidate,
    document: CurriculumBudgetEvaluationDocument,
) -> _EvaluatedDocument:
    units = build_curriculum_structured_units(
        record=document.record,
        structured_jsonl_bytes=document.structured_jsonl_bytes,
    )
    raw_candidates: list[_ChunkCandidate] = []
    unit_type_counts = Counter(unit.unit_type for unit in units)
    for unit in units:
        profile = _resolve_profile(
            candidate=candidate, record=document.record, unit_type=unit.unit_type
        )
        pieces = chunk_curriculum_unit(unit=unit, chunk_profile=profile)
        context_plan = build_chunk_text_context(anchor=unit.anchor, metadata=unit.metadata)
        for piece in pieces:
            chunk_assembly = _build_chunk_text(
                unit=unit,
                piece=piece,
                chunk_profile=profile,
                context_plan=context_plan,
            )
            raw_candidates.append(
                _ChunkCandidate(
                    unit_type=piece.unit_type,
                    root_unit_id=piece.root_unit_id,
                    source_chunk_id=unit.source_chunk_id,
                    visibility_level=unit.visibility_level,
                    anchor=dict(unit.anchor),
                    metadata=dict(unit.metadata),
                    piece=piece,
                    chunk_assembly=chunk_assembly,
                    members=(_ChunkMember(unit=unit, piece=piece),),
                )
            )
    merged = _merge_adjacent_short_textual_candidates(
        chunk_candidates=tuple(raw_candidates),
        chunk_profile=_resolve_profile(
            candidate=candidate, record=document.record, unit_type="section_text"
        ),
    )
    merged = _merge_adjacent_curriculum_table_candidates(
        chunk_candidates=merged,
        chunk_profile=_resolve_profile(
            candidate=candidate, record=document.record, unit_type="table_unit"
        ),
    )
    display_tokens: list[int] = []
    final_tokens: list[int] = []
    chunk_unit_type_counts: Counter[str] = Counter()
    oversize_chunk_count = 0
    orphan_heading_only_count = 0
    cue_only_chunk_count = 0
    missing_top_parent_count = 0
    missing_any_structural_heading_count = 0
    issue_examples: list[CurriculumBudgetIssueExample] = []
    probe_results = _evaluate_probe_cases(
        probe_cases=document.probe_cases,
        chunk_candidates=merged,
    )

    for chunk_order, chunk_candidate in enumerate(merged, start=1):
        unit_type = chunk_candidate.piece.unit_type
        profile = _resolve_profile(candidate=candidate, record=document.record, unit_type=unit_type)
        display_token_count = int(chunk_candidate.chunk_assembly.display_token_count)
        final_token_count = int(chunk_candidate.chunk_assembly.total_token_count)
        display_tokens.append(display_token_count)
        final_tokens.append(final_token_count)
        chunk_unit_type_counts[unit_type] += 1

        issue_types: list[str] = []
        if final_token_count > profile.max_chunk_size:
            oversize_chunk_count += 1
            issue_types.append("oversize")
        if _is_orphan_heading_only_chunk(chunk_candidate):
            orphan_heading_only_count += 1
            issue_types.append("orphan_heading_only")
        if _is_cue_only_chunk(chunk_candidate):
            cue_only_chunk_count += 1
            issue_types.append("cue_only")
        if _missing_top_parent_context(chunk_candidate):
            missing_top_parent_count += 1
            issue_types.append("missing_top_parent")
        if _missing_any_structural_heading(chunk_candidate):
            missing_any_structural_heading_count += 1
            issue_types.append("missing_any_structural_heading")
        if issue_types:
            issue_examples.append(
                CurriculumBudgetIssueExample(
                    chunk_order=chunk_order,
                    unit_type=unit_type,
                    issue_types=tuple(issue_types),
                    final_token_count=final_token_count,
                    budget_max=profile.max_chunk_size,
                    preview=_preview_text(chunk_candidate.chunk_assembly.text),
                )
            )

    return _EvaluatedDocument(
        result=CurriculumBudgetDocumentResult(
            tier=document.tier,
            label=document.label,
            document_id=document.record.document_id,
            title=document.title,
            total_units=len(units),
            total_chunks=len(merged),
            chunk_delta_vs_units=len(merged) - len(units),
            oversize_chunk_count=oversize_chunk_count,
            orphan_heading_only_count=orphan_heading_only_count,
            cue_only_chunk_count=cue_only_chunk_count,
            missing_top_parent_count=missing_top_parent_count,
            missing_any_structural_heading_count=missing_any_structural_heading_count,
            unit_type_counts=dict(sorted(unit_type_counts.items())),
            chunk_unit_type_counts=dict(sorted(chunk_unit_type_counts.items())),
            display_tokens=_summarize_tokens(display_tokens),
            final_tokens=_summarize_tokens(final_tokens),
            probe_summary=_summarize_probe_results(probe_results),
            probe_results=probe_results,
            issue_examples=tuple(issue_examples[:12]),
        ),
        display_tokens=tuple(display_tokens),
        final_tokens=tuple(final_tokens),
    )


def _resolve_profile(
    *,
    candidate: CurriculumBudgetCandidate,
    record: DocumentRegistryRecord,
    unit_type: str,
) -> ChunkProfile:
    profile_spec = (
        candidate.table_profile
        if unit_type == "table_unit" and candidate.table_profile is not None
        else candidate.default_profile
    )
    base_profile = build_curriculum_chunk_profile(model_name=record.embedding_model or None)
    return ChunkProfile(
        chunk_size=profile_spec.chunk_size,
        max_chunk_size=profile_spec.max_chunk_size,
        chunk_overlap=profile_spec.chunk_overlap,
        min_chunk_size=profile_spec.min_chunk_size,
        split_strategy=base_profile.split_strategy,
        chunk_policy_version=base_profile.chunk_policy_version,
        cleaning_policy_version=CURRICULUM_CLEANING_POLICY_VERSION,
        strategy_name=base_profile.strategy_name,
        strategy=CurriculumChunkingStrategy(),
        token_counter=base_profile.token_counter,
        tokenizer_name=base_profile.tokenizer_name,
        final_text_aware=base_profile.final_text_aware,
        safety_margin=base_profile.safety_margin,
    )


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
            provider_response_key="official_pdf/curriculum-plan/2022/sha256/test/provider/paddleocr-vl-1-5/provider-response.jsonl",
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
            parser_version="raw-online-ocr-v1",
            embedding_model=_DEFAULT_EMBEDDING_MODEL,
            source_channel="pdf_ocr",
            is_current=True,
            document_units_object_key=f"curriculum/documents/{manifest_document.document_id}/document-units.jsonl",
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
        entitlement_groups = ()
        visibility_scope = None
        record = DocumentRegistryRecord(
            document_id=str(sample["document_id"]),
            revision_track="source-faithful",
            version_id=str(sample["version_id"]),
            source_uri=str(sample["source_uri"]),
            content_hash=hashlib.sha256(structured_jsonl_bytes).hexdigest(),
            corpus="curriculum",
            collection="curriculum_plan",
            cleaning_policy_version=CURRICULUM_CLEANING_POLICY_VERSION,
            entitlement_groups=entitlement_groups,
            visibility_scope=visibility_scope,
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


def _evaluate_probe_cases(
    *,
    probe_cases: tuple[CurriculumBudgetProbeCase, ...],
    chunk_candidates: Sequence[_ChunkCandidate],
) -> tuple[CurriculumBudgetProbeResult, ...]:
    if not probe_cases:
        return ()
    ranked_candidates = tuple(
        (index, candidate) for index, candidate in enumerate(chunk_candidates, start=1)
    )
    results: list[CurriculumBudgetProbeResult] = []
    for probe_case in probe_cases:
        ranked = sorted(
            (
                (
                    index,
                    candidate,
                    _curriculum_probe_score(probe_case.query, candidate.chunk_assembly.text),
                )
                for index, candidate in ranked_candidates
            ),
            key=lambda item: (item[2], -item[0]),
            reverse=True,
        )
        ranked = [item for item in ranked if item[2] > 0]
        top_ranked = ranked[0] if ranked else None
        top_chunk_order = top_ranked[0] if top_ranked is not None else None
        top_candidate = top_ranked[1] if top_ranked is not None else None
        top_score = round(float(top_ranked[2]), 3) if top_ranked is not None else 0.0
        keyword_hit_count = (
            _probe_keyword_hit_count(
                probe_case.expected_keywords, top_candidate.chunk_assembly.text
            )
            if top_candidate is not None
            else 0
        )
        keyword_hit_at_1 = (
            keyword_hit_count == len(probe_case.expected_keywords)
            if probe_case.expected_keywords
            else True
        )
        required_heading_hit_at_1 = (
            _probe_heading_hit(probe_case.required_headings, top_candidate.chunk_assembly.text)
            if top_candidate is not None
            else False
        )
        preferred_unit_type_hit_at_1 = (
            _probe_preferred_unit_type_hit(probe_case.preferred_unit_type, top_candidate)
            if top_candidate is not None
            else False
        )
        results.append(
            CurriculumBudgetProbeResult(
                case_id=probe_case.case_id,
                query=probe_case.query,
                top_chunk_order=top_chunk_order,
                top_unit_type=top_candidate.piece.unit_type if top_candidate is not None else None,
                top_score=top_score,
                keyword_hit_count=keyword_hit_count,
                expected_keyword_count=len(probe_case.expected_keywords),
                keyword_hit_at_1=keyword_hit_at_1,
                keyword_hit_at_3=_probe_any_hit_in_ranked(
                    ranked=ranked[:3],
                    predicate=lambda candidate: _probe_keyword_hit(
                        probe_case.expected_keywords,
                        candidate.chunk_assembly.text,
                    ),
                ),
                required_heading_hit_at_1=required_heading_hit_at_1,
                required_heading_hit_at_3=_probe_any_hit_in_ranked(
                    ranked=ranked[:3],
                    predicate=lambda candidate: _probe_heading_hit(
                        probe_case.required_headings,
                        candidate.chunk_assembly.text,
                    ),
                ),
                preferred_unit_type_hit_at_1=preferred_unit_type_hit_at_1,
                preferred_unit_type_hit_at_3=_probe_any_hit_in_ranked(
                    ranked=ranked[:3],
                    predicate=lambda candidate: _probe_preferred_unit_type_hit(
                        probe_case.preferred_unit_type,
                        candidate,
                    ),
                ),
                complete_hit_at_1=(
                    keyword_hit_at_1 and required_heading_hit_at_1 and preferred_unit_type_hit_at_1
                ),
                complete_hit_at_3=_probe_any_hit_in_ranked(
                    ranked=ranked[:3],
                    predicate=lambda candidate: _probe_complete_hit(
                        probe_case,
                        candidate,
                    ),
                ),
                top_preview=_preview_text(top_candidate.chunk_assembly.text)
                if top_candidate is not None
                else "",
            )
        )
    return tuple(results)


def _curriculum_probe_score(query: str, text: str) -> float:
    normalized_query = _normalize_probe_text(query)
    normalized_text = _normalize_probe_text(text)
    if not normalized_query or not normalized_text:
        return 0.0
    query_unigrams = set(normalized_query)
    text_unigrams = set(normalized_text)
    query_bigrams = _build_character_ngrams(normalized_query, 2)
    text_bigrams = _build_character_ngrams(normalized_text, 2)
    query_trigrams = _build_character_ngrams(normalized_query, 3)
    text_trigrams = _build_character_ngrams(normalized_text, 3)
    exact_bonus = 24.0 if normalized_query in normalized_text else 0.0
    return (
        exact_bonus
        + float(len(query_trigrams & text_trigrams) * 8)
        + float(len(query_bigrams & text_bigrams) * 3)
        + float(len(query_unigrams & text_unigrams)) * 0.25
    )


def _normalize_probe_text(text: str) -> str:
    return "".join(
        char.lower() for char in text if char.isalnum() or ("\u4e00" <= char <= "\u9fff")
    )


def _build_character_ngrams(text: str, size: int) -> set[str]:
    if len(text) < size:
        return {text} if text else set()
    return {text[index : index + size] for index in range(0, len(text) - size + 1)}


def _probe_any_hit_in_ranked(
    *,
    ranked: Sequence[tuple[int, _ChunkCandidate, float]],
    predicate,
) -> bool:
    return any(predicate(candidate) for _, candidate, _ in ranked)


def _probe_keyword_hit(expected_keywords: tuple[str, ...], text: str) -> bool:
    if not expected_keywords:
        return True
    return all(keyword in text for keyword in expected_keywords)


def _probe_keyword_hit_count(expected_keywords: tuple[str, ...], text: str) -> int:
    return sum(1 for keyword in expected_keywords if keyword in text)


def _probe_heading_hit(required_headings: tuple[str, ...], text: str) -> bool:
    if not required_headings:
        return True
    return all(heading in text for heading in required_headings)


def _probe_preferred_unit_type_hit(
    preferred_unit_type: str | None,
    candidate: _ChunkCandidate,
) -> bool:
    if preferred_unit_type is None:
        return True
    return candidate.piece.unit_type == preferred_unit_type


def _probe_complete_hit(
    probe_case: CurriculumBudgetProbeCase,
    candidate: _ChunkCandidate,
) -> bool:
    text = candidate.chunk_assembly.text
    return (
        _probe_keyword_hit(probe_case.expected_keywords, text)
        and _probe_heading_hit(probe_case.required_headings, text)
        and _probe_preferred_unit_type_hit(probe_case.preferred_unit_type, candidate)
    )


def _summarize_probe_results(
    probe_results: tuple[CurriculumBudgetProbeResult, ...],
) -> CurriculumBudgetProbeSummary:
    return CurriculumBudgetProbeSummary(
        total_cases=len(probe_results),
        keyword_hit_at_1_count=sum(1 for item in probe_results if item.keyword_hit_at_1),
        keyword_hit_at_3_count=sum(1 for item in probe_results if item.keyword_hit_at_3),
        required_heading_hit_at_1_count=sum(
            1 for item in probe_results if item.required_heading_hit_at_1
        ),
        required_heading_hit_at_3_count=sum(
            1 for item in probe_results if item.required_heading_hit_at_3
        ),
        preferred_unit_type_hit_at_1_count=sum(
            1 for item in probe_results if item.preferred_unit_type_hit_at_1
        ),
        preferred_unit_type_hit_at_3_count=sum(
            1 for item in probe_results if item.preferred_unit_type_hit_at_3
        ),
        complete_hit_at_1_count=sum(1 for item in probe_results if item.complete_hit_at_1),
        complete_hit_at_3_count=sum(1 for item in probe_results if item.complete_hit_at_3),
    )


def _aggregate_probe_summaries(
    probe_summaries: tuple[CurriculumBudgetProbeSummary, ...],
) -> CurriculumBudgetProbeSummary:
    return CurriculumBudgetProbeSummary(
        total_cases=sum(item.total_cases for item in probe_summaries),
        keyword_hit_at_1_count=sum(item.keyword_hit_at_1_count for item in probe_summaries),
        keyword_hit_at_3_count=sum(item.keyword_hit_at_3_count for item in probe_summaries),
        required_heading_hit_at_1_count=sum(
            item.required_heading_hit_at_1_count for item in probe_summaries
        ),
        required_heading_hit_at_3_count=sum(
            item.required_heading_hit_at_3_count for item in probe_summaries
        ),
        preferred_unit_type_hit_at_1_count=sum(
            item.preferred_unit_type_hit_at_1_count for item in probe_summaries
        ),
        preferred_unit_type_hit_at_3_count=sum(
            item.preferred_unit_type_hit_at_3_count for item in probe_summaries
        ),
        complete_hit_at_1_count=sum(item.complete_hit_at_1_count for item in probe_summaries),
        complete_hit_at_3_count=sum(item.complete_hit_at_3_count for item in probe_summaries),
    )


def _aggregate_evaluated_documents(
    documents: Sequence[_EvaluatedDocument],
) -> CurriculumBudgetAggregate:
    display_values: list[int] = []
    final_values: list[int] = []
    for document in documents:
        display_values.extend(document.display_tokens)
        final_values.extend(document.final_tokens)
    return CurriculumBudgetAggregate(
        document_count=len(documents),
        total_units=sum(document.result.total_units for document in documents),
        total_chunks=sum(document.result.total_chunks for document in documents),
        chunk_delta_vs_units=sum(document.result.chunk_delta_vs_units for document in documents),
        oversize_chunk_count=sum(document.result.oversize_chunk_count for document in documents),
        orphan_heading_only_count=sum(
            document.result.orphan_heading_only_count for document in documents
        ),
        cue_only_chunk_count=sum(document.result.cue_only_chunk_count for document in documents),
        missing_top_parent_count=sum(
            document.result.missing_top_parent_count for document in documents
        ),
        missing_any_structural_heading_count=sum(
            document.result.missing_any_structural_heading_count for document in documents
        ),
        display_tokens=_summarize_tokens(display_values),
        final_tokens=_summarize_tokens(final_values),
        probe_summary=_aggregate_probe_summaries(
            tuple(document.result.probe_summary for document in documents)
        ),
    )


def _is_orphan_heading_only_chunk(chunk_candidate: _ChunkCandidate) -> bool:
    if chunk_candidate.piece.unit_type != "section_text":
        return False
    lines = [line.strip() for line in chunk_candidate.piece.text.splitlines() if line.strip()]
    if not lines:
        return False
    return all(_is_pure_structure_heading_line(line) for line in lines)


def _is_cue_only_chunk(chunk_candidate: _ChunkCandidate) -> bool:
    if chunk_candidate.piece.unit_type != "table_unit":
        return False
    metadata = chunk_candidate.metadata
    lines = [line.strip() for line in chunk_candidate.piece.text.splitlines() if line.strip()]
    if not lines:
        return False
    caption_lines = {
        str(item).strip() for item in list(metadata.get("caption_lines") or ()) if str(item).strip()
    }
    note_lines = {
        str(item).strip() for item in list(metadata.get("note_lines") or ()) if str(item).strip()
    }
    header_line = str(metadata.get("table_header_line") or "").strip()
    content_lines = [
        line
        for line in lines
        if line not in caption_lines
        and line not in note_lines
        and line != header_line
        and not _looks_like_curriculum_structure_heading(line)
    ]
    if content_lines:
        return False
    return any(
        line in caption_lines or line == header_line or _is_table_cue_row(line) for line in lines
    )


def _missing_top_parent_context(chunk_candidate: _ChunkCandidate) -> bool:
    structural_path = _structural_section_path(chunk_candidate.anchor)
    if len(structural_path) < 2:
        return False
    return structural_path[0] not in chunk_candidate.chunk_assembly.text


def _missing_any_structural_heading(chunk_candidate: _ChunkCandidate) -> bool:
    structural_path = _structural_section_path(chunk_candidate.anchor)
    if not structural_path:
        return False
    text = chunk_candidate.chunk_assembly.text
    return not any(heading in text for heading in structural_path)


def _structural_section_path(anchor: dict[str, object]) -> list[str]:
    raw_path = [
        str(item).strip() for item in list(anchor.get("section_path") or []) if str(item).strip()
    ]
    if len(raw_path) > 1 and not _looks_like_curriculum_structure_heading(raw_path[0]):
        raw_path = raw_path[1:]
    return raw_path


def _is_pure_structure_heading_line(text: str) -> bool:
    normalized = text.strip()
    if not normalized or not _looks_like_curriculum_structure_heading(normalized):
        return False
    if any(token in normalized for token in ("。", ":", "：", ";", "；", ",", "，")):
        return False
    if len(normalized) > 48:
        return False
    return True


def _preview_text(text: str, *, limit: int = 120) -> str:
    normalized = " ".join(text.split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3] + "..."


def _summarize_tokens(values: list[int]) -> CurriculumBudgetTokenSummary:
    ordered = sorted(int(value) for value in values)
    if not ordered:
        return CurriculumBudgetTokenSummary(min=0, p50=0, p90=0, p95=0, p99=0, max=0)
    return CurriculumBudgetTokenSummary(
        min=ordered[0],
        p50=_percentile(ordered, 50),
        p90=_percentile(ordered, 90),
        p95=_percentile(ordered, 95),
        p99=_percentile(ordered, 99),
        max=ordered[-1],
    )


def _percentile(values: list[int], percentile: int) -> int:
    if not values:
        return 0
    rank = math.ceil((percentile / 100) * len(values)) - 1
    rank = min(max(rank, 0), len(values) - 1)
    return values[rank]


def _render_budget_eval_report(*, report: CurriculumBudgetEvaluationReport) -> str:
    lines = [
        "# Curriculum Budget Evaluation",
        "",
        f"- generated_at: `{report.generated_at}`",
        f"- document_count: `{report.document_count}`",
        f"- candidate_count: `{report.candidate_count}`",
        "",
        "## Candidate Summary",
        "",
        "| candidate | docs | chunks | oversize | missing_top_parent | missing_any_heading | probe_hit@1 | probe_hit@3 | final_p95 | final_max |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for candidate in report.candidates:
        aggregate = candidate.aggregate
        lines.append(
            "| "
            + " | ".join(
                [
                    candidate.name,
                    str(aggregate.document_count),
                    str(aggregate.total_chunks),
                    str(aggregate.oversize_chunk_count),
                    str(aggregate.missing_top_parent_count),
                    str(aggregate.missing_any_structural_heading_count),
                    f"{aggregate.probe_summary.complete_hit_at_1_count}/{aggregate.probe_summary.total_cases}",
                    f"{aggregate.probe_summary.complete_hit_at_3_count}/{aggregate.probe_summary.total_cases}",
                    str(aggregate.final_tokens.p95),
                    str(aggregate.final_tokens.max),
                ]
            )
            + " |"
        )
    for candidate in report.candidates:
        lines.extend(
            [
                "",
                f"## {candidate.name}",
                "",
                f"- default_profile: `{_format_profile(candidate.default_profile)}`",
                f"- table_profile: `{_format_profile(candidate.table_profile) if candidate.table_profile is not None else 'inherit-default'}`",
                f"- total_chunks: `{candidate.aggregate.total_chunks}`",
                f"- oversize_chunk_count: `{candidate.aggregate.oversize_chunk_count}`",
                f"- missing_top_parent_count: `{candidate.aggregate.missing_top_parent_count}`",
                f"- missing_any_structural_heading_count: `{candidate.aggregate.missing_any_structural_heading_count}`",
                f"- cue_only_chunk_count: `{candidate.aggregate.cue_only_chunk_count}`",
                f"- orphan_heading_only_count: `{candidate.aggregate.orphan_heading_only_count}`",
                f"- probe_summary: `{asdict(candidate.aggregate.probe_summary)}`",
                f"- final_tokens: `{asdict(candidate.aggregate.final_tokens)}`",
                "",
                "### Tier Breakdown",
                "",
            ]
        )
        for tier, aggregate in candidate.tier_aggregates.items():
            lines.append(
                f"- {tier}: docs={aggregate.document_count}, chunks={aggregate.total_chunks}, "
                f"oversize={aggregate.oversize_chunk_count}, missing_top_parent={aggregate.missing_top_parent_count}, "
                f"missing_any_heading={aggregate.missing_any_structural_heading_count}, "
                f"probe_hit@1={aggregate.probe_summary.complete_hit_at_1_count}/{aggregate.probe_summary.total_cases}, "
                f"probe_hit@3={aggregate.probe_summary.complete_hit_at_3_count}/{aggregate.probe_summary.total_cases}, "
                f"final_p95={aggregate.final_tokens.p95}, final_max={aggregate.final_tokens.max}"
            )
        lines.extend(["", "### Documents", ""])
        for document in candidate.documents:
            lines.append(
                f"- [{document.tier}] {document.title}: chunks={document.total_chunks}, oversize={document.oversize_chunk_count}, "
                f"missing_top_parent={document.missing_top_parent_count}, missing_any_heading={document.missing_any_structural_heading_count}, "
                f"cue_only={document.cue_only_chunk_count}, orphan_heading_only={document.orphan_heading_only_count}, "
                f"probe_hit@1={document.probe_summary.complete_hit_at_1_count}/{document.probe_summary.total_cases}, "
                f"probe_hit@3={document.probe_summary.complete_hit_at_3_count}/{document.probe_summary.total_cases}, final_max={document.final_tokens.max}"
            )
            for example in document.issue_examples[:3]:
                lines.append(
                    f"  - chunk {example.chunk_order} ({example.unit_type}) {','.join(example.issue_types)} "
                    f"[{example.final_token_count}/{example.budget_max}] {example.preview}"
                )
            if document.probe_results:
                lines.append("  - Probe Summary:")
                for probe_result in document.probe_results:
                    lines.append(
                        f"    - {probe_result.case_id}: top={probe_result.top_chunk_order or '-'} "
                        f"unit={probe_result.top_unit_type or '-'} "
                        f"complete_hit@1={probe_result.complete_hit_at_1} "
                        f"complete_hit@3={probe_result.complete_hit_at_3} "
                        f"preview={probe_result.top_preview}"
                    )
    return "\n".join(lines).rstrip() + "\n"


def _format_profile(profile: CurriculumBudgetProfileSpec | None) -> str:
    if profile is None:
        return "None"
    return f"{profile.chunk_size}/{profile.max_chunk_size}/{profile.chunk_overlap}/{profile.min_chunk_size}"


__all__ = [
    "CurriculumBudgetCandidate",
    "CurriculumBudgetCandidateResult",
    "CurriculumBudgetDocumentResult",
    "CurriculumBudgetEvaluationDocument",
    "CurriculumBudgetEvaluationReport",
    "CurriculumBudgetIssueExample",
    "CurriculumBudgetProbeCase",
    "CurriculumBudgetProbeResult",
    "CurriculumBudgetProbeSummary",
    "CurriculumBudgetProfileSpec",
    "CurriculumBudgetTokenSummary",
    "build_default_curriculum_budget_candidates",
    "evaluate_curriculum_budget_candidates",
    "load_default_curriculum_budget_evaluation_documents",
    "load_historical_curriculum_budget_evaluation_documents",
    "load_runtime_curriculum_budget_evaluation_documents",
]
