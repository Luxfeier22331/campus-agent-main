from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.benchmark import load_retrieval_qrels_dataset
from campus_evals.rag_retrieval_quality_gate import (
    CORE_RAG_RETRIEVAL_QUALITY_SURFACES,
    build_rag_retrieval_quality_gate_report,
    main,
)


class RagRetrievalQualityGateSuite(unittest.TestCase):
    def test_gate_passes_for_core_rag_live_evidence(self) -> None:
        with TemporaryDirectory() as temp_dir:
            evidence_root = _write_passing_evidence(Path(temp_dir))
            report = build_rag_retrieval_quality_gate_report(evidence_root=evidence_root)
            by_surface = {surface.surface_key: surface for surface in report.surfaces}

        self.assertEqual(tuple(by_surface), CORE_RAG_RETRIEVAL_QUALITY_SURFACES)
        self.assertTrue(report.passed, report.gaps)
        self.assertEqual(report.gaps, ())
        self.assertEqual(by_surface["regulations/student_rules"].qrels_case_count, 52)
        self.assertEqual(by_surface["regulations/student_rules"].unique_expected_doc_count, 46)
        self.assertEqual(by_surface["regulations/student_rules"].live_total_cases, 52)
        self.assertEqual(by_surface["regulations/student_rules"].doc_hit_at_1, 1.0)
        self.assertEqual(by_surface["regulations/student_rules"].doc_recall_at_5, 1.0)
        self.assertEqual(by_surface["regulations/student_rules"].forbidden_hit_rate, 0.0)
        self.assertEqual(by_surface["regulations/student_rules"].readiness_status, "ready")
        self.assertEqual(by_surface["regulations/institutional_rules"].live_total_cases, 46)
        self.assertEqual(by_surface["curriculum/curriculum_plan"].live_total_cases, 60)
        self.assertEqual(
            report.excluded_surfaces["official_web/fresh_news"],
            "not_current_rag_consumption_surface",
        )
        self.assertEqual(
            report.non_blocking_surfaces["official_web/stable_reference"],
            "not_refreshed_in_core_rag_quality_gate",
        )

    def test_gate_fails_when_runtime_readiness_blocks_surface(self) -> None:
        with TemporaryDirectory() as temp_dir:
            evidence_root = _write_passing_evidence(Path(temp_dir))
            readiness_path = evidence_root / "runtime-readiness.current.json"
            payload = json.loads(readiness_path.read_text(encoding="utf-8"))
            for surface in payload["surfaces"]:
                if surface["scope"] == "curriculum/curriculum_plan":
                    surface["readiness_status"] = "blocked"
                    surface["readiness_blocker"] = "stale_alias"
            readiness_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

            report = build_rag_retrieval_quality_gate_report(evidence_root=evidence_root)

        self.assertFalse(report.passed)
        self.assertIn("curriculum/curriculum_plan:runtime_readiness_not_ready", report.gaps)

    def test_gate_fails_when_live_qrels_metrics_regress(self) -> None:
        with TemporaryDirectory() as temp_dir:
            evidence_root = _write_passing_evidence(Path(temp_dir))
            run_path = evidence_root / "live-qrels" / "student-rules.current.json"
            payload = json.loads(run_path.read_text(encoding="utf-8"))
            payload["cases"][0]["retrieved_sources"] = []
            run_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

            report = build_rag_retrieval_quality_gate_report(evidence_root=evidence_root)

        self.assertFalse(report.passed)
        self.assertIn("regulations/student_rules:doc_hit_at_1_below_threshold", report.gaps)
        self.assertIn("regulations/student_rules:doc_recall_at_5_below_threshold", report.gaps)

    def test_cli_writes_report_json(self) -> None:
        with TemporaryDirectory() as temp_dir:
            evidence_root = _write_passing_evidence(Path(temp_dir))
            output_path = Path(temp_dir) / "rag-retrieval-quality-gate.json"
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                exit_code = main(
                    [
                        "--output",
                        str(output_path),
                        "--evidence-root",
                        str(evidence_root),
                        "--json",
                    ]
                )

            payload = json.loads(output_path.read_text(encoding="utf-8"))
            printed = json.loads(stdout.getvalue())

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["schema_version"], "rag-retrieval-quality-gate.v1")
        self.assertTrue(payload["passed"])
        self.assertEqual(payload, printed)


def _write_passing_evidence(root: Path) -> Path:
    evidence_root = root / "retrieval-quality"
    (evidence_root / "live-qrels").mkdir(parents=True)
    readiness = {
        "schema_version": "rag_retrieval_runtime_readiness.v1",
        "surfaces": [
            _ready_surface(
                "regulations/student_rules",
                "student_rules",
                "student_rules__r1",
            ),
            _ready_surface(
                "regulations/institutional_rules",
                "institutional_rules",
                "institutional_rules__r1",
            ),
            _ready_surface(
                "curriculum/curriculum_plan",
                "curriculum_plan",
                "curriculum_plan__r1",
            ),
        ],
    }
    (evidence_root / "runtime-readiness.current.json").write_text(
        json.dumps(readiness, ensure_ascii=False),
        encoding="utf-8",
    )
    for surface_key, run_name in {
        "regulations/student_rules": "student-rules.current.json",
        "regulations/institutional_rules": "institutional-rules.current.json",
        "curriculum/curriculum_plan": "curriculum-plan.current.json",
    }.items():
        run = _perfect_run_for_qrels(_fixture_path(surface_key))
        (evidence_root / "live-qrels" / run_name).write_text(
            json.dumps(run, ensure_ascii=False),
            encoding="utf-8",
        )
    return evidence_root


def _ready_surface(scope: str, alias_name: str, alias_target: str) -> dict[str, object]:
    return {
        "scope": scope,
        "readiness_status": "ready",
        "readiness_blocker": "",
        "alias_name": alias_name,
        "alias_target": alias_target,
        "release_freshness_status": "current",
        "release_metadata_guard_status": "passed",
        "alias_target_guard_status": "passed",
    }


def _perfect_run_for_qrels(qrels_path: Path) -> dict[str, object]:
    dataset = load_retrieval_qrels_dataset(qrels_path)
    return {
        "schema_version": 1,
        "cases": [
            {
                "case_id": case.case_id,
                "retrieved_sources": [
                    {
                        "doc_id": source.doc_id,
                        "version_id": source.version_id,
                        "chunk_id": source.chunk_id,
                        "score": 1.0,
                    }
                    for source in case.expected_sources
                ],
            }
            for case in dataset.cases
        ],
    }


def _fixture_path(surface_key: str) -> Path:
    fixture_root = Path(__file__).resolve().parents[2] / "packages" / "evals" / "fixtures"
    return (
        fixture_root
        / {
            "regulations/student_rules": "student_handbook_retrieval_qrels.json",
            "regulations/institutional_rules": "institutional_rules_retrieval_qrels.json",
            "curriculum/curriculum_plan": "curriculum_plan_retrieval_qrels.json",
        }[surface_key]
    )


if __name__ == "__main__":
    unittest.main()
