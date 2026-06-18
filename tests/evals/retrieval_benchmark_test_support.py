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
from campus_evals.fixture_registry import fixture_path
from campus_evals.retrieval_benchmark import main as benchmark_main

FIXTURE_PATH = fixture_path("rag.student_rules.retrieval_qrels")
HYBRID_FIXTURE_PATH = fixture_path("rag.student_rules.hybrid_queries")
STUDENT_RULES_RELEASE_ACCEPTANCE_FIXTURE_PATH = fixture_path("rag.student_rules.release_acceptance")
CURRICULUM_QRELS_FIXTURE_PATH = fixture_path("rag.curriculum_plan.retrieval_qrels")
CURRICULUM_HYBRID_FIXTURE_PATH = fixture_path("rag.curriculum_plan.hybrid_queries")
CURRICULUM_ANNOTATION_TEMPLATE_PATH = fixture_path(
    "rag.curriculum_plan.retrieval_annotation_template"
)
CURRICULUM_RELEASE_ACCEPTANCE_FIXTURE_PATH = fixture_path("rag.curriculum_plan.release_acceptance")
OFFICIAL_WEB_QRELS_FIXTURE_PATH = fixture_path("rag.official_web_muc_public_pages.retrieval_qrels")
OFFICIAL_WEB_STABLE_REFERENCE_QRELS_FIXTURE_PATH = fixture_path(
    "rag.official_web_stable_reference.retrieval_qrels"
)
INSTITUTIONAL_RULES_QRELS_FIXTURE_PATH = fixture_path("rag.institutional_rules.retrieval_qrels")
INSTITUTIONAL_RULES_GOLDEN_QRELS_FIXTURE_PATH = fixture_path(
    "rag.institutional_rules.golden_retrieval_qrels"
)
INSTITUTIONAL_RULES_RELEASE_ACCEPTANCE_FIXTURE_PATH = fixture_path(
    "rag.institutional_rules.release_acceptance"
)
OFFICIAL_WEB_FRESH_NEWS_QRELS_FIXTURE_PATH = fixture_path(
    "rag.official_web_fresh_news.retrieval_qrels"
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
INSTITUTIONAL_RULES_RETRIEVAL_EVAL_MANIFEST_PATH = (
    Path(__file__).resolve().parents[2]
    / "configs"
    / "ingestion"
    / "regulations"
    / "institutional_rules"
    / "retrieval-eval-manifest.v1.json"
)
OFFICIAL_WEB_FRESH_NEWS_MANIFEST_PATH = (
    Path(__file__).resolve().parents[2]
    / "configs"
    / "ingestion"
    / "official_web"
    / "fresh_news"
    / "split-manifest.v1.json"
)
ANNOTATION_TEMPLATE_PATH = fixture_path("rag.student_rules.retrieval_annotation_template")
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
    "CURRICULUM_RELEASE_ACCEPTANCE_FIXTURE_PATH",
    "FIXTURE_PATH",
    "HANDBOOK_MANIFEST_PATH",
    "HYBRID_FIXTURE_PATH",
    "INSTITUTIONAL_RULES_GOLDEN_QRELS_FIXTURE_PATH",
    "INSTITUTIONAL_RULES_QRELS_FIXTURE_PATH",
    "INSTITUTIONAL_RULES_RETRIEVAL_EVAL_MANIFEST_PATH",
    "OFFICIAL_WEB_FRESH_NEWS_MANIFEST_PATH",
    "OFFICIAL_WEB_FRESH_NEWS_QRELS_FIXTURE_PATH",
    "OFFICIAL_WEB_MANIFEST_PATH",
    "OFFICIAL_WEB_QRELS_FIXTURE_PATH",
    "OFFICIAL_WEB_STABLE_REFERENCE_MANIFEST_PATH",
    "OFFICIAL_WEB_STABLE_REFERENCE_QRELS_FIXTURE_PATH",
    "STUDENT_RULES_RELEASE_ACCEPTANCE_FIXTURE_PATH",
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
