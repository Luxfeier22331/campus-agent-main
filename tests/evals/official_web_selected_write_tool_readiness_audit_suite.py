from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.official_web_selected_write_tool_readiness_audit import (
    audit_selected_write_preview_report,
)


class OfficialWebSelectedWriteToolReadinessAuditTest(unittest.TestCase):
    def test_audit_accepts_realistic_service_guide_and_contact_directory_preview(self) -> None:
        report = {
            "schema_version": "official_web_selected_write_preview_report.v1",
            "results": [
                {
                    "selected_write_id": "owrelease_selected_write_service",
                    "collection": "service_guide",
                    "inventory_id": "muc-it-student-campus-card-service-guide",
                    "record_count": 1,
                    "full_record_count": 3,
                    "task_scope_display_names": ["学生校园卡服务"],
                    "full_impact_display_names": [
                        "学生校园卡服务",
                        "中央民族大学 VPN 使用说明",
                        "中央民族大学校园电子邮件服务",
                    ],
                    "bundle": {
                        "service_guide_records": [
                            {
                                "display_name": "学生校园卡服务",
                                "entry_refs": [{"label": "民大通APP"}],
                                "guide_sections": [
                                    {"section_type": "procedure"},
                                    {"section_type": "entry"},
                                ],
                                "procedure_groups": [
                                    {
                                        "group_id": "service:official_web:campus_card:procedure_group:default",
                                        "source_refs": ["https://met.muc.edu.cn/info/1027/1127.htm"],
                                        "steps": [
                                            {
                                                "content": "先办理挂失，再在自助补卡机补卡。",
                                                "source_refs": [
                                                    "https://met.muc.edu.cn/info/1027/1127.htm"
                                                ],
                                            }
                                        ],
                                    }
                                ],
                                "source_refs": ["https://met.muc.edu.cn/info/1027/1127.htm"],
                                "field_status": {
                                    "service_name": "present",
                                    "process_steps": "present",
                                    "service_entry": "present",
                                    "source_url": "present",
                                    "source_version_evidence": "present",
                                },
                            }
                        ]
                    },
                },
                {
                    "selected_write_id": "owrelease_selected_write_contact",
                    "collection": "contact_directory",
                    "inventory_id": "muc-information-disclosure-contact",
                    "record_count": 1,
                    "full_record_count": 2,
                    "task_scope_display_names": ["中央民族大学信息公开联系方式"],
                    "full_impact_display_names": ["中央民族大学", "中央民族大学信息公开联系方式"],
                    "bundle": {
                        "contact_records": [
                            {
                                "display_name": "中央民族大学信息公开联系方式",
                                "phones": [{"number": "010-68932551"}],
                                "aliases": ["中央民族大学信息公开联系方式", "联系方式"],
                                "source_refs": ["https://xxgk.muc.edu.cn/xxgk/xxgksx.htm"],
                                "field_status": {
                                    "organization_name": "present",
                                    "phone": "present",
                                    "source_url": "present",
                                    "source_version_evidence": "present",
                                },
                                "extraction_status": "ready",
                            }
                        ]
                    },
                },
            ],
        }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            report_path = output_dir / "preview-report.json"
            report_path.write_text(
                json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            result = audit_selected_write_preview_report(
                report_path=report_path,
                output_dir=output_dir,
            )

        self.assertTrue(result.passed)
        self.assertEqual(result.summary["service_guide_records"], 1)
        self.assertEqual(result.summary["contact_directory_records"], 1)
        self.assertEqual(result.summary["failed_records"], 0)

    def test_audit_fails_when_preview_cannot_support_answer_facing_contract(self) -> None:
        report = {
            "schema_version": "official_web_selected_write_preview_report.v1",
            "results": [
                {
                    "selected_write_id": "owrelease_selected_write_service",
                    "collection": "service_guide",
                    "inventory_id": "muc-information-disclosure-application-process",
                    "record_count": 1,
                    "full_record_count": 2,
                    "task_scope_display_names": [],
                    "full_impact_display_names": [
                        "中央民族大学信息公开依申请公开工作流程",
                        "学生校园卡服务",
                    ],
                    "bundle": {
                        "service_guide_records": [
                            {
                                "display_name": "中央民族大学信息公开依申请公开工作流程",
                                "entry_refs": [],
                                "guide_sections": [{"section_type": "procedure"}],
                                "source_refs": [
                                    "https://xxgk.muc.edu.cn/info/1007/1113.htm"
                                ],
                                "field_status": {
                                    "service_name": "present",
                                    "process_steps": "present",
                                    "service_entry": "source_not_provided",
                                    "source_url": "present",
                                    "source_version_evidence": "present",
                                },
                            }
                        ]
                    },
                }
            ],
        }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            report_path = output_dir / "preview-report.json"
            report_path.write_text(
                json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            result = audit_selected_write_preview_report(
                report_path=report_path,
                output_dir=output_dir,
            )

        self.assertFalse(result.passed)
        self.assertEqual(result.summary["failed_records"], 1)
        self.assertEqual(result.record_results[0].collection, "service_guide")
        self.assertIn(
            "missing task_scope_display_names for selected-write preview",
            result.record_results[0].failures,
        )

    def test_audit_allows_service_guide_without_entry_when_source_marks_not_provided(self) -> None:
        report = {
            "schema_version": "official_web_selected_write_preview_report.v1",
            "results": [
                {
                    "selected_write_id": "owrelease_selected_write_service",
                    "collection": "service_guide",
                    "inventory_id": "muc-it-vpn-service-guide",
                    "record_count": 1,
                    "full_record_count": 2,
                    "task_scope_display_names": ["中央民族大学 VPN 使用说明"],
                    "full_impact_display_names": ["中央民族大学 VPN 使用说明"],
                    "bundle": {
                        "service_guide_records": [
                            {
                                "display_name": "中央民族大学 VPN 使用说明",
                                "entry_refs": [],
                                "guide_sections": [{"section_type": "procedure"}],
                                "source_refs": [
                                    "https://met.muc.edu.cn/info/1027/1137.htm"
                                ],
                                "field_status": {
                                    "service_name": "present",
                                    "process_steps": "present",
                                    "service_entry": "source_not_provided",
                                    "source_url": "present",
                                    "source_version_evidence": "present",
                                },
                            }
                        ]
                    },
                }
            ],
        }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            report_path = output_dir / "preview-report.json"
            report_path.write_text(
                json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            result = audit_selected_write_preview_report(
                report_path=report_path,
                output_dir=output_dir,
            )

        self.assertTrue(result.passed)

    def test_audit_requires_information_disclosure_material_page_for_composed_service_guide(
        self,
    ) -> None:
        report = {
            "schema_version": "official_web_selected_write_preview_report.v1",
            "results": [
                {
                    "selected_write_id": "owrelease_selected_write_info_disclosure",
                    "collection": "service_guide",
                    "inventory_id": "muc-information-disclosure-application-process",
                    "record_count": 1,
                    "full_record_count": 2,
                    "task_scope_display_names": ["中央民族大学信息公开依申请公开工作流程"],
                    "full_impact_display_names": ["中央民族大学信息公开依申请公开工作流程"],
                    "bundle": {
                        "service_guide_records": [
                            {
                                "display_name": "中央民族大学信息公开依申请公开工作流程",
                                "entry_refs": [],
                                "guide_sections": [{"section_type": "procedure"}],
                                "source_refs": [
                                    "https://xxgk.muc.edu.cn/info/1007/1113.htm"
                                ],
                                "field_status": {
                                    "service_name": "present",
                                    "process_steps": "present",
                                    "required_materials": "present",
                                    "source_url": "present",
                                    "source_version_evidence": "present",
                                },
                            }
                        ]
                    },
                }
            ],
        }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            report_path = output_dir / "preview-report.json"
            report_path.write_text(
                json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            result = audit_selected_write_preview_report(
                report_path=report_path,
                output_dir=output_dir,
            )

        self.assertFalse(result.passed)
        self.assertIn(
            "information disclosure service guide must include material/source page: https://xxgk.muc.edu.cn/info/1007/1114.htm",
            result.record_results[0].failures,
        )

    def test_audit_fails_when_procedure_group_step_loses_source_refs(self) -> None:
        report = {
            "schema_version": "official_web_selected_write_preview_report.v1",
            "results": [
                {
                    "selected_write_id": "owrelease_selected_write_service",
                    "collection": "service_guide",
                    "inventory_id": "muc-it-vpn-service-guide",
                    "record_count": 1,
                    "full_record_count": 1,
                    "task_scope_display_names": ["中央民族大学 VPN 使用说明"],
                    "full_impact_display_names": ["中央民族大学 VPN 使用说明"],
                    "bundle": {
                        "service_guide_records": [
                            {
                                "display_name": "中央民族大学 VPN 使用说明",
                                "guide_sections": [{"section_type": "procedure"}],
                                "procedure_groups": [
                                    {
                                        "group_id": "service:official_web:vpn:procedure_group:client_install",
                                        "source_refs": ["https://met.muc.edu.cn/info/1027/1137.htm"],
                                        "steps": [{"content": "下载客户端。", "source_refs": []}],
                                    }
                                ],
                                "source_refs": ["https://met.muc.edu.cn/info/1027/1137.htm"],
                                "field_status": {
                                    "service_name": "present",
                                    "process_steps": "present",
                                    "source_url": "present",
                                    "source_version_evidence": "present",
                                },
                            }
                        ]
                    },
                }
            ],
        }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            report_path = output_dir / "preview-report.json"
            report_path.write_text(
                json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            result = audit_selected_write_preview_report(
                report_path=report_path,
                output_dir=output_dir,
            )

        self.assertFalse(result.passed)
        self.assertIn(
            "service_guide procedure_group step missing source_refs",
            result.record_results[0].failures,
        )


if __name__ == "__main__":
    unittest.main()
