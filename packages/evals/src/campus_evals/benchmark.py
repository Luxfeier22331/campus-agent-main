from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
import re
from typing import Literal

from campus_contracts import EvidenceSource, KnowledgeScope

from campus_evals.models import ALLOWED_CASE_SPLITS, CaseSplit

HybridQueryCategory = Literal[
    "article_number_exact_match",
    "policy_title_exact_match",
    "policy_alias_targeted",
    "fixed_phrase_sparse_win",
    "semantic_dense_win",
    "short_fact_section",
    "table_retrieval",
    "needs_clarification",
    "acl_filter",
    "campus_scope_filter",
    "no_hit",
]
ALLOWED_HYBRID_QUERY_CATEGORIES = (
    "article_number_exact_match",
    "policy_title_exact_match",
    "policy_alias_targeted",
    "fixed_phrase_sparse_win",
    "semantic_dense_win",
    "short_fact_section",
    "table_retrieval",
    "needs_clarification",
    "acl_filter",
    "campus_scope_filter",
    "no_hit",
)
FixtureValidationSeverity = Literal["warn", "error"]
_QRELS_QUERY_ASK_CUES = frozenset({"多少", "几年", "怎么", "如何", "安排", "什么", "哪些"})
_QRELS_WHITESPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class RetrievalHybridQueryCase:
    case_id: str
    category: HybridQueryCategory
    query: str
    scope: dict[str, object] = field(default_factory=dict)
    expected_keywords: tuple[str, ...] = field(default_factory=tuple)
    forbidden_doc_ids: tuple[str, ...] = field(default_factory=tuple)
    notes: str = ""

    def __post_init__(self) -> None:
        if self.category not in ALLOWED_HYBRID_QUERY_CATEGORIES:
            raise ValueError(f"unsupported hybrid query category: {self.category}")
        if not self.case_id.strip():
            raise ValueError("case_id must not be empty")
        if not self.query.strip():
            raise ValueError("query must not be empty")


@dataclass(frozen=True, slots=True)
class RetrievalHybridQueryDataset:
    schema_version: int
    scope: KnowledgeScope
    baseline: dict[str, object]
    cases: tuple[RetrievalHybridQueryCase, ...]


@dataclass(frozen=True, slots=True)
class RetrievalQrelsSourceRef:
    doc_id: str
    grade: int
    rationale: str = ""
    version_id: str | None = None
    chunk_id: str | None = None

    def __post_init__(self) -> None:
        if not self.doc_id.strip():
            raise ValueError("doc_id must not be empty")
        if self.grade <= 0:
            raise ValueError("grade must be greater than zero")


@dataclass(frozen=True, slots=True)
class RetrievalQrelsCase:
    case_id: str
    split: CaseSplit
    query: str
    scope: KnowledgeScope
    request_overrides: dict[str, object] = field(default_factory=dict)
    expected_sources: tuple[RetrievalQrelsSourceRef, ...] = field(default_factory=tuple)
    forbidden_sources: tuple[RetrievalQrelsSourceRef, ...] = field(default_factory=tuple)
    notes: str = ""

    def __post_init__(self) -> None:
        if self.split not in ALLOWED_CASE_SPLITS:
            raise ValueError(f"unsupported split: {self.split}")
        if not self.case_id.strip():
            raise ValueError("case_id must not be empty")
        if not self.query.strip():
            raise ValueError("query must not be empty")


@dataclass(frozen=True, slots=True)
class RetrievalQrelsDataset:
    schema_version: int
    scope: KnowledgeScope
    baseline: dict[str, object]
    cases: tuple[RetrievalQrelsCase, ...]


@dataclass(frozen=True, slots=True)
class RetrievalCaseMetrics:
    case_id: str
    split: CaseSplit
    hit_at_1: float
    hit_at_3: float
    recall_at_5: float
    precision_at_5: float
    mrr_at_5: float
    forbidden_hit: bool


@dataclass(frozen=True, slots=True)
class RetrievalMetricSummary:
    total_cases: int
    hit_at_1: float
    hit_at_3: float
    recall_at_5: float
    precision_at_5: float
    mrr_at_5: float
    forbidden_hit_rate: float
    by_split: dict[str, "RetrievalMetricSummary"] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RetrievalObservedSource:
    doc_id: str
    version_id: str | None = None
    chunk_id: str | None = None
    score: float | None = None


@dataclass(frozen=True, slots=True)
class RetrievalRunCase:
    case_id: str
    retrieved_sources: tuple[RetrievalObservedSource, ...]


@dataclass(frozen=True, slots=True)
class RetrievalBenchmarkRun:
    schema_version: int
    cases: tuple[RetrievalRunCase, ...]


def load_retrieval_hybrid_query_dataset(path: str | Path) -> RetrievalHybridQueryDataset:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    scope = KnowledgeScope(
        corpus=str(payload["corpus"]),
        collection=str(payload["collection"]),
    )
    cases = tuple(_load_hybrid_query_case(item) for item in payload["cases"])
    return RetrievalHybridQueryDataset(
        schema_version=int(payload["schema_version"]),
        scope=scope,
        baseline=dict(payload.get("baseline") or {}),
        cases=cases,
    )


def validate_retrieval_hybrid_query_fixture(
    path: str | Path,
    *,
    manifest_path: str | Path,
) -> tuple[str, ...]:
    dataset = load_retrieval_hybrid_query_dataset(path)
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    documents = tuple(manifest.get("documents") or ())
    titles = tuple(_optional_string(item.get("title")) or "" for item in documents)
    manifest_has_acl = any(bool(item.get("acl_groups")) for item in documents)
    manifest_has_campus_scope = any(bool(item.get("campus_scope")) for item in documents)

    errors: list[str] = []
    scope_label = f"{dataset.scope.corpus}/{dataset.scope.collection}"
    for case in dataset.cases:
        if (case.category == "acl_filter" or case.scope.get("acl_groups")) and not manifest_has_acl:
            errors.append(
                f"case {case.case_id} requires ACL scope, but the manifest has no ACL-bearing {scope_label} documents"
            )
        if (case.category == "campus_scope_filter" or case.scope.get("campus_scope")) and not manifest_has_campus_scope:
            errors.append(
                f"case {case.case_id} requires campus_scope, but the manifest has no campus-scoped {scope_label} documents"
            )
        if case.category in {"policy_title_exact_match", "fixed_phrase_sparse_win"} and not _case_is_grounded_in_titles(
            case,
            titles=titles,
        ):
            errors.append(
                f"case {case.case_id} category {case.category} is not grounded in any current {scope_label} title keyword"
            )
    return tuple(errors)


def validate_retrieval_qrels_fixture(
    path: str | Path,
    *,
    manifest_path: str | Path,
    ambiguity_severity: FixtureValidationSeverity = "warn",
) -> tuple[str, ...]:
    dataset = load_retrieval_qrels_dataset(path)
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    documents = tuple(manifest.get("documents") or ())
    scope_label = f"{dataset.scope.corpus}/{dataset.scope.collection}"

    issues: list[str] = []
    for case in dataset.cases:
        matched_titles = _find_ambiguous_manifest_title_matches(case.query, documents=documents)
        if len(matched_titles) < 2 or not case.expected_sources:
            continue
        issues.append(
            (
                f"{ambiguity_severity}: case {case.case_id} query {case.query!r} ambiguously matches "
                f"{len(matched_titles)} current {scope_label} titles "
                f"({', '.join(item.title for item in matched_titles[:3])}); canonical qrels must not lock this "
                f"to a single retrieval truth. Move it to a needs_clarification workflow case or diagnostic fixture."
            )
        )
    return tuple(issues)


def load_retrieval_qrels_dataset(path: str | Path) -> RetrievalQrelsDataset:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    scope = KnowledgeScope(
        corpus=str(payload["corpus"]),
        collection=str(payload["collection"]),
    )
    cases = tuple(_load_case(item, default_scope=scope) for item in payload["cases"])
    return RetrievalQrelsDataset(
        schema_version=int(payload["schema_version"]),
        scope=scope,
        baseline=dict(payload.get("baseline") or {}),
        cases=cases,
    )


def evaluate_retrieval_case(
    case: RetrievalQrelsCase,
    sources: tuple[EvidenceSource, ...] | list[EvidenceSource],
) -> RetrievalCaseMetrics:
    ranked_sources = tuple(sources)
    relevant_sources = case.expected_sources
    relevant_total = len(relevant_sources)
    forbidden_hit = any(
        _matches_expected(source_ref, source)
        for source_ref in case.forbidden_sources
        for source in ranked_sources
    )

    if relevant_total == 0:
        empty_success = 1.0 if not ranked_sources else 0.0
        return RetrievalCaseMetrics(
            case_id=case.case_id,
            split=case.split,
            hit_at_1=empty_success,
            hit_at_3=empty_success,
            recall_at_5=empty_success,
            precision_at_5=empty_success,
            mrr_at_5=empty_success,
            forbidden_hit=forbidden_hit,
        )

    def hit_at(limit: int) -> float:
        return 1.0 if any(_matches_expected(source_ref, source) for source in ranked_sources[:limit] for source_ref in relevant_sources) else 0.0

    matched_within_5 = {
        _source_identity(source_ref)
        for source_ref in relevant_sources
        if any(_matches_expected(source_ref, source) for source in ranked_sources[:5])
    }
    relevant_hits_within_5 = len(matched_within_5)
    precision_denominator = min(len(ranked_sources), 5)
    first_relevant_rank = next(
        (
            index
            for index, source in enumerate(ranked_sources[:5], start=1)
            if any(_matches_expected(source_ref, source) for source_ref in relevant_sources)
        ),
        None,
    )
    return RetrievalCaseMetrics(
        case_id=case.case_id,
        split=case.split,
        hit_at_1=hit_at(1),
        hit_at_3=hit_at(3),
        recall_at_5=(relevant_hits_within_5 / relevant_total) if relevant_total else 0.0,
        precision_at_5=(relevant_hits_within_5 / precision_denominator) if precision_denominator else 0.0,
        mrr_at_5=(1.0 / first_relevant_rank) if first_relevant_rank is not None else 0.0,
        forbidden_hit=forbidden_hit,
    )


def summarize_retrieval_metrics(metrics: tuple[RetrievalCaseMetrics, ...] | list[RetrievalCaseMetrics]) -> RetrievalMetricSummary:
    return _summarize_retrieval_metrics(metrics, include_splits=True)


def _summarize_retrieval_metrics(
    metrics: tuple[RetrievalCaseMetrics, ...] | list[RetrievalCaseMetrics],
    *,
    include_splits: bool,
) -> RetrievalMetricSummary:
    metric_items = tuple(metrics)
    split_names = sorted({item.split for item in metric_items})
    if not metric_items:
        return RetrievalMetricSummary(
            total_cases=0,
            hit_at_1=0.0,
            hit_at_3=0.0,
            recall_at_5=0.0,
            precision_at_5=0.0,
            mrr_at_5=0.0,
            forbidden_hit_rate=0.0,
            by_split={},
        )
    return RetrievalMetricSummary(
        total_cases=len(metric_items),
        hit_at_1=_average(item.hit_at_1 for item in metric_items),
        hit_at_3=_average(item.hit_at_3 for item in metric_items),
        recall_at_5=_average(item.recall_at_5 for item in metric_items),
        precision_at_5=_average(item.precision_at_5 for item in metric_items),
        mrr_at_5=_average(item.mrr_at_5 for item in metric_items),
        forbidden_hit_rate=_average(1.0 if item.forbidden_hit else 0.0 for item in metric_items),
        by_split=(
            {
                split: _summarize_retrieval_metrics(
                    tuple(item for item in metric_items if item.split == split),
                    include_splits=False,
                )
                for split in split_names
            }
            if include_splits
            else {}
        ),
    )


def _load_case(payload: dict[str, object], *, default_scope: KnowledgeScope) -> RetrievalQrelsCase:
    raw_scope = payload.get("scope")
    if isinstance(raw_scope, dict):
        scope = KnowledgeScope(
            corpus=str(raw_scope.get("corpus") or default_scope.corpus),
            collection=str(raw_scope.get("collection") or default_scope.collection),
        )
    else:
        scope = default_scope
    return RetrievalQrelsCase(
        case_id=str(payload["case_id"]),
        split=str(payload["split"]),
        query=str(payload["query"]),
        scope=scope,
        request_overrides=dict(payload.get("request_overrides") or {}),
        expected_sources=tuple(_load_source_ref(item) for item in payload.get("expected_sources") or ()),
        forbidden_sources=tuple(_load_source_ref(item) for item in payload.get("forbidden_sources") or ()),
        notes=str(payload.get("notes") or ""),
    )


def _load_hybrid_query_case(payload: dict[str, object]) -> RetrievalHybridQueryCase:
    return RetrievalHybridQueryCase(
        case_id=str(payload["case_id"]),
        category=str(payload["category"]),
        query=str(payload["query"]),
        scope=dict(payload.get("scope") or {}),
        expected_keywords=tuple(str(item) for item in payload.get("expected_keywords") or ()),
        forbidden_doc_ids=tuple(str(item) for item in payload.get("forbidden_doc_ids") or ()),
        notes=str(payload.get("notes") or ""),
    )


def _load_source_ref(payload: dict[str, object]) -> RetrievalQrelsSourceRef:
    return RetrievalQrelsSourceRef(
        doc_id=str(payload["doc_id"]),
        version_id=_optional_string(payload.get("version_id")),
        chunk_id=_optional_string(payload.get("chunk_id")),
        grade=int(payload.get("grade") or 1),
        rationale=str(payload.get("rationale") or ""),
    )


def _optional_string(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _case_is_grounded_in_titles(case: RetrievalHybridQueryCase, *, titles: tuple[str, ...]) -> bool:
    terms = (case.query, *case.expected_keywords)
    normalized_terms = tuple(term.strip() for term in terms if term.strip())
    return any(term in title for title in titles for term in normalized_terms)


@dataclass(frozen=True, slots=True)
class _ManifestTitleMatch:
    doc_id: str
    title: str


def _find_ambiguous_manifest_title_matches(
    query: str,
    *,
    documents: tuple[dict[str, object], ...],
) -> tuple[_ManifestTitleMatch, ...]:
    query_key = _fixture_query_key(query)
    if not _query_can_lock_ambiguous_title_truth(query_key):
        return ()

    matches: list[_ManifestTitleMatch] = []
    for item in documents:
        title = _manifest_document_title(item)
        if not title:
            continue
        if any(query_key in title_key for title_key in _fixture_title_keys(title)):
            matches.append(
                _ManifestTitleMatch(
                    doc_id=str(item.get("document_id") or "").strip(),
                    title=title,
                )
            )
    return tuple(dict.fromkeys(matches))


def _manifest_document_title(payload: dict[str, object]) -> str:
    title = _optional_string(payload.get("title"))
    if title is not None:
        return title
    doc_id = _optional_string(payload.get("document_id"))
    if doc_id is None:
        return ""
    return doc_id.split(":", 1)[-1]


def _query_can_lock_ambiguous_title_truth(query_key: str) -> bool:
    if not query_key:
        return False
    if any(cue in query_key for cue in _QRELS_QUERY_ASK_CUES):
        return False
    cjk_length = sum(1 for char in query_key if _is_cjk_char(char))
    return 0 < cjk_length <= 8


def _fixture_query_key(text: str) -> str:
    normalized = _QRELS_WHITESPACE_RE.sub(" ", text).strip().lower()
    return "".join(char for char in normalized if char.isalnum() or _is_cjk_char(char))


def _fixture_title_keys(text: str) -> tuple[str, ...]:
    key = _fixture_query_key(text)
    return (key,) if key else ()


def _is_cjk_char(char: str) -> bool:
    code_point = ord(char)
    return (
        0x3400 <= code_point <= 0x4DBF
        or 0x4E00 <= code_point <= 0x9FFF
        or 0xF900 <= code_point <= 0xFAFF
    )


def _source_identity(source_ref: RetrievalQrelsSourceRef) -> tuple[str, str | None, str | None]:
    return (source_ref.doc_id, source_ref.version_id, source_ref.chunk_id)


def _matches_expected(source_ref: RetrievalQrelsSourceRef, source: EvidenceSource) -> bool:
    if source.doc_id != source_ref.doc_id:
        return False
    if source_ref.version_id is not None and source.version_id != source_ref.version_id:
        return False
    if source_ref.chunk_id is not None and source.chunk_id != source_ref.chunk_id:
        return False
    return True


def _average(values) -> float:
    collected = tuple(values)
    if not collected:
        return 0.0
    return sum(collected) / len(collected)


def load_retrieval_benchmark_run(path: str | Path) -> RetrievalBenchmarkRun:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    return RetrievalBenchmarkRun(
        schema_version=int(payload["schema_version"]),
        cases=tuple(_load_run_case(item) for item in payload.get("cases") or ()),
    )


def resolve_retrieval_fixture_manifest_path(path: str | Path) -> Path:
    dataset = load_retrieval_qrels_dataset(path)
    repo_root = Path(__file__).resolve().parents[4]
    manifest_path = (
        repo_root
        / "configs"
        / "ingestion"
        / dataset.scope.corpus
        / dataset.scope.collection
        / "split-manifest.v1.json"
    )
    if not manifest_path.exists():
        raise FileNotFoundError(f"unable to resolve split manifest for {dataset.scope}: {manifest_path}")
    return manifest_path


def evaluate_retrieval_run(
    dataset: RetrievalQrelsDataset,
    run: RetrievalBenchmarkRun,
) -> tuple[RetrievalCaseMetrics, ...]:
    run_case_map = {case.case_id: case for case in run.cases}
    metrics: list[RetrievalCaseMetrics] = []
    for case in dataset.cases:
        run_case = run_case_map.get(case.case_id)
        if run_case is None:
            observed_sources: tuple[EvidenceSource, ...] = ()
        else:
            observed_sources = tuple(
                EvidenceSource(
                    doc_id=source.doc_id,
                    revision_track="source-faithful",
                    version_id=source.version_id or "",
                    chunk_id=source.chunk_id or "",
                    anchor={},
                    acl_level="public",
                    canonical_url="",
                    latest_url="",
                    source_channel="pdf_ocr",
                    collection=dataset.scope.collection,
                    is_current=False,
                    snippet="",
                    score=float(source.score or 0.0),
                )
                for source in run_case.retrieved_sources
            )
        metrics.append(evaluate_retrieval_case(case, observed_sources))
    return tuple(metrics)


def render_retrieval_summary_text(summary: RetrievalMetricSummary) -> str:
    lines = [
        "Retrieval Benchmark Summary",
        f"total_cases: {summary.total_cases}",
        f"hit@1: {summary.hit_at_1:.3f}",
        f"hit@3: {summary.hit_at_3:.3f}",
        f"recall@5: {summary.recall_at_5:.3f}",
        f"precision@5: {summary.precision_at_5:.3f}",
        f"mrr@5: {summary.mrr_at_5:.3f}",
        f"forbidden_hit_rate: {summary.forbidden_hit_rate:.3f}",
    ]
    if summary.by_split:
        lines.append("by_split:")
        for split_name, split_summary in summary.by_split.items():
            lines.append(
                "  "
                f"{split_name}: hit@1={split_summary.hit_at_1:.3f}, "
                f"hit@3={split_summary.hit_at_3:.3f}, "
                f"recall@5={split_summary.recall_at_5:.3f}, "
                f"precision@5={split_summary.precision_at_5:.3f}, "
                f"mrr@5={split_summary.mrr_at_5:.3f}, "
                f"forbidden_hit_rate={split_summary.forbidden_hit_rate:.3f}"
            )
    return "\n".join(lines)


def _load_run_case(payload: dict[str, object]) -> RetrievalRunCase:
    return RetrievalRunCase(
        case_id=str(payload["case_id"]),
        retrieved_sources=tuple(_load_observed_source(item) for item in payload.get("retrieved_sources") or ()),
    )


def _load_observed_source(payload: dict[str, object]) -> RetrievalObservedSource:
    return RetrievalObservedSource(
        doc_id=str(payload["doc_id"]),
        version_id=_optional_string(payload.get("version_id")),
        chunk_id=_optional_string(payload.get("chunk_id")),
        score=float(payload["score"]) if payload.get("score") is not None else None,
    )
