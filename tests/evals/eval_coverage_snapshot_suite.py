from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.eval_coverage_snapshot import (
    EVAL_COVERAGE_SNAPSHOT_SCHEMA_VERSION,
    build_eval_coverage_snapshot,
    main,
)


class EvalCoverageSnapshotSuite(unittest.TestCase):
    def test_snapshot_projects_current_rag_denominator_with_gate_and_ragas_status(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            student_gate = _write_json(
                root / "student-final-summary.json",
                {
                    "schema_version": 1,
                    "gate_report": {"overall_verdict": "pass"},
                    "deterministic": {
                        "run_count": 1,
                        "run_pass_counts": [25],
                        "run_failed_counts": [0],
                        "mean_pass_rate": 1.0,
                    },
                    "provenance": {"git_head": "git-student"},
                },
            )
            manifest = _write_json(
                root / "gate-artifacts.json",
                {
                    "schema_version": "eval-coverage-gate-artifacts.v1",
                    "artifacts": [
                        _gate_artifact(
                            "regulations/student_rules",
                            "handbook",
                            "student-gate",
                            student_gate,
                        ),
                        _gate_artifact(
                            "regulations/institutional_rules",
                            "institutional-rules-release-baseline",
                            "institutional-gate",
                            student_gate,
                        ),
                        _gate_artifact(
                            "curriculum/curriculum_plan",
                            "curriculum",
                            "curriculum-gate",
                            student_gate,
                        ),
                        _gate_artifact(
                            "official_web/stable_reference",
                            "official-web-stable-reference",
                            "official-gate",
                            student_gate,
                        ),
                    ],
                },
            )
            ragas = _write_json(
                root / "ragas-diagnostic.combined.json",
                {
                    "schema_version": "ragas-diagnostic-combined-report.v1",
                    "report_id": "ragas_diagnostic_combined",
                    "mode": "diagnostic_non_blocking",
                    "passed": True,
                    "summary": {"low_score_threshold": 0.8},
                    "cases": [
                        {
                            "surface_key": "regulations/student_rules",
                            "case_id": "student-case",
                            "status": "completed",
                            "scores": {"answer_relevancy": 0.7, "context_precision": 1.0},
                            "failure_attribution": {
                                "primary_stage": "evidence_selection",
                                "metric_failures": {"answer_relevancy": "evidence_selection"},
                            },
                        },
                        {
                            "surface_key": "curriculum/curriculum_plan",
                            "case_id": "curriculum-case",
                            "status": "completed",
                            "scores": {"answer_relevancy": 0.9},
                        },
                    ],
                },
            )

            snapshot = build_eval_coverage_snapshot(
                gate_artifacts_path=manifest,
                generated_at="2026-05-21T09:00:00+00:00",
                ragas_diagnostic_path=ragas,
                source_git_head="git-main",
            )

        self.assertEqual(snapshot["schemaVersion"], EVAL_COVERAGE_SNAPSHOT_SCHEMA_VERSION)
        self.assertEqual(
            snapshot["denominatorSurfaces"],
            [
                "regulations/student_rules",
                "regulations/institutional_rules",
                "curriculum/curriculum_plan",
                "official_web/stable_reference",
            ],
        )
        by_surface = {surface["surfaceKey"]: surface for surface in snapshot["surfaces"]}
        self.assertEqual(by_surface["regulations/student_rules"]["qrelsCaseCount"], 52)
        self.assertEqual(by_surface["regulations/student_rules"]["knownGapCaseCount"], 4)
        self.assertEqual(
            by_surface["regulations/student_rules"]["readiness"]["status"],
            "diagnostic_attention",
        )
        self.assertEqual(
            by_surface["regulations/student_rules"]["ragasDiagnostic"]["status"],
            "diagnostic_attention",
        )
        self.assertEqual(
            by_surface["regulations/student_rules"]["ragasDiagnostic"]["metrics"][0]["name"],
            "answer_relevancy",
        )
        self.assertEqual(
            by_surface["regulations/student_rules"]["ragasDiagnostic"]["lowScoreCases"],
            [
                {
                    "caseId": "student-case",
                    "failureStage": "evidence_selection",
                    "metricName": "answer_relevancy",
                    "score": 0.7,
                }
            ],
        )
        self.assertEqual(
            by_surface["regulations/student_rules"]["ragasDiagnostic"]["stageDistribution"],
            [{"caseCount": 1, "stage": "evidence_selection"}],
        )
        self.assertEqual(
            by_surface["regulations/institutional_rules"]["ragasDiagnostic"]["status"],
            "missing_for_surface",
        )
        self.assertEqual(by_surface["official_web/stable_reference"]["answerQualityCaseCount"], 0)
        self.assertEqual(snapshot["excludedSurfaces"][0]["surfaceKey"], "official_web/fresh_news")
        self.assertNotIn(str(student_gate), json.dumps(snapshot, ensure_ascii=False))

    def test_snapshot_fails_when_gate_manifest_misses_current_surface(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            gate = _write_json(
                root / "gate.json",
                {
                    "schema_version": 1,
                    "gate_report": {"overall_verdict": "pass"},
                    "deterministic": {"run_count": 1, "run_pass_counts": [1]},
                },
            )
            manifest = _write_json(
                root / "gate-artifacts.json",
                {
                    "schema_version": "eval-coverage-gate-artifacts.v1",
                    "artifacts": [
                        _gate_artifact(
                            "regulations/student_rules",
                            "handbook",
                            "student-gate",
                            gate,
                        )
                    ],
                },
            )

            with self.assertRaisesRegex(ValueError, "missing gate artifacts"):
                build_eval_coverage_snapshot(
                    gate_artifacts_path=manifest, source_git_head="git-main"
                )

    def test_snapshot_requires_source_git_head_before_reading_artifacts(self) -> None:
        with self.assertRaisesRegex(ValueError, "source_git_head is required"):
            build_eval_coverage_snapshot(gate_artifacts_path="missing-gate-artifacts.json")

    def test_cli_writes_snapshot_json(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            gate = _write_json(
                root / "gate.json",
                {
                    "schema_version": 1,
                    "gate_report": {"overall_verdict": "pass"},
                    "deterministic": {
                        "run_count": 1,
                        "run_pass_counts": [1],
                        "run_failed_counts": [0],
                    },
                },
            )
            manifest = _write_json(
                root / "gate-artifacts.json",
                {
                    "schema_version": "eval-coverage-gate-artifacts.v1",
                    "artifacts": [
                        _gate_artifact(surface, profile, f"{profile}-gate", gate)
                        for surface, profile in (
                            ("regulations/student_rules", "handbook"),
                            (
                                "regulations/institutional_rules",
                                "institutional-rules-release-baseline",
                            ),
                            ("curriculum/curriculum_plan", "curriculum"),
                            ("official_web/stable_reference", "official-web-stable-reference"),
                        )
                    ],
                },
            )
            output = root / "snapshot.json"

            exit_code = main(
                [
                    "--gate-artifacts",
                    str(manifest),
                    "--output",
                    str(output),
                    "--generated-at",
                    "2026-05-21T09:00:00+00:00",
                    "--source-git-head",
                    "git-main",
                ]
            )

            payload = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["schemaVersion"], EVAL_COVERAGE_SNAPSHOT_SCHEMA_VERSION)
        self.assertEqual(len(payload["surfaces"]), 4)

    def test_snapshot_fails_closed_when_low_score_case_has_no_stage_attribution(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            gate = _write_json(
                root / "gate.json",
                {
                    "schema_version": 1,
                    "gate_report": {"overall_verdict": "pass"},
                    "deterministic": {
                        "run_count": 1,
                        "run_pass_counts": [1],
                        "run_failed_counts": [0],
                    },
                },
            )
            manifest = _write_json(
                root / "gate-artifacts.json",
                {
                    "schema_version": "eval-coverage-gate-artifacts.v1",
                    "artifacts": [
                        _gate_artifact(surface, profile, f"{profile}-gate", gate)
                        for surface, profile in (
                            ("regulations/student_rules", "handbook"),
                            (
                                "regulations/institutional_rules",
                                "institutional-rules-release-baseline",
                            ),
                            ("curriculum/curriculum_plan", "curriculum"),
                            ("official_web/stable_reference", "official-web-stable-reference"),
                        )
                    ],
                },
            )
            ragas = _write_json(
                root / "ragas-diagnostic.combined.json",
                {
                    "schema_version": "ragas-diagnostic-combined-report.v1",
                    "report_id": "ragas_diagnostic_combined",
                    "summary": {"low_score_threshold": 0.8},
                    "cases": [
                        {
                            "surface_key": "regulations/student_rules",
                            "case_id": "student-case",
                            "status": "completed",
                            "scores": {"answer_relevancy": 0.7},
                        }
                    ],
                },
            )

            with self.assertRaisesRegex(
                ValueError, "failure_attribution.metric_failures.answer_relevancy is required"
            ):
                build_eval_coverage_snapshot(
                    gate_artifacts_path=manifest,
                    ragas_diagnostic_path=ragas,
                    source_git_head="git-main",
                )

    def test_snapshot_accepts_release_acceptance_result_gate_artifact_kind(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            release_result = _write_json(
                root / "student-release-result.json",
                {
                    "fixture": "student_rules_release_acceptance.v1.json",
                    "cases": [
                        {"case_id": "passed-case", "status": "passed"},
                        {"case_id": "failed-case", "status": "failed"},
                    ],
                },
            )
            gate = _write_json(
                root / "gate.json",
                {
                    "schema_version": 1,
                    "gate_report": {"overall_verdict": "pass"},
                    "deterministic": {
                        "run_count": 1,
                        "run_pass_counts": [1],
                        "run_failed_counts": [0],
                    },
                },
            )
            manifest = _write_json(
                root / "gate-artifacts.json",
                {
                    "schema_version": "eval-coverage-gate-artifacts.v1",
                    "artifacts": [
                        {
                            "artifact_id": "student-release-acceptance",
                            "artifact_kind": "release_acceptance_result",
                            "path": str(release_result),
                            "profile_id": "handbook",
                            "surface_key": "regulations/student_rules",
                        },
                        _gate_artifact(
                            "regulations/institutional_rules",
                            "institutional-rules-release-baseline",
                            "institutional-gate",
                            gate,
                        ),
                        _gate_artifact(
                            "curriculum/curriculum_plan",
                            "curriculum",
                            "curriculum-gate",
                            gate,
                        ),
                        _gate_artifact(
                            "official_web/stable_reference",
                            "official-web-stable-reference",
                            "official-gate",
                            gate,
                        ),
                    ],
                },
            )

            snapshot = build_eval_coverage_snapshot(
                gate_artifacts_path=manifest, source_git_head="git-main"
            )

        by_surface = {surface["surfaceKey"]: surface for surface in snapshot["surfaces"]}
        last_gate = by_surface["regulations/student_rules"]["lastGate"]
        self.assertEqual(last_gate["artifactKind"], "release_acceptance_result")
        self.assertEqual(last_gate["caseCount"], 2)
        self.assertEqual(last_gate["passedCount"], 1)
        self.assertEqual(last_gate["failedCount"], 1)
        self.assertEqual(last_gate["status"], "failed")
        self.assertEqual(last_gate["reasons"], ["release_acceptance_failed"])

    def test_snapshot_rejects_release_acceptance_result_unknown_case_status(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            release_result = _write_json(
                root / "student-release-result.json",
                {
                    "fixture": "student_rules_release_acceptance.v1.json",
                    "cases": [{"case_id": "unknown-case", "status": "skipped"}],
                },
            )
            gate = _write_json(
                root / "gate.json",
                {
                    "schema_version": 1,
                    "gate_report": {"overall_verdict": "pass"},
                    "deterministic": {
                        "run_count": 1,
                        "run_pass_counts": [1],
                        "run_failed_counts": [0],
                    },
                },
            )
            manifest = _write_json(
                root / "gate-artifacts.json",
                {
                    "schema_version": "eval-coverage-gate-artifacts.v1",
                    "artifacts": [
                        {
                            "artifact_id": "student-release-acceptance",
                            "artifact_kind": "release_acceptance_result",
                            "path": str(release_result),
                            "profile_id": "handbook",
                            "surface_key": "regulations/student_rules",
                        },
                        _gate_artifact(
                            "regulations/institutional_rules",
                            "institutional-rules-release-baseline",
                            "institutional-gate",
                            gate,
                        ),
                        _gate_artifact(
                            "curriculum/curriculum_plan",
                            "curriculum",
                            "curriculum-gate",
                            gate,
                        ),
                        _gate_artifact(
                            "official_web/stable_reference",
                            "official-web-stable-reference",
                            "official-gate",
                            gate,
                        ),
                    ],
                },
            )

            with self.assertRaisesRegex(ValueError, "status is unsupported"):
                build_eval_coverage_snapshot(
                    gate_artifacts_path=manifest, source_git_head="git-main"
                )


def _gate_artifact(surface_key: str, profile_id: str, artifact_id: str, path: Path) -> dict:
    return {
        "artifact_id": artifact_id,
        "artifact_kind": "formal_final_summary",
        "path": str(path),
        "profile_id": profile_id,
        "surface_key": surface_key,
    }


def _write_json(path: Path, payload: dict) -> Path:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


if __name__ == "__main__":
    unittest.main()
