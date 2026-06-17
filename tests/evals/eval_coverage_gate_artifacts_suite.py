from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.eval_coverage_gate_artifacts import (
    build_eval_coverage_gate_artifacts_manifest,
    main,
)
from campus_evals.eval_coverage_snapshot import EVAL_COVERAGE_GATE_ARTIFACTS_SCHEMA_VERSION


class EvalCoverageGateArtifactsSuite(unittest.TestCase):
    def test_cli_writes_manifest_from_explicit_artifact_file(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            _write_gate(root / "student.json")
            _write_gate(root / "institutional.json")
            _write_gate(root / "curriculum-curriculum-plan.json")
            _write_gate(root / "official.json")
            artifact_file = root / "artifacts.json"
            artifact_file.write_text(
                json.dumps(
                    {
                        "artifacts": [
                            _artifact(
                                surface_key="regulations/student_rules",
                                profile_id="regulations-student-rules",
                                artifact_id="student-rules-release-gate",
                                path=root / "student.json",
                            ),
                            _artifact(
                                surface_key="regulations/institutional_rules",
                                profile_id="regulations-institutional-rules",
                                artifact_id="institutional-release-gate",
                                path=root / "institutional.json",
                            ),
                            _artifact(
                                surface_key="curriculum/curriculum_plan",
                                profile_id="curriculum-curriculum-plan",
                                artifact_id="curriculum-curriculum-plan-release-gate",
                                path=root / "curriculum-curriculum-plan.json",
                            ),
                            _artifact(
                                surface_key="official_web/stable_reference",
                                profile_id="official-web-stable-reference-release",
                                artifact_id="official-stable-release-gate",
                                path=root / "official.json",
                            ),
                        ]
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            output = root / "eval-coverage-gate-artifacts.json"

            exit_code = main(
                [
                    "--artifact-file",
                    str(artifact_file),
                    "--output",
                    str(output),
                ]
            )
            payload = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["schema_version"], EVAL_COVERAGE_GATE_ARTIFACTS_SCHEMA_VERSION)
        self.assertEqual(len(payload["artifacts"]), 4)

    def test_builds_manifest_for_current_denominator_surfaces(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            _write_gate(root / "student.json")
            _write_gate(root / "institutional.json")
            _write_gate(root / "curriculum-curriculum-plan.json")
            _write_gate(root / "official.json")
            artifacts = [
                _artifact(
                    surface_key="regulations/student_rules",
                    profile_id="regulations-student-rules",
                    artifact_id="student-rules-release-gate",
                    path=root / "student.json",
                ),
                _artifact(
                    surface_key="regulations/institutional_rules",
                    profile_id="regulations-institutional-rules",
                    artifact_id="institutional-release-gate",
                    path=root / "institutional.json",
                ),
                _artifact(
                    surface_key="curriculum/curriculum_plan",
                    profile_id="curriculum-curriculum-plan",
                    artifact_id="curriculum-curriculum-plan-release-gate",
                    path=root / "curriculum-curriculum-plan.json",
                ),
                _artifact(
                    surface_key="official_web/stable_reference",
                    profile_id="official-web-stable-reference-release",
                    artifact_id="official-stable-release-gate",
                    path=root / "official.json",
                ),
            ]

            manifest = build_eval_coverage_gate_artifacts_manifest(artifacts)

        self.assertEqual(manifest["schema_version"], EVAL_COVERAGE_GATE_ARTIFACTS_SCHEMA_VERSION)
        self.assertEqual(
            [item["surface_key"] for item in manifest["artifacts"]],
            [
                "regulations/student_rules",
                "regulations/institutional_rules",
                "curriculum/curriculum_plan",
                "official_web/stable_reference",
            ],
        )
        self.assertEqual(manifest["artifacts"][0]["artifact_kind"], "formal_final_summary")

    def test_fails_when_current_denominator_surface_is_missing(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            _write_gate(root / "student.json")
            artifacts = [
                _artifact(
                    surface_key="regulations/student_rules",
                    profile_id="regulations-student-rules",
                    artifact_id="student-rules-release-gate",
                    path=root / "student.json",
                )
            ]

            with self.assertRaisesRegex(ValueError, "missing gate artifacts for surfaces"):
                build_eval_coverage_gate_artifacts_manifest(artifacts)

    def test_fails_when_surface_is_duplicated(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            _write_gate(root / "student-a.json")
            _write_gate(root / "student-b.json")
            artifacts = [
                _artifact(
                    surface_key="regulations/student_rules",
                    profile_id="regulations-student-rules",
                    artifact_id="student-rules-release-gate",
                    path=root / "student-a.json",
                ),
                _artifact(
                    surface_key="regulations/student_rules",
                    profile_id="regulations-student-rules",
                    artifact_id="student-rules-release-gate-copy",
                    path=root / "student-b.json",
                ),
            ]

            with self.assertRaisesRegex(ValueError, "duplicate gate artifact surface"):
                build_eval_coverage_gate_artifacts_manifest(artifacts)

    def test_cli_writes_manifest_from_explicit_artifact_json_objects(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            _write_gate(root / "student.json")
            _write_gate(root / "institutional.json")
            _write_gate(root / "curriculum-curriculum-plan.json")
            _write_gate(root / "official.json")
            output = root / "eval-coverage-gate-artifacts.json"

            exit_code = main(
                [
                    "--artifact",
                    _artifact_json(
                        "regulations/student_rules",
                        "regulations-student-rules",
                        "student-rules-release-gate",
                        root / "student.json",
                    ),
                    "--artifact",
                    _artifact_json(
                        "regulations/institutional_rules",
                        "regulations-institutional-rules",
                        "institutional-release-gate",
                        root / "institutional.json",
                    ),
                    "--artifact",
                    _artifact_json(
                        "curriculum/curriculum_plan",
                        "curriculum-curriculum-plan",
                        "curriculum-curriculum-plan-release-gate",
                        root / "curriculum-curriculum-plan.json",
                    ),
                    "--artifact",
                    _artifact_json(
                        "official_web/stable_reference",
                        "official-web-stable-reference-release",
                        "official-stable-release-gate",
                        root / "official.json",
                    ),
                    "--output",
                    str(output),
                ]
            )
            payload = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["schema_version"], EVAL_COVERAGE_GATE_ARTIFACTS_SCHEMA_VERSION)
        self.assertEqual(len(payload["artifacts"]), 4)

    def test_fails_when_artifact_path_does_not_exist(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            artifacts = [
                _artifact(
                    surface_key="regulations/student_rules",
                    profile_id="regulations-student-rules",
                    artifact_id="student-rules-release-gate",
                    path=root / "missing.json",
                )
            ]

            with self.assertRaisesRegex(ValueError, "artifact path does not exist"):
                build_eval_coverage_gate_artifacts_manifest(artifacts)

    def test_fails_when_artifact_file_does_not_exist(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)

            with self.assertRaisesRegex(ValueError, "artifact file does not exist"):
                main(
                    [
                        "--artifact-file",
                        str(root / "missing-input.json"),
                        "--output",
                        str(root / "output.json"),
                    ]
                )


def _artifact(
    *,
    surface_key: str,
    profile_id: str,
    artifact_id: str,
    path: Path,
) -> dict[str, str]:
    return {
        "artifact_id": artifact_id,
        "artifact_kind": "formal_final_summary",
        "path": str(path),
        "profile_id": profile_id,
        "surface_key": surface_key,
    }


def _artifact_json(
    surface_key: str,
    profile_id: str,
    artifact_id: str,
    path: Path,
) -> str:
    return json.dumps(
        _artifact(
            surface_key=surface_key,
            profile_id=profile_id,
            artifact_id=artifact_id,
            path=path,
        ),
        ensure_ascii=False,
    )


def _write_gate(path: Path) -> None:
    path.write_text('{"ok": true}\n', encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
