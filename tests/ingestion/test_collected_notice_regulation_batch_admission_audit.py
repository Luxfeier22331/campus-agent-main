from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.collected_notice_regulation_batch_admission_audit import (
    RegulationAdmissionExpectation,
    audit_collected_notice_regulation_admission_batch,
)


class CollectedNoticeRegulationBatchAdmissionAuditTest(unittest.TestCase):
    def test_audit_replays_selection_with_expectations_and_full_coverage_gate(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            selection_path = root / "selection.json"
            bundle_path = root / "notices-bundle.json"
            output_dir = root / "audit"
            _write_json(
                selection_path,
                {
                    "schema_version": "run14-policy-regulation-expanded.v1",
                    "selected_notice_ids": ["186977", "191176", "354006", "missing"],
                },
            )
            _write_json(
                bundle_path,
                [
                    _bundle_record(
                        notice_id="186977",
                        title="药学院2021年硕博连读博士研究生招生实施细则",
                        release_time="2021-01-05 19:02",
                        html=(
                            "<p>一、硕博连读研究生选拔对象</p>"
                            "<p>二、申请条件</p>"
                            "<p>三、招生程序</p>"
                        ),
                    ),
                    _bundle_record(
                        notice_id="191176",
                        title="生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                        release_time="2021-07-12 16:44",
                        html=(
                            "<p>根据学校近期关于加强暑假期间安全稳定的有关指示精神，"
                            "现将暑假期间（2021年7月16日至8月30日）学院实验室安全管理办法规定如下：</p>"
                            "<p>1、任何教师和学生不得私自带领与实验室无关人员进入实验室。</p>"
                        ),
                    ),
                    _bundle_record(
                        notice_id="354006",
                        title="中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则",
                        release_time="2025-12-16 11:19",
                        html=("<p>一、选拔对象</p><p>二、申请条件</p><p>三、招生程序</p>"),
                    ),
                ],
            )

            with self.assertRaisesRegex(ValueError, "missing selected notices"):
                audit_collected_notice_regulation_admission_batch(
                    selection_json=selection_path,
                    bundle_json=bundle_path,
                    output_dir=output_dir,
                    generated_at="2026-05-01T00:00:00+08:00",
                    expectations=(),
                    allow_missing=False,
                )

            report = audit_collected_notice_regulation_admission_batch(
                selection_json=selection_path,
                bundle_json=bundle_path,
                output_dir=output_dir,
                generated_at="2026-05-01T00:00:00+08:00",
                expectations=(
                    RegulationAdmissionExpectation(
                        notice_id="186977",
                        regulation_admission_class="historical_annual_cycle_rule_hold",
                        consumption_class="search_only",
                    ),
                    RegulationAdmissionExpectation(
                        notice_id="191176",
                        regulation_admission_class="historical_time_window_rule_hold",
                        consumption_class="search_only",
                    ),
                    RegulationAdmissionExpectation(
                        notice_id="354006",
                        regulation_admission_class="scoped_rules_candidate",
                        consumption_class="downstream_admitted",
                    ),
                ),
                allow_missing=True,
            )

            self.assertEqual(report["coverage"]["selected_notice_count"], 4)
            self.assertEqual(report["coverage"]["scanned_notice_count"], 3)
            self.assertEqual(report["coverage"]["missing_from_bundle"], ["missing"])
            self.assertEqual(report["expectation_failures"], [])
            self.assertEqual(report["historical_time_window_holds"], ["191176"])
            self.assertEqual(report["historical_annual_cycle_holds"], ["186977"])
            self.assertEqual(report["downstream_admitted"], ["354006"])
            self.assertTrue((output_dir / "summary.json").exists())
            self.assertTrue((output_dir / "admission-manifest.json").exists())
            self.assertTrue((output_dir / "coverage.json").exists())

    def test_audit_fails_closed_on_expectation_mismatch(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            selection_path = root / "selection.json"
            bundle_path = root / "notices-bundle.json"
            _write_json(selection_path, {"selected_notice_ids": ["191176"]})
            _write_json(
                bundle_path,
                [
                    _bundle_record(
                        notice_id="191176",
                        title="生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                        release_time="2021-07-12 16:44",
                        html="<p>2021年暑假期间实验室安全管理规定如下。</p><p>1、不得私自进入实验室。</p>",
                    )
                ],
            )

            with self.assertRaisesRegex(ValueError, "expectation failures"):
                audit_collected_notice_regulation_admission_batch(
                    selection_json=selection_path,
                    bundle_json=bundle_path,
                    output_dir=root / "audit",
                    generated_at="2026-05-01T00:00:00+08:00",
                    expectations=(
                        RegulationAdmissionExpectation(
                            notice_id="191176",
                            regulation_admission_class="scoped_rules_candidate",
                            consumption_class="downstream_admitted",
                        ),
                    ),
                    allow_missing=False,
                )


def _bundle_record(
    *, notice_id: str, title: str, release_time: str, html: str
) -> dict[str, object]:
    return {
        "notice_id": int(notice_id),
        "notice": {
            "notice_id": int(notice_id),
            "notice_title": title,
            "notice_release_time": release_time,
            "notice_content": html,
            "notice_browser_url": f"https://portal.example.edu/notices/{notice_id}",
        },
        "notice_attachments": [],
        "attachments": [],
        "links": [],
    }


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
