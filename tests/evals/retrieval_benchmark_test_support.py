from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import campus_evals
from campus_contracts import EvidenceBundle, EvidenceSource, KnowledgeScope
from campus_evals import (
    RetrievalBenchmarkRun,
    RetrievalCaseMetrics,
    RetrievalMetricSummary,
    RetrievalObservedSource,
    RetrievalQrelsCase,
    RetrievalQrelsDataset,
    RetrievalQrelsSourceRef,
    evaluate_retrieval_case,
    evaluate_retrieval_run,
    load_retrieval_benchmark_run,
    load_retrieval_qrels_dataset,
    render_retrieval_summary_text,
    resolve_retrieval_fixture_manifest_path,
    summarize_retrieval_metrics,
    validate_retrieval_qrels_fixture,
)
from campus_evals.retrieval_benchmark import main as benchmark_main
from campus_evals.retrieval_live_benchmark import main as live_benchmark_main

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "student_handbook_retrieval_qrels.json"
)
HYBRID_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "student_handbook_hybrid_queries.json"
)
CURRICULUM_QRELS_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "curriculum_plan_retrieval_qrels.json"
)
CURRICULUM_HYBRID_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "curriculum_plan_hybrid_queries.json"
)
CURRICULUM_ANNOTATION_TEMPLATE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "curriculum_plan_retrieval_annotation_template.json"
)
OFFICIAL_WEB_QRELS_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "official_web_muc_public_pages_retrieval_qrels.json"
)
OFFICIAL_WEB_STABLE_REFERENCE_QRELS_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "official_web_stable_reference_retrieval_qrels.json"
)
OFFICIAL_WEB_FRESH_NEWS_QRELS_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "official_web_fresh_news_retrieval_qrels.json"
)
OFFICIAL_WEB_MANIFEST_PATH = (
    Path(__file__).resolve().parents[2]
    / "configs"
    / "ingestion"
    / "official_web"
    / "muc_public_pages"
    / "split-manifest.v1.json"
)
OFFICIAL_WEB_STABLE_REFERENCE_MANIFEST_PATH = (
    Path(__file__).resolve().parents[2]
    / "configs"
    / "ingestion"
    / "official_web"
    / "stable_reference"
    / "split-manifest.v1.json"
)
OFFICIAL_WEB_FRESH_NEWS_MANIFEST_PATH = (
    Path(__file__).resolve().parents[2]
    / "configs"
    / "ingestion"
    / "official_web"
    / "fresh_news"
    / "split-manifest.v1.json"
)
ANNOTATION_TEMPLATE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "student_handbook_retrieval_annotation_template.json"
)
HANDBOOK_MANIFEST_PATH = (
    Path(__file__).resolve().parents[2]
    / "configs"
    / "ingestion"
    / "regulations"
    / "student_rules"
    / "split-manifest.v1.json"
)
CURRICULUM_MANIFEST_PATH = (
    Path(__file__).resolve().parents[2]
    / "configs"
    / "ingestion"
    / "curriculum"
    / "curriculum_plan"
    / "split-manifest.v1.json"
)


def _source(
    *,
    doc_id: str,
    version_id: str = "v1",
    chunk_id: str = "chunk-1",
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=version_id,
        chunk_id=chunk_id,
        anchor={"page": 1},
        canonical_url=f"https://example.edu/{doc_id}",
        latest_url=f"https://example.edu/{doc_id}",
        source_channel="pdf_ocr",
        collection="student_rules",
        is_current=False,
        snippet=f"Snippet for {doc_id}",
        score=0.91,
    )


__all__ = (
    "ANNOTATION_TEMPLATE_PATH",
    "CURRICULUM_ANNOTATION_TEMPLATE_PATH",
    "CURRICULUM_HYBRID_FIXTURE_PATH",
    "CURRICULUM_MANIFEST_PATH",
    "CURRICULUM_QRELS_FIXTURE_PATH",
    "FIXTURE_PATH",
    "HANDBOOK_MANIFEST_PATH",
    "HYBRID_FIXTURE_PATH",
    "OFFICIAL_WEB_FRESH_NEWS_MANIFEST_PATH",
    "OFFICIAL_WEB_FRESH_NEWS_QRELS_FIXTURE_PATH",
    "OFFICIAL_WEB_MANIFEST_PATH",
    "OFFICIAL_WEB_QRELS_FIXTURE_PATH",
    "OFFICIAL_WEB_STABLE_REFERENCE_MANIFEST_PATH",
    "OFFICIAL_WEB_STABLE_REFERENCE_QRELS_FIXTURE_PATH",
    "EvidenceBundle",
    "EvidenceSource",
    "KnowledgeScope",
    "Path",
    "RetrievalBenchmarkRun",
    "RetrievalCaseMetrics",
    "RetrievalMetricSummary",
    "RetrievalObservedSource",
    "RetrievalQrelsCase",
    "RetrievalQrelsDataset",
    "RetrievalQrelsSourceRef",
    "TemporaryDirectory",
    "_source",
    "benchmark_main",
    "campus_evals",
    "evaluate_retrieval_case",
    "evaluate_retrieval_run",
    "io",
    "json",
    "live_benchmark_main",
    "load_retrieval_benchmark_run",
    "load_retrieval_qrels_dataset",
    "patch",
    "redirect_stderr",
    "redirect_stdout",
    "render_retrieval_summary_text",
    "resolve_retrieval_fixture_manifest_path",
    "summarize_retrieval_metrics",
    "unittest",
    "validate_retrieval_qrels_fixture",
)
