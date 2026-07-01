from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from campus_ingestion_core.models import DocumentRegistryRecord

_REPO_ROOT = Path(__file__).resolve().parents[4]
_DEFAULT_SAMPLE_INDEX_PATH = (
    _REPO_ROOT / "configs/ingestion/curriculum/curriculum_plan/samples/index.json"
)
_DEFAULT_SPLIT_MANIFEST_PATH = (
    _REPO_ROOT / "configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json"
)
_DEFAULT_LAYOUT_FIXTURE_PATH = (
    _REPO_ROOT / "packages/ingestion-core/testdata/curriculum_plan/layout-elements.synthetic.jsonl"
)
_DEFAULT_RUNTIME_TITLES = (
    "示例公共事务本科人才培养方案",
    "示例数据系统本科人才培养方案",
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
    probe_cases: tuple[CurriculumBudgetProbeCase, ...] = ()


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


__all__ = [
    "_DEFAULT_EMBEDDING_MODEL",
    "_DEFAULT_LAYOUT_FIXTURE_PATH",
    "_DEFAULT_RUNTIME_TITLES",
    "_DEFAULT_SAMPLE_INDEX_PATH",
    "_DEFAULT_SPLIT_MANIFEST_PATH",
    "_REPO_ROOT",
    "CurriculumBudgetAggregate",
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
]
