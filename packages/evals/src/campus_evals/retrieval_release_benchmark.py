from __future__ import annotations

import json
import statistics
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

RETRIEVAL_RELEASE_BENCHMARK_REPORT_SCHEMA_VERSION = "retrieval-release-benchmark-report-v1"
RetrievalReleaseBenchmarkMode = Literal["dry_run"]


@dataclass(frozen=True, slots=True)
class RetrievalReleaseBenchmarkCounts:
    document_count: int
    chunk_count: int
    scaled_chunk_count: int
    token_estimate: int
    scaled_token_estimate: int


@dataclass(frozen=True, slots=True)
class RetrievalReleaseBenchmarkEmbedding:
    provider_call_count_estimate: int
    cache_hit_count: int
    cache_miss_count_estimate: int


@dataclass(frozen=True, slots=True)
class RetrievalReleaseBenchmarkTiming:
    status: str = "not_executed"
    duration_ms: float | None = None


@dataclass(frozen=True, slots=True)
class RetrievalReleaseBenchmarkQueryLatency:
    case_count: int = 0
    p50_ms: float | None = None
    p95_ms: float | None = None
    p99_ms: float | None = None


@dataclass(frozen=True, slots=True)
class RetrievalReleaseBenchmarkAliasPublish:
    status: str = "not_attempted"
    mutated: bool = False
    duration_ms: float | None = None


@dataclass(frozen=True, slots=True)
class RetrievalReleaseBenchmarkReport:
    schema_version: str
    scope: dict[str, str]
    mode: RetrievalReleaseBenchmarkMode
    scale_multiplier: int
    counts: RetrievalReleaseBenchmarkCounts
    embedding: RetrievalReleaseBenchmarkEmbedding
    qdrant: dict[str, RetrievalReleaseBenchmarkTiming] = field(default_factory=dict)
    query_latency: RetrievalReleaseBenchmarkQueryLatency = field(
        default_factory=RetrievalReleaseBenchmarkQueryLatency
    )
    alias_publish: RetrievalReleaseBenchmarkAliasPublish = field(
        default_factory=RetrievalReleaseBenchmarkAliasPublish
    )


def build_retrieval_release_benchmark_report_from_jsonl(
    *,
    chunks_path: str | Path,
    corpus: str,
    collection: str,
    scale_multiplier: int = 1,
    mode: RetrievalReleaseBenchmarkMode = "dry_run",
    embedding_cache_hit_count: int = 0,
    query_latencies_ms: tuple[float, ...] = (),
) -> RetrievalReleaseBenchmarkReport:
    if mode != "dry_run":
        raise ValueError("retrieval release benchmark currently supports only dry_run mode")
    if scale_multiplier < 1:
        raise ValueError("scale_multiplier must be greater than zero")
    chunks = _load_jsonl_objects(chunks_path)
    document_ids = {_document_id(chunk) for chunk in chunks if _document_id(chunk)}
    chunk_count = len(chunks)
    scaled_chunk_count = chunk_count * scale_multiplier
    token_estimate = sum(_chunk_token_estimate(chunk) for chunk in chunks)
    scaled_token_estimate = token_estimate * scale_multiplier
    cache_hits = min(max(embedding_cache_hit_count, 0), scaled_chunk_count)
    cache_misses = scaled_chunk_count - cache_hits
    return RetrievalReleaseBenchmarkReport(
        schema_version=RETRIEVAL_RELEASE_BENCHMARK_REPORT_SCHEMA_VERSION,
        scope={"corpus": corpus, "collection": collection},
        mode=mode,
        scale_multiplier=scale_multiplier,
        counts=RetrievalReleaseBenchmarkCounts(
            document_count=len(document_ids),
            chunk_count=chunk_count,
            scaled_chunk_count=scaled_chunk_count,
            token_estimate=token_estimate,
            scaled_token_estimate=scaled_token_estimate,
        ),
        embedding=RetrievalReleaseBenchmarkEmbedding(
            provider_call_count_estimate=cache_misses,
            cache_hit_count=cache_hits,
            cache_miss_count_estimate=cache_misses,
        ),
        qdrant={
            "collection_create": RetrievalReleaseBenchmarkTiming(),
            "payload_index_create": RetrievalReleaseBenchmarkTiming(),
            "upsert": RetrievalReleaseBenchmarkTiming(),
            "post_publish_audit": RetrievalReleaseBenchmarkTiming(),
        },
        query_latency=_query_latency_summary(query_latencies_ms),
        alias_publish=RetrievalReleaseBenchmarkAliasPublish(),
    )


def retrieval_release_benchmark_report_to_dict(
    report: RetrievalReleaseBenchmarkReport,
) -> dict[str, object]:
    return {
        "schema_version": report.schema_version,
        "scope": report.scope,
        "mode": report.mode,
        "scale_multiplier": report.scale_multiplier,
        "counts": {
            "document_count": report.counts.document_count,
            "chunk_count": report.counts.chunk_count,
            "scaled_chunk_count": report.counts.scaled_chunk_count,
            "token_estimate": report.counts.token_estimate,
            "scaled_token_estimate": report.counts.scaled_token_estimate,
        },
        "embedding": {
            "provider_call_count_estimate": report.embedding.provider_call_count_estimate,
            "cache_hit_count": report.embedding.cache_hit_count,
            "cache_miss_count_estimate": report.embedding.cache_miss_count_estimate,
        },
        "qdrant": {
            name: {
                "status": timing.status,
                "duration_ms": timing.duration_ms,
            }
            for name, timing in report.qdrant.items()
        },
        "query_latency": {
            "case_count": report.query_latency.case_count,
            "p50_ms": report.query_latency.p50_ms,
            "p95_ms": report.query_latency.p95_ms,
            "p99_ms": report.query_latency.p99_ms,
        },
        "alias_publish": {
            "status": report.alias_publish.status,
            "mutated": report.alias_publish.mutated,
            "duration_ms": report.alias_publish.duration_ms,
        },
    }


def _load_jsonl_objects(path: str | Path) -> tuple[dict[str, object], ...]:
    rows: list[dict[str, object]] = []
    for line_number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, dict):
            raise ValueError(f"chunk row {line_number} must be a JSON object")
        rows.append(payload)
    return tuple(rows)


def _document_id(chunk: dict[str, object]) -> str:
    for key in ("doc_id", "document_id"):
        value = chunk.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _chunk_token_estimate(chunk: dict[str, object]) -> int:
    metadata = chunk.get("metadata")
    if isinstance(metadata, dict):
        token_count = metadata.get("final_token_count")
        if isinstance(token_count, int | float) and token_count > 0:
            return int(token_count)
    for key in ("final_token_count", "token_count"):
        token_count = chunk.get(key)
        if isinstance(token_count, int | float) and token_count > 0:
            return int(token_count)
    text = ""
    for key in ("clean_text", "text", "content"):
        value = chunk.get(key)
        if isinstance(value, str) and value.strip():
            text = value
            break
    return max(1, len(text) // 2) if text else 0


def _query_latency_summary(
    latencies_ms: tuple[float, ...],
) -> RetrievalReleaseBenchmarkQueryLatency:
    if not latencies_ms:
        return RetrievalReleaseBenchmarkQueryLatency()
    values = sorted(float(value) for value in latencies_ms)
    return RetrievalReleaseBenchmarkQueryLatency(
        case_count=len(values),
        p50_ms=_percentile(values, 50),
        p95_ms=_percentile(values, 95),
        p99_ms=_percentile(values, 99),
    )


def _percentile(values: list[float], percentile: int) -> float:
    if len(values) == 1:
        return values[0]
    if percentile == 50:
        return float(statistics.median(values))
    rank = (len(values) - 1) * (percentile / 100)
    lower = int(rank)
    upper = min(lower + 1, len(values) - 1)
    weight = rank - lower
    return values[lower] * (1 - weight) + values[upper] * weight


__all__ = [
    "RETRIEVAL_RELEASE_BENCHMARK_REPORT_SCHEMA_VERSION",
    "RetrievalReleaseBenchmarkAliasPublish",
    "RetrievalReleaseBenchmarkCounts",
    "RetrievalReleaseBenchmarkEmbedding",
    "RetrievalReleaseBenchmarkMode",
    "RetrievalReleaseBenchmarkQueryLatency",
    "RetrievalReleaseBenchmarkReport",
    "RetrievalReleaseBenchmarkTiming",
    "build_retrieval_release_benchmark_report_from_jsonl",
    "retrieval_release_benchmark_report_to_dict",
]
