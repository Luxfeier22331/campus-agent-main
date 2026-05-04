from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.official_web_selected_write_preview_runtime_verifier import (
    BUNDLE_SCOPE_FULL_IMPACT,
    BUNDLE_SCOPE_TASK_SCOPE,
    OfficialWebSelectedWritePreviewRuntimeCase,
    default_official_web_selected_write_preview_runtime_cases,
    run_selected_write_preview_runtime_verification,
)


class OfficialWebSelectedWritePreviewRuntimeVerifierTest(unittest.TestCase):
    def test_default_cases_route_information_disclosure_phone_to_contact_directory(self) -> None:
        cases = default_official_web_selected_write_preview_runtime_cases()
        case_ids = {case.case_id for case in cases}

        self.assertNotIn(
            "service-guide-information-disclosure-phone-fail-close",
            case_ids,
        )
        phone_cases = [
            case for case in cases if case.user_goal == "信息公开联系电话是多少"
        ]
        self.assertEqual(len(phone_cases), 1)
        self.assertEqual(phone_cases[0].collection, "contact_directory")
        self.assertEqual(phone_cases[0].expected_payload_kind, "contact_directory_lookup")

    def test_runtime_verifier_writes_report_for_service_guide_and_contact_directory(self) -> None:
        preview_report = {
            "schema_version": "official_web_selected_write_preview_report.v1",
            "results": [
                {
                    "selected_write_id": "owrelease_selected_write_service",
                    "collection": "service_guide",
                    "inventory_id": "muc-it-vpn-service-guide",
                    "record_count": 1,
                    "full_record_count": 3,
                    "task_scope_display_names": ["中央民族大学 VPN 使用说明"],
                    "full_impact_display_names": [
                        "学生校园卡服务",
                        "中央民族大学 VPN 使用说明",
                    ],
                    "bundle": {"service_guide_records": [{"display_name": "中央民族大学 VPN 使用说明"}]},
                    "full_bundle": {
                        "service_guide_records": [{"display_name": "中央民族大学 VPN 使用说明"}]
                    },
                },
                {
                    "selected_write_id": "owrelease_selected_write_contact",
                    "collection": "contact_directory",
                    "inventory_id": "muc-information-disclosure-contact",
                    "record_count": 1,
                    "full_record_count": 2,
                    "task_scope_display_names": ["中央民族大学信息公开联系方式"],
                    "full_impact_display_names": [
                        "中央民族大学",
                        "中央民族大学信息公开联系方式",
                    ],
                    "bundle": {
                        "contact_records": [{"display_name": "中央民族大学信息公开联系方式"}]
                    },
                    "full_bundle": {
                        "contact_records": [{"display_name": "中央民族大学信息公开联系方式"}]
                    },
                },
            ],
        }
        cases = (
            OfficialWebSelectedWritePreviewRuntimeCase(
                case_id="service-runtime-1",
                collection="service_guide",
                inventory_id="muc-it-vpn-service-guide",
                mode="planner_runtime",
                user_goal="VPN入口在哪里",
                expected_target="campus-services-agent",
                expected_payload_kind="service_guide_lookup",
                expected_selected_tool="service_guide_lookup",
                expected_outcome="resolved_current",
                expected_resolved_display_name="中央民族大学 VPN 使用说明",
                expected_guide_focus="entry",
                max_selected_section_count=1,
                required_body_tokens=("vpn.muc.edu.cn",),
                forbidden_body_tokens=("EasyConnect", "下载客户端", "Install EasyConnect.pkg"),
            ),
            OfficialWebSelectedWritePreviewRuntimeCase(
                case_id="contact-runtime-1",
                collection="contact_directory",
                inventory_id="muc-information-disclosure-contact",
                mode="planner_runtime",
                user_goal="信息公开联系电话是多少",
                expected_target="campus-services-agent",
                expected_payload_kind="contact_directory_lookup",
                expected_selected_tool="contact_directory_lookup",
                expected_outcome="resolved_current",
                expected_resolved_display_name="中央民族大学信息公开联系方式",
                required_body_tokens=("010-68932551",),
            ),
        )

        def fake_runner(
            *,
            report_path: Path,
            selected_cases: tuple[OfficialWebSelectedWritePreviewRuntimeCase, ...],
            bundle_scope: str,
        ) -> dict[str, object]:
            self.assertEqual(report_path.name, "preview-report.json")
            self.assertEqual({case.case_id for case in selected_cases}, {"service-runtime-1", "contact-runtime-1"})
            self.assertEqual(bundle_scope, BUNDLE_SCOPE_TASK_SCOPE)
            return {
                "schema_version": "official_web_selected_write_preview_runtime_verification.v1",
                "runner": "supervisor-api-go",
                "results": [
                    {
                        "case_id": "service-runtime-1",
                        "collection": "service_guide",
                        "inventory_id": "muc-it-vpn-service-guide",
                        "selected_write_id": "owrelease_selected_write_service",
                        "passed": True,
                        "failures": [],
                        "observed": {
                            "target": "campus-services-agent",
                            "payload_kind": "service_guide_lookup",
                            "selected_tool": "service_guide_lookup",
                            "outcome": "resolved_current",
                            "resolved_display_name": "中央民族大学 VPN 使用说明",
                        },
                    },
                    {
                        "case_id": "contact-runtime-1",
                        "collection": "contact_directory",
                        "inventory_id": "muc-information-disclosure-contact",
                        "selected_write_id": "owrelease_selected_write_contact",
                        "passed": True,
                        "failures": [],
                        "observed": {
                            "target": "campus-services-agent",
                            "payload_kind": "contact_directory_lookup",
                            "selected_tool": "contact_directory_lookup",
                            "outcome": "resolved_current",
                            "resolved_display_name": "中央民族大学信息公开联系方式",
                        },
                    },
                ],
            }

        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            report_path = temp_root / "preview-report.json"
            report_path.write_text(
                json.dumps(preview_report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            output_dir = temp_root / "runtime-verification"
            report = run_selected_write_preview_runtime_verification(
                report_path=report_path,
                output_dir=output_dir,
                cases=cases,
                runner=fake_runner,
            )
            artifact = json.loads(report.output_path.read_text(encoding="utf-8"))

        self.assertTrue(report.passed)
        self.assertEqual(artifact["summary"]["total_cases"], 2)
        self.assertEqual(artifact["summary"]["passed_cases"], 2)
        self.assertEqual(artifact["summary"]["failed_cases"], 0)
        self.assertEqual(artifact["summary"]["bundle_scope"], BUNDLE_SCOPE_TASK_SCOPE)
        self.assertEqual(artifact["summary"]["uncovered_supported_targets"], [])
        self.assertEqual(
            artifact["summary"]["report_path"],
            str(report_path.resolve()),
        )

    def test_default_vpn_cases_define_focus_and_section_thresholds(self) -> None:
        cases = {
            case.case_id: case for case in default_official_web_selected_write_preview_runtime_cases()
        }

        entry_case = cases["service-guide-vpn-entry"]
        self.assertEqual(entry_case.expected_guide_focus, "entry")
        self.assertEqual(entry_case.max_selected_section_count, 1)
        self.assertIn("下载客户端", entry_case.forbidden_body_tokens)

        install_case = cases["service-guide-vpn-client-install"]
        self.assertEqual(install_case.expected_guide_focus, "procedure")
        self.assertEqual(
            install_case.required_selected_section_ids,
            ("service:official_web:vpn:procedure_group:client_install",),
        )
        self.assertEqual(install_case.max_selected_section_count, 1)
        self.assertIn("直接登录", install_case.forbidden_body_tokens)

    def test_default_cases_cover_office_hours_and_eligibility_focuses(self) -> None:
        cases = {
            case.case_id: case for case in default_official_web_selected_write_preview_runtime_cases()
        }

        office_hours_case = cases["service-guide-campus-card-office-hours"]
        self.assertEqual(office_hours_case.expected_guide_focus, "office_hours")
        self.assertIn("09:00-17:00", office_hours_case.required_body_tokens)

        eligibility_case = cases["service-guide-campus-card-eligibility"]
        self.assertEqual(eligibility_case.expected_guide_focus, "eligibility")
        self.assertIn("学生和教职工均可办理", eligibility_case.required_body_tokens)

    def test_runtime_verifier_passes_full_impact_scope_to_runner(self) -> None:
        preview_report = {
            "schema_version": "official_web_selected_write_preview_report.v1",
            "results": [
                {
                    "selected_write_id": "owrelease_selected_write_contact",
                    "collection": "contact_directory",
                    "inventory_id": "muc-information-disclosure-contact",
                    "record_count": 1,
                    "full_record_count": 2,
                    "task_scope_display_names": ["中央民族大学信息公开联系方式"],
                    "full_impact_display_names": ["中央民族大学", "中央民族大学信息公开联系方式"],
                    "bundle": {
                        "contact_records": [{"display_name": "中央民族大学信息公开联系方式"}]
                    },
                    "full_bundle": {
                        "contact_records": [
                            {"display_name": "中央民族大学"},
                            {"display_name": "中央民族大学信息公开联系方式"},
                        ]
                    },
                }
            ],
        }
        cases = (
            OfficialWebSelectedWritePreviewRuntimeCase(
                case_id="contact-runtime-full-impact",
                collection="contact_directory",
                inventory_id="muc-information-disclosure-contact",
                mode="planner_runtime",
                user_goal="信息公开联系电话是多少",
                expected_target="campus-services-agent",
                expected_payload_kind="contact_directory_lookup",
                expected_selected_tool="contact_directory_lookup",
                expected_outcome="resolved_current",
                expected_resolved_display_name="中央民族大学信息公开联系方式",
            ),
        )

        def fake_runner(
            *,
            report_path: Path,
            selected_cases: tuple[OfficialWebSelectedWritePreviewRuntimeCase, ...],
            bundle_scope: str,
        ) -> dict[str, object]:
            self.assertEqual(report_path.name, "preview-report.json")
            self.assertEqual(bundle_scope, BUNDLE_SCOPE_FULL_IMPACT)
            self.assertEqual(len(selected_cases), 1)
            return {
                "schema_version": "official_web_selected_write_preview_runtime_verification.v1",
                "runner": "supervisor-api-go",
                "results": [
                    {
                        "case_id": "contact-runtime-full-impact",
                        "collection": "contact_directory",
                        "inventory_id": "muc-information-disclosure-contact",
                        "selected_write_id": "owrelease_selected_write_contact",
                        "passed": True,
                        "failures": [],
                        "observed": {
                            "target": "campus-services-agent",
                            "payload_kind": "contact_directory_lookup",
                            "selected_tool": "contact_directory_lookup",
                            "outcome": "resolved_current",
                            "resolved_display_name": "中央民族大学信息公开联系方式",
                        },
                    }
                ],
            }

        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            report_path = temp_root / "preview-report.json"
            report_path.write_text(
                json.dumps(preview_report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            output_dir = temp_root / "runtime-verification"
            report = run_selected_write_preview_runtime_verification(
                report_path=report_path,
                output_dir=output_dir,
                cases=cases,
                bundle_scope=BUNDLE_SCOPE_FULL_IMPACT,
                runner=fake_runner,
            )
            artifact = json.loads(report.output_path.read_text(encoding="utf-8"))

        self.assertTrue(report.passed)
        self.assertEqual(artifact["summary"]["bundle_scope"], BUNDLE_SCOPE_FULL_IMPACT)

    def test_runtime_verifier_filters_default_cases_to_preview_targets(self) -> None:
        preview_report = {
            "schema_version": "official_web_selected_write_preview_report.v1",
            "results": [
                {
                    "selected_write_id": "owrelease_selected_write_service",
                    "collection": "service_guide",
                    "inventory_id": "muc-information-disclosure-application-process",
                    "record_count": 1,
                    "full_record_count": 5,
                    "task_scope_display_names": [
                        "中央民族大学信息公开依申请公开工作流程"
                    ],
                    "full_impact_display_names": [
                        "中央民族大学信息公开依申请公开工作流程"
                    ],
                    "bundle": {
                        "service_guide_records": [
                            {
                                "display_name": "中央民族大学信息公开依申请公开工作流程"
                            }
                        ]
                    },
                    "full_bundle": {
                        "service_guide_records": [
                            {
                                "display_name": "中央民族大学信息公开依申请公开工作流程"
                            }
                        ]
                    },
                },
            ],
        }

        def fake_runner(
            *,
            report_path: Path,
            selected_cases: tuple[OfficialWebSelectedWritePreviewRuntimeCase, ...],
            bundle_scope: str,
        ) -> dict[str, object]:
            self.assertEqual(report_path.name, "preview-report.json")
            self.assertEqual(bundle_scope, BUNDLE_SCOPE_TASK_SCOPE)
            self.assertEqual(
                {case.case_id for case in selected_cases},
                {
                    "service-guide-information-disclosure-procedure",
                    "service-guide-information-disclosure-entry-fail-close",
                },
            )
            return {
                "schema_version": "official_web_selected_write_preview_runtime_verification.v1",
                "runner": "supervisor-api-go",
                "results": [
                    {
                        "case_id": case.case_id,
                        "collection": case.collection,
                        "inventory_id": case.inventory_id,
                        "selected_write_id": "owrelease_selected_write_service",
                        "passed": True,
                        "failures": [],
                        "observed": {
                            "target": case.expected_target,
                            "payload_kind": case.expected_payload_kind,
                            "selected_tool": case.expected_selected_tool,
                            "outcome": case.expected_outcome,
                            "resolved_display_name": case.expected_resolved_display_name,
                        },
                    }
                    for case in selected_cases
                ],
            }

        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            report_path = temp_root / "preview-report.json"
            report_path.write_text(
                json.dumps(preview_report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            output_dir = temp_root / "runtime-verification"
            report = run_selected_write_preview_runtime_verification(
                report_path=report_path,
                output_dir=output_dir,
                runner=fake_runner,
            )

        self.assertTrue(report.passed)
        self.assertEqual(
            report.summary["covered_targets"],
            ["service_guide:muc-information-disclosure-application-process"],
        )
        self.assertEqual(report.summary["uncovered_supported_targets"], [])

    def test_runtime_verifier_uses_full_impact_targets_for_default_full_impact_cases(self) -> None:
        preview_report = {
            "schema_version": "official_web_selected_write_preview_report.v1",
            "results": [
                {
                    "selected_write_id": "owrelease_selected_write_service",
                    "collection": "service_guide",
                    "inventory_id": "muc-information-disclosure-application-process",
                    "record_count": 1,
                    "full_record_count": 3,
                    "task_scope_display_names": [
                        "中央民族大学信息公开依申请公开工作流程"
                    ],
                    "full_impact_display_names": [
                        "中央民族大学信息公开依申请公开工作流程",
                        "中央民族大学 VPN 使用说明",
                        "中央民族大学校园电子邮件服务",
                    ],
                    "bundle": {
                        "service_guide_records": [
                            {
                                "display_name": "中央民族大学信息公开依申请公开工作流程"
                            }
                        ]
                    },
                    "full_bundle": {
                        "service_guide_records": [
                            {
                                "display_name": "中央民族大学信息公开依申请公开工作流程",
                                "source_refs": [
                                    "https://xxgk.muc.edu.cn/info/1007/1113.htm"
                                ],
                            },
                            {
                                "display_name": "中央民族大学 VPN 使用说明",
                                "source_refs": [
                                    "https://met.muc.edu.cn/info/1046/1674.htm"
                                ],
                            },
                            {
                                "display_name": "中央民族大学校园电子邮件服务",
                                "source_refs": [
                                    "https://met.muc.edu.cn/info/1024/1090.htm"
                                ],
                            },
                        ]
                    },
                },
            ],
        }

        def fake_runner(
            *,
            report_path: Path,
            selected_cases: tuple[OfficialWebSelectedWritePreviewRuntimeCase, ...],
            bundle_scope: str,
        ) -> dict[str, object]:
            self.assertEqual(report_path.name, "preview-report.json")
            self.assertEqual(bundle_scope, BUNDLE_SCOPE_FULL_IMPACT)
            self.assertEqual(
                {case.case_id for case in selected_cases},
                {
                    "service-guide-information-disclosure-procedure",
                    "service-guide-information-disclosure-entry-fail-close",
                    "service-guide-email-materials",
                    "service-guide-vpn-entry",
                    "service-guide-vpn-client-install",
                },
            )
            return {
                "schema_version": "official_web_selected_write_preview_runtime_verification.v1",
                "runner": "supervisor-api-go",
                "results": [
                    {
                        "case_id": case.case_id,
                        "collection": case.collection,
                        "inventory_id": case.inventory_id,
                        "selected_write_id": "owrelease_selected_write_service",
                        "passed": True,
                        "failures": [],
                        "observed": {
                            "target": case.expected_target,
                            "payload_kind": case.expected_payload_kind,
                            "selected_tool": case.expected_selected_tool,
                            "outcome": case.expected_outcome,
                            "resolved_display_name": case.expected_resolved_display_name,
                        },
                    }
                    for case in selected_cases
                ],
            }

        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            report_path = temp_root / "preview-report.json"
            report_path.write_text(
                json.dumps(preview_report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            output_dir = temp_root / "runtime-verification"
            report = run_selected_write_preview_runtime_verification(
                report_path=report_path,
                output_dir=output_dir,
                bundle_scope=BUNDLE_SCOPE_FULL_IMPACT,
                runner=fake_runner,
            )

        self.assertTrue(report.passed)
        self.assertEqual(
            report.summary["covered_targets"],
            [
                "service_guide:muc-information-disclosure-application-process",
                "service_guide:muc-it-email-service-guide",
                "service_guide:muc-it-vpn-service-guide",
            ],
        )

    def test_runtime_verifier_fails_when_supported_preview_result_has_no_case(self) -> None:
        preview_report = {
            "schema_version": "official_web_selected_write_preview_report.v1",
            "results": [
                {
                    "selected_write_id": "owrelease_selected_write_service",
                    "collection": "service_guide",
                    "inventory_id": "muc-it-vpn-service-guide",
                    "record_count": 1,
                    "full_record_count": 3,
                    "task_scope_display_names": ["中央民族大学 VPN 使用说明"],
                    "full_impact_display_names": ["中央民族大学 VPN 使用说明"],
                    "bundle": {"service_guide_records": [{"display_name": "中央民族大学 VPN 使用说明"}]},
                    "full_bundle": {
                        "service_guide_records": [{"display_name": "中央民族大学 VPN 使用说明"}]
                    },
                }
            ],
        }
        cases = (
            OfficialWebSelectedWritePreviewRuntimeCase(
                case_id="unrelated-case",
                collection="service_guide",
                inventory_id="muc-it-email-service-guide",
                mode="planner_runtime",
                user_goal="校园邮箱需要什么材料",
                expected_target="campus-services-agent",
                expected_payload_kind="service_guide_lookup",
                expected_selected_tool="service_guide_lookup",
                expected_outcome="resolved_current",
            ),
        )

        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            report_path = temp_root / "preview-report.json"
            report_path.write_text(
                json.dumps(preview_report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            output_dir = temp_root / "runtime-verification"
            report = run_selected_write_preview_runtime_verification(
                report_path=report_path,
                output_dir=output_dir,
                cases=cases,
                runner=lambda **_: {
                    "schema_version": "official_web_selected_write_preview_runtime_verification.v1",
                    "runner": "supervisor-api-go",
                    "results": [],
                },
            )

        self.assertFalse(report.passed)
        self.assertIn(
            "service_guide:muc-it-vpn-service-guide",
            report.summary["uncovered_supported_targets"],
        )


if __name__ == "__main__":
    unittest.main()
