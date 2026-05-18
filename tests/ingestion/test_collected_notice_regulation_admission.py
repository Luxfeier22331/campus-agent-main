from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_regulation_admission import (
    PHASE_06_R1_ID,
    build_collected_notice_regulation_admission_preview,
    preview_to_output_files,
)


def _regulation_unit(
    *,
    source_notice_id: str,
    title: str,
    body_text: str,
    multimodal_status: str = "not_required",
    target_hints: list[str] | None = None,
    source_object_refs: list[dict[str, object]] | None = None,
    attachment_refs: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "schema_version": "collected_notice_searchable_unit.v1",
        "unit_id": f"searchable:notice:muc_internal_portal:{source_notice_id}",
        "source_channel": "authenticated_notice_portal",
        "source_surface": "notice",
        "source_corpus": "campus_notices",
        "source_collection": "internal_notice",
        "site_id": "muc_internal_portal",
        "source_notice_id": source_notice_id,
        "source_document_id": f"notice:muc_internal_portal:{source_notice_id}",
        "title": title,
        "published_at": "2026-04-29 09:00",
        "source_url": (
            f"https://my.muc.edu.cn/#/print?type=11&notice_id={source_notice_id}&show_type=1"
        ),
        "source_home_url": "https://my.muc.edu.cn",
        "source_object_refs": source_object_refs
        if source_object_refs is not None
        else [
            {
                "bucket": "campus-rag-source",
                "key": f"authenticated_notice_portal/{source_notice_id}/source-truth/notice.json",
                "role": "source-truth/notice-manifest.json",
            }
        ],
        "run_provenance": {"run_id": "muc_internal_portal:notice:test"},
        "body_text": body_text,
        "body_excerpt": body_text[:120],
        "attachment_refs": attachment_refs or [],
        "multimodal_status": multimodal_status,
        "search_text": f"{title}\n{body_text}",
        "visibility_level": "restricted",
        "entitlement_groups": ["campus_members"],
        "admission_batch_id": "phase-04-dry-run-searchable-preview",
        "normalized_markdown_object_key": (
            f"campus_notices/internal_notice/{source_notice_id}/canonical.md"
        ),
        "target_hints": {
            "candidate_targets": target_hints if target_hints is not None else ["regulation"],
            "policy": "keyword-hint-preview-v1",
        },
        "defer_reason_codes": [],
        "invalid_reason_codes": [],
        "reason_codes": [],
        "created_at": "2026-04-29T00:00:00+00:00",
        "updated_at": "2026-04-29T00:00:00+00:00",
    }


class CollectedNoticeRegulationAdmissionTests(unittest.TestCase):
    def test_wrapper_notice_stays_search_only_and_does_not_get_target_identity(self) -> None:
        preview = build_collected_notice_regulation_admission_preview(
            searchable_notice_preview={
                "units": [
                    _regulation_unit(
                        source_notice_id="188888",
                        title="关于印发《中央民族大学采购工作管理办法》的通知",
                        body_text=(
                            "各单位：\n"
                            "现将《中央民族大学采购工作管理办法》印发给你们，请遵照执行。\n"
                            "附件：中央民族大学采购工作管理办法"
                        ),
                    )
                ]
            },
            multimodal_candidate_inventory={"candidates": []},
            generated_at="2026-04-29T00:00:00+08:00",
        )

        manifest = preview.admission_manifest
        self.assertEqual(manifest["phase"], PHASE_06_R1_ID)
        self.assertFalse(manifest["write_enabled"])
        self.assertEqual(manifest["counts"]["entry_count"], 1)
        self.assertEqual(manifest["counts"]["downstream_admitted"], 0)
        entry = manifest["entries"][0]
        self.assertEqual(entry["consumption_class"], "search_only")
        self.assertEqual(entry["regulation_admission_class"], "wrapper_only_searchable")
        self.assertIsNone(entry["target"])
        self.assertIsNone(entry["target_surface"])
        self.assertIsNone(entry["target_identity_preview"])

        audit_row = preview.candidate_audit["candidates"][0]
        self.assertEqual(audit_row["regulation_admission_class"], "wrapper_only_searchable")
        self.assertIn("wrapper_notice_not_canonical_text", audit_row["reason_codes"])

    def test_institutional_and_scoped_candidates_get_non_notice_identity(self) -> None:
        preview = build_collected_notice_regulation_admission_preview(
            searchable_notice_preview={
                "units": [
                    _regulation_unit(
                        source_notice_id="188889",
                        title="中央民族大学采购工作管理办法",
                        body_text=(
                            "第一条 为规范学校采购工作，依据有关法律法规，制定本办法。\n"
                            "第二条 本办法适用于中央民族大学各单位采购活动。"
                        ),
                    ),
                    _regulation_unit(
                        source_notice_id="188890",
                        title="中央民族大学2026年硕博连读研究生招生实施细则",
                        body_text=(
                            "一、选拔对象\n"
                            "符合条件的在校研究生可以申请。\n"
                            "二、申请条件\n"
                            "申请人应完成培养方案规定课程并通过综合考核。"
                        ),
                    ),
                ]
            },
            multimodal_candidate_inventory={"candidates": []},
            generated_at="2026-04-29T00:00:00+08:00",
        )

        entries_by_notice = {
            entry["source_notice_id"]: entry for entry in preview.admission_manifest["entries"]
        }
        institutional = entries_by_notice["188889"]
        self.assertEqual(
            institutional["regulation_admission_class"],
            "institutional_rules_candidate",
        )
        self.assertEqual(institutional["consumption_class"], "downstream_admitted")
        self.assertEqual(institutional["target"], "regulation")
        self.assertEqual(institutional["target_collection"], "institutional_rules")
        self.assertEqual(institutional["fact_readiness_state"], "ready_from_text")
        self.assertEqual(institutional["target_admission_state"], "stage_ready")
        self.assertEqual(institutional["fact_readiness"]["missing_fact_groups"], [])
        self.assertNotIn("188889", institutional["target_identity_preview"])
        self.assertIn("institutional_regulation:muc:", institutional["target_identity_preview"])

        scoped = entries_by_notice["188890"]
        self.assertEqual(scoped["regulation_admission_class"], "scoped_rules_candidate")
        self.assertEqual(scoped["consumption_class"], "downstream_admitted")
        self.assertEqual(scoped["target"], "regulation")
        self.assertEqual(scoped["target_collection"], "scoped_rules")
        self.assertEqual(scoped["fact_readiness_state"], "ready_from_text")
        self.assertEqual(scoped["target_admission_state"], "stage_ready")
        self.assertEqual(scoped["fact_readiness"]["missing_fact_groups"], [])
        self.assertNotIn("188890", scoped["target_identity_preview"])

    def test_historical_unit_scoped_annual_cycle_rule_is_held_in_notice_level(self) -> None:
        unit = _regulation_unit(
            source_notice_id="186977",
            title="药学院2021年硕博连读博士研究生招生实施细则",
            body_text=(
                "一、硕博连读研究生选拔对象\n"
                "我校全日制非定向、优秀的三年级学术型硕士研究生。\n"
                "二、学生申请硕博连读研究生的条件\n"
                "申请人应完成规定课程学习并通过综合考核。\n"
                "三、招生程序\n"
                "学院审核确定硕博连读拟录取名单，并进行公示。"
            ),
        )
        unit["published_at"] = "2021-01-05 19:02"

        preview = build_collected_notice_regulation_admission_preview(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={"candidates": []},
            generated_at="2026-05-01T00:00:00+08:00",
        )

        entry = preview.admission_manifest["entries"][0]
        self.assertEqual(entry["consumption_class"], "search_only")
        self.assertEqual(
            entry["regulation_admission_class"],
            "historical_annual_cycle_rule_hold",
        )
        self.assertIsNone(entry["target"])
        self.assertIsNone(entry["target_surface"])
        self.assertIsNone(entry["target_identity_preview"])
        self.assertEqual(entry["target_collection"], "scoped_rules")
        self.assertEqual(entry["cycle_year"], "2021")
        self.assertEqual(entry["applicability_status"], "historical_expired")
        self.assertEqual(entry["promotion_disposition"], "hold_in_internal_notice")
        self.assertEqual(entry["recommended_query_surface"], "notice_level_query")
        self.assertEqual(entry["fact_readiness_state"], "not_applicable")
        self.assertEqual(entry["target_admission_state"], "search_only")
        self.assertEqual(entry["fact_readiness"]["missing_fact_groups"], [])
        self.assertIn("historical_annual_cycle_rule_not_promoted", entry["reason_codes"])

    def test_historical_hold_prefers_structured_cycle_year_metadata(self) -> None:
        unit = _regulation_unit(
            source_notice_id="186978",
            title="药学院硕博连读博士研究生招生实施细则",
            body_text=(
                "一、硕博连读研究生选拔对象\n"
                "申请人应完成规定课程学习并通过综合考核。\n"
                "二、招生程序\n"
                "学院审核确定硕博连读拟录取名单，并进行公示。"
            ),
        )
        unit["published_at"] = "2026-01-05 19:02"
        unit["role_metadata"] = {"cycle_year": "2021"}

        preview = build_collected_notice_regulation_admission_preview(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={"candidates": []},
            generated_at="2026-05-01T00:00:00+08:00",
        )

        entry = preview.admission_manifest["entries"][0]
        self.assertEqual(entry["regulation_admission_class"], "historical_annual_cycle_rule_hold")
        self.assertEqual(entry["consumption_class"], "search_only")
        self.assertEqual(entry["cycle_year"], "2021")
        self.assertEqual(entry["fact_readiness_state"], "not_applicable")
        self.assertEqual(entry["target_admission_state"], "search_only")

    def test_historical_time_window_scoped_rule_is_held_in_notice_level(self) -> None:
        unit = _regulation_unit(
            source_notice_id="191176",
            title="生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
            body_text=(
                "第一条 为加强2021年暑假期间实验室安全管理，制定本规定。\n"
                "第二条 本规定适用于暑假期间学院实验室开放、值守和安全检查工作。\n"
                "第三条 暑假期间进入实验室须履行审批和登记手续。"
            ),
        )
        unit["published_at"] = "2021-07-05 09:00"

        preview = build_collected_notice_regulation_admission_preview(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={"candidates": []},
            generated_at="2026-05-01T00:00:00+08:00",
        )

        entry = preview.admission_manifest["entries"][0]
        self.assertEqual(entry["consumption_class"], "search_only")
        self.assertEqual(
            entry["regulation_admission_class"],
            "historical_time_window_rule_hold",
        )
        self.assertIsNone(entry["target"])
        self.assertIsNone(entry["target_surface"])
        self.assertIsNone(entry["target_identity_preview"])
        self.assertEqual(entry["target_collection"], "scoped_rules")
        self.assertEqual(entry["cycle_year"], "2021")
        self.assertEqual(entry["applicability_status"], "historical_expired")
        self.assertEqual(entry["promotion_disposition"], "hold_in_internal_notice")
        self.assertEqual(entry["recommended_query_surface"], "notice_level_query")
        self.assertEqual(entry["fact_readiness_state"], "not_applicable")
        self.assertEqual(entry["target_admission_state"], "search_only")
        self.assertEqual(entry["fact_readiness"]["missing_fact_groups"], [])
        self.assertIn("historical_time_window_rule_not_promoted", entry["reason_codes"])

    def test_current_time_window_scoped_rule_remains_admitted(self) -> None:
        preview = build_collected_notice_regulation_admission_preview(
            searchable_notice_preview={
                "units": [
                    _regulation_unit(
                        source_notice_id="199176",
                        title="生命与环境科学学院关于2026年暑假期间实验室安全管理规定",
                        body_text=(
                            "第一条 为加强2026年暑假期间实验室安全管理，制定本规定。\n"
                            "第二条 本规定适用于暑假期间学院实验室开放、值守和安全检查工作。"
                        ),
                    )
                ]
            },
            multimodal_candidate_inventory={"candidates": []},
            generated_at="2026-05-01T00:00:00+08:00",
        )

        entry = preview.admission_manifest["entries"][0]
        self.assertEqual(entry["regulation_admission_class"], "scoped_rules_candidate")
        self.assertEqual(entry["consumption_class"], "downstream_admitted")
        self.assertEqual(entry["target_collection"], "scoped_rules")
        self.assertEqual(entry["target_surface"], "regulations/scoped_rules")
        self.assertEqual(entry["fact_readiness_state"], "ready_from_text")
        self.assertEqual(entry["target_admission_state"], "stage_ready")

    def test_duplicate_hold_preserves_primary_and_source_provenance(self) -> None:
        body = (
            "第一条 为规范实验室安全管理，制定本规定。\n第二条 本规定适用于学校实验室安全管理工作。"
        )
        preview = build_collected_notice_regulation_admission_preview(
            searchable_notice_preview={
                "units": [
                    _regulation_unit(
                        source_notice_id="188891",
                        title="中央民族大学实验室安全管理规定",
                        body_text=body,
                    ),
                    _regulation_unit(
                        source_notice_id="188892",
                        title="中央民族大学实验室安全管理规定",
                        body_text=body,
                    ),
                ]
            },
            multimodal_candidate_inventory={"candidates": []},
            generated_at="2026-04-29T00:00:00+08:00",
        )

        entries_by_notice = {
            entry["source_notice_id"]: entry for entry in preview.admission_manifest["entries"]
        }
        self.assertEqual(
            entries_by_notice["188891"]["regulation_admission_class"],
            "institutional_rules_candidate",
        )
        duplicate = entries_by_notice["188892"]
        self.assertEqual(duplicate["consumption_class"], "search_only")
        self.assertEqual(duplicate["regulation_admission_class"], "duplicate_hold")
        self.assertEqual(duplicate["duplicate_primary_source_notice_id"], "188891")
        self.assertEqual(
            duplicate["source_object_refs"][0]["role"], "source-truth/notice-manifest.json"
        )

        audit_duplicate = [
            row
            for row in preview.candidate_audit["candidates"]
            if row["source_notice_id"] == "188892"
        ][0]
        self.assertEqual(audit_duplicate["duplicate_primary_source_notice_id"], "188891")
        self.assertEqual(
            audit_duplicate["candidate_key"],
            entries_by_notice["188891"]["candidate_key"],
        )

    def test_multimodal_pending_regulation_candidate_is_blocked_from_downstream(self) -> None:
        preview = build_collected_notice_regulation_admission_preview(
            searchable_notice_preview={
                "units": [
                    _regulation_unit(
                        source_notice_id="188893",
                        title="中央民族大学学生管理规定",
                        body_text="详见附件。",
                        multimodal_status="pending",
                        attachment_refs=[
                            {
                                "attachment_ref_id": "attachment-0001",
                                "resource_role": "attachment",
                                "mime_type": "application/pdf",
                                "object_key": "authenticated_notice_portal/188893/attachment.pdf",
                            }
                        ],
                    )
                ]
            },
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "unit_id": "searchable:notice:muc_internal_portal:188893",
                        "status": "pending",
                        "target_hints": ["regulation"],
                    }
                ]
            },
            generated_at="2026-04-29T00:00:00+08:00",
        )

        entry = preview.admission_manifest["entries"][0]
        self.assertEqual(entry["consumption_class"], "needs_multimodal")
        self.assertEqual(entry["regulation_admission_class"], "needs_multimodal")
        self.assertIsNone(entry["target"])
        self.assertIn("required_media_pending", entry["reason_codes"])
        self.assertEqual(entry["fact_readiness_state"], "blocked_by_required_media")
        self.assertEqual(preview.rejected_deferred_source_report["entry_count"], 1)
        self.assertTrue(
            preview.rejected_deferred_source_report["entries"][0][
                "multimodal_processing_could_change_decision"
            ]
        )

    def test_notice_with_only_regulation_citation_is_not_regulation_candidate(self) -> None:
        unit = _regulation_unit(
            source_notice_id="354925",
            title="关于办理2025年度个人所得税综合所得年度汇算的通知",
            body_text=(
                "根据《个人所得税综合所得汇算清缴管理办法》有关规定，"
                "请师生按期办理个人所得税年度汇算。"
            ),
            multimodal_status="pending",
            attachment_refs=[
                {
                    "attachment_ref_id": "attachment-0001",
                    "resource_role": "inline_image",
                    "mime_type": "image/png",
                    "object_key": "authenticated_notice_portal/354925/qr.png",
                }
            ],
        )

        preview = build_collected_notice_regulation_admission_preview(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "unit_id": "searchable:notice:muc_internal_portal:354925",
                        "status": "pending",
                        "target_hints": ["regulation"],
                    }
                ]
            },
            generated_at="2026-04-29T00:00:00+08:00",
        )

        self.assertEqual(preview.admission_manifest["entries"], [])
        self.assertEqual(preview.candidate_audit["candidates"], [])
        self.assertEqual(preview.rejected_deferred_source_report["entry_count"], 0)

    def test_owner_text_ready_reclassifies_pending_file_release_regulation(self) -> None:
        unit = _regulation_unit(
            source_notice_id="188897",
            title="中央民族大学学生管理规定",
            body_text="详见原始文件。",
            multimodal_status="pending",
            target_hints=["regulation"],
            attachment_refs=[
                {
                    "attachment_ref_id": "file_release:188897",
                    "resource_role": "released_file",
                    "mime_type": "application/pdf",
                    "object_key": "authenticated_notice_portal/file-release-188897/source.pdf",
                }
            ],
        )
        unit["source_surface"] = "file_release"
        unit["source_document_id"] = "file-release:muc_internal_portal:188897"
        unit["unit_id"] = "searchable:file_release:muc_internal_portal:188897"
        owner_text = (
            "第一条 为规范学生管理工作，维护学校正常教育教学秩序，制定本规定。\n"
            "第二条 本规定适用于中央民族大学学生管理工作。"
        )

        preview = build_collected_notice_regulation_admission_preview(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "unit_id": "searchable:file_release:muc_internal_portal:188897",
                        "status": "pending",
                        "target_hints": ["regulation"],
                    }
                ]
            },
            recovered_owner_text_by_unit={
                "searchable:file_release:muc_internal_portal:188897": owner_text
            },
            generated_at="2026-04-29T00:00:00+08:00",
        )

        entry = preview.admission_manifest["entries"][0]
        self.assertEqual(entry["consumption_class"], "downstream_admitted")
        self.assertEqual(
            entry["regulation_admission_class"],
            "institutional_rules_candidate",
        )
        self.assertEqual(entry["owner_text_status"], "ready")
        self.assertEqual(entry["multimodal_policy"], "completed")
        self.assertEqual(entry["target_collection"], "institutional_rules")
        self.assertIn("owner_text_recovered", entry["reason_codes"])
        self.assertEqual(preview.rejected_deferred_source_report["entry_count"], 0)

    def test_structured_operational_notice_is_not_selected_as_regulation(self) -> None:
        preview = build_collected_notice_regulation_admission_preview(
            searchable_notice_preview={
                "units": [
                    _regulation_unit(
                        source_notice_id="188896",
                        title="关于丰台校区开展废旧非机动车集中清理及规范停放管理的通知",
                        body_text=(
                            "一、清理范围\n"
                            "长期无人认领、停放不规范的非机动车。\n"
                            "二、清理安排\n"
                            "请师生按要求规范停放。"
                        ),
                    )
                ]
            },
            multimodal_candidate_inventory={"candidates": []},
            generated_at="2026-04-29T00:00:00+08:00",
        )

        self.assertEqual(preview.admission_manifest["entries"], [])
        self.assertEqual(preview.candidate_audit["candidates"], [])

    def test_queue_trace_limits_candidate_scope_and_output_files_are_phase_artifacts(self) -> None:
        preview = build_collected_notice_regulation_admission_preview(
            searchable_notice_preview={
                "units": [
                    _regulation_unit(
                        source_notice_id="188894",
                        title="中央民族大学科研经费管理办法",
                        body_text=(
                            "第一条 为规范科研经费管理，制定本办法。\n"
                            "第二条 本办法适用于学校科研项目。"
                        ),
                    ),
                    _regulation_unit(
                        source_notice_id="188895",
                        title="中央民族大学教室管理规定",
                        body_text=(
                            "第一条 为规范教室管理，制定本规定。\n第二条 本规定适用于学校教室使用。"
                        ),
                    ),
                ]
            },
            multimodal_candidate_inventory={"candidates": []},
            queue_consume_trace={
                "trace_rows": [
                    {
                        "job_id": "job-188895",
                        "source_surface": "notice",
                        "source_identity": "muc_internal_portal:188895",
                        "searchable_unit_refs": ["searchable:notice:muc_internal_portal:188895"],
                        "source_object_refs": [
                            {
                                "bucket": "campus-rag-source",
                                "key": "queue/188895.json",
                                "role": "collector_bundle",
                            }
                        ],
                    }
                ]
            },
            generated_at="2026-04-29T00:00:00+08:00",
        )

        self.assertEqual(
            [entry["source_notice_id"] for entry in preview.admission_manifest["entries"]],
            ["188895"],
        )
        self.assertEqual(
            preview.source_to_searchable_trace["entries"][0]["queue_job_id"],
            "job-188895",
        )
        self.assertEqual(
            set(preview_to_output_files(preview)),
            {
                "regulation-consumer-admission-manifest.json",
                "regulation-candidate-audit.json",
                "regulation-rejected-deferred-source-report.json",
                "regulation-source-to-searchable-trace.json",
            },
        )


if __name__ == "__main__":
    unittest.main()
