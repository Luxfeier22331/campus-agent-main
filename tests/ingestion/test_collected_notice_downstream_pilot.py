from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_downstream_pilot import (
    PHASE_06_ID,
    build_transport_schedule_batch_preview,
    build_transport_schedule_single_notice_pilot_preview,
    preview_to_output_files,
)


def _pilot_unit(
    *,
    source_notice_id: str = "355512",
    title: str = "关于本周六临时增加学生班车班次的通知",
    published_at: str = "2026-04-10 12:09",
    multimodal_status: str = "not_required",
    target_hints: list[str] | None = None,
    body_text: str | None = None,
    body_excerpt: str = "本周六（4月11日）临时增加一趟6：40的学生班次。",
    search_text: str | None = None,
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
        "published_at": published_at,
        "source_url": (
            f"https://my.muc.edu.cn/#/print?type=5&notice_id={source_notice_id}&show_type=1"
        ),
        "source_home_url": "https://my.muc.edu.cn",
        "source_object_refs": [
            {
                "bucket": "campus-rag-source",
                "key": (
                    f"authenticated_notice_portal/{source_notice_id}/2026/"
                    "source-truth/notice-manifest.json"
                ),
                "role": "source-truth/notice-manifest.json",
            },
            {
                "bucket": "campus-rag-source",
                "key": (
                    f"authenticated_notice_portal/{source_notice_id}/2026/"
                    "source-truth/content-blocks.jsonl"
                ),
                "role": "source-truth/content-blocks.jsonl",
            },
        ],
        "run_provenance": {
            "run_id": "muc_internal_portal:notice:test",
            "replay_phase": "phase-04-dry-run-reimport-and-universal-search-preview",
        },
        "body_text": body_text
        or (
            "各位老师、同学们：\n"
            "本周六（4月11日），“丰台校区”发往“海淀校区”的通勤班车"
            "临时增加一趟6：40的学生班次。\n"
            "特此通知。\n"
            "丰台校区管委会办公室\n"
            "2026年4月10日"
        ),
        "body_excerpt": body_excerpt,
        "attachment_refs": [],
        "multimodal_status": multimodal_status,
        "search_text": search_text
        or "关于本周六临时增加学生班车班次的通知\n本周六（4月11日）6：40",
        "visibility_level": "restricted",
        "entitlement_groups": ["campus_members"],
        "admission_batch_id": "phase-04-dry-run-searchable-preview",
        "normalized_markdown_object_key": "campus_notices/355512/canonical.md",
        "target_hints": {
            "candidate_targets": (["transport_schedule"] if target_hints is None else target_hints),
            "policy": "keyword-hint-preview-v1",
        },
        "defer_reason_codes": [],
        "invalid_reason_codes": [],
        "reason_codes": [],
        "created_at": "2026-04-29T00:00:00+00:00",
        "updated_at": "2026-04-29T00:00:00+00:00",
    }


class CollectedNoticeDownstreamPilotTests(unittest.TestCase):
    def test_transport_schedule_pilot_admits_and_extracts_single_notice(self) -> None:
        preview = build_transport_schedule_single_notice_pilot_preview(
            searchable_notice_preview={"units": [_pilot_unit()]},
            multimodal_candidate_inventory={"candidates": []},
            source_notice_id="355512",
            generated_at="2026-04-29T00:00:00+08:00",
        )

        manifest = preview.admission_manifest
        self.assertEqual(manifest["phase"], PHASE_06_ID)
        self.assertEqual(manifest["selection_scope"], "single_notice_pilot")
        self.assertEqual(manifest["counts"]["downstream_admitted"], 1)
        entry = manifest["entries"][0]
        self.assertEqual(entry["consumption_class"], "downstream_admitted")
        self.assertEqual(entry["title"], "关于本周六临时增加学生班车班次的通知")
        self.assertEqual(entry["published_at"], "2026-04-10 12:09")
        self.assertEqual(entry["body_excerpt"], "本周六（4月11日）临时增加一趟6：40的学生班次。")
        self.assertEqual(entry["target"], "transport_schedule")
        self.assertEqual(entry["multimodal_policy"], "not_required")
        self.assertEqual(entry["searchable_unit_id"], _pilot_unit()["unit_id"])
        self.assertEqual(entry["baseline_status"], "missing")
        self.assertEqual(entry["baseline_effective_date"], "")
        self.assertEqual(entry["ocr_priority"], "search_only")
        self.assertFalse(entry["current_eligible"])

        dry_run = preview.replay_dry_run
        self.assertFalse(dry_run["write_enabled"])
        self.assertEqual(dry_run["source_notice_id"], "355512")
        self.assertEqual(dry_run["searchable_unit_id"], _pilot_unit()["unit_id"])
        self.assertEqual(dry_run["extracted_schedule_row_count"], 1)
        row = dry_run["transport_schedule_rows"][0]
        self.assertEqual(row["route_id"], "route:fengtai-to-haidian")
        self.assertEqual(row["route_direction"], "fengtai_to_haidian")
        self.assertEqual(row["departure_time"], "06:40")
        self.assertEqual(row["weekday_scope"], "weekends")
        self.assertEqual(row["rider_type"], "学生")
        self.assertEqual(row["service_date_ranges"], [["2026-04-11", "2026-04-11"]])
        self.assertEqual(row["effective_from"], "2026-04-11")

        stage = preview.stage_report
        self.assertFalse(stage["write_enabled"])
        self.assertFalse(stage["current_promotion_enabled"])
        self.assertEqual(stage["stage_candidate_count"], 1)

        consistency = preview.consistency_report
        self.assertEqual(consistency["verdict"], "passed")
        self.assertEqual(consistency["searchable_unit_id"], _pilot_unit()["unit_id"])
        self.assertGreaterEqual(consistency["source_object_ref_count"], 2)

        trace = preview.source_to_searchable_downstream_trace
        self.assertEqual(trace["source_notice_id"], "355512")
        self.assertEqual(trace["downstream_target"], "transport_schedule")
        self.assertEqual(
            trace["downstream_stage_candidate_ids"],
            [stage["stage_candidates"][0]["stage_candidate_id"]],
        )

    def test_transport_schedule_pilot_admits_text_complete_pending_supplemental_image(
        self,
    ) -> None:
        preview = build_transport_schedule_single_notice_pilot_preview(
            searchable_notice_preview={"units": [_pilot_unit(multimodal_status="pending")]},
            multimodal_candidate_inventory={"candidates": []},
            source_notice_id="355512",
            generated_at="2026-04-29T00:00:00+08:00",
        )

        self.assertEqual(preview.admission_manifest["counts"]["downstream_admitted"], 1)
        self.assertEqual(
            preview.admission_manifest["entries"][0]["consumption_class"], "downstream_admitted"
        )
        self.assertEqual(preview.replay_dry_run["extracted_schedule_row_count"], 1)
        self.assertEqual(preview.stage_report["stage_candidate_count"], 1)
        self.assertEqual(preview.consistency_report["verdict"], "passed")
        admitted_entry = preview.admission_manifest["entries"][0]
        self.assertEqual(admitted_entry["fact_readiness_state"], "ready_from_text")
        self.assertIn("body_facts_complete", admitted_entry["reason_codes"])
        self.assertNotIn("multimodal_not_ready", admitted_entry["reason_codes"])
        self.assertEqual(admitted_entry["baseline_status"], "missing")
        self.assertEqual(admitted_entry["overlay_kind"], "temporary_overlay")
        self.assertEqual(admitted_entry["ocr_priority"], "search_only")
        self.assertIn(
            "transport_baseline_missing",
            admitted_entry["baseline_gate_reason_codes"],
        )

    def test_transport_schedule_batch_admits_ready_and_reports_blocked_candidates(self) -> None:
        pending_unit = _pilot_unit(
            source_notice_id="355867",
            title="关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
            multimodal_status="pending",
            body_text=(
                "现将4月27日-5月5日期间两校区班车及地铁接驳车运营安排通知如下："
                "一、4月27日两校区班车安排。二、4月28日-5月5日两校区班车及地铁接驳车安排。"
            ),
        )
        preview = build_transport_schedule_batch_preview(
            searchable_notice_preview={
                "units": [
                    _pilot_unit(),
                    pending_unit,
                    _pilot_unit(
                        source_notice_id="999999",
                        title="普通通知",
                        target_hints=[],
                        body_text="普通通知正文",
                    ),
                ]
            },
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "unit_id": pending_unit["unit_id"],
                        "status": "pending",
                    }
                ]
            },
            generated_at="2026-04-29T00:00:00+08:00",
        )

        manifest = preview.admission_manifest
        self.assertEqual(manifest["selection_scope"], "target_batch")
        self.assertEqual(manifest["counts"]["entry_count"], 2)
        self.assertEqual(manifest["counts"]["downstream_admitted"], 1)
        self.assertEqual(manifest["counts"]["needs_multimodal"], 1)
        self.assertEqual(
            [entry["source_notice_id"] for entry in manifest["entries"]],
            ["355512", "355867"],
        )

        self.assertEqual(preview.replay_dry_run["source_notice_count"], 2)
        self.assertEqual(preview.replay_dry_run["extracted_schedule_row_count"], 1)
        self.assertEqual(preview.stage_report["stage_candidate_count"], 1)
        self.assertEqual(preview.consistency_report["verdict"], "passed")
        self.assertEqual(preview.consistency_report["blocked_source_count"], 1)
        self.assertEqual(preview.rejected_deferred_source_report["entry_count"], 1)
        self.assertEqual(
            preview.rejected_deferred_source_report["entries"][0]["reason_codes"],
            ["required_media_pending"],
        )
        blocked_entry = manifest["entries"][1]
        self.assertEqual(blocked_entry["baseline_status"], "missing")
        self.assertEqual(blocked_entry["overlay_kind"], "awaiting_baseline")
        self.assertEqual(blocked_entry["ocr_priority"], "defer_until_baseline")
        self.assertEqual(blocked_entry["fact_readiness_state"], "blocked_by_required_media")

    def test_transport_schedule_policy_marks_post_baseline_delta_candidate(self) -> None:
        unit = _pilot_unit(
            source_notice_id="355122",
            title="关于两校区学生通勤班车增加班次的通知",
            published_at="2026-03-18 11:12",
            multimodal_status="pending",
            body_text=(
                "为方便我校师生两校区通勤，3月20日（本周五）起，"
                "对两校区学生通勤班车增加2个班次。具体见下表："
            ),
            body_excerpt=(
                "为方便我校师生两校区通勤，3月20日（本周五）起，"
                "对两校区学生通勤班车增加2个班次。具体见下表："
            ),
            search_text="关于两校区学生通勤班车增加班次的通知\n3月20日起增加2个班次",
        )

        preview = build_transport_schedule_batch_preview(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={
                "candidates": [{"unit_id": unit["unit_id"], "status": "pending"}]
            },
            generated_at="2026-04-29T00:00:00+08:00",
            transport_baseline_effective_date="2026-03-01",
        )

        entry = preview.admission_manifest["entries"][0]
        self.assertEqual(entry["baseline_status"], "available")
        self.assertEqual(entry["baseline_effective_date"], "2026-03-01")
        self.assertEqual(entry["temporal_relation"], "post_baseline")
        self.assertEqual(entry["overlay_kind"], "baseline_delta_candidate")
        self.assertEqual(entry["ocr_priority"], "execute_now")
        self.assertFalse(entry["current_eligible"])
        self.assertIn("post_baseline_delta_candidate", entry["baseline_gate_reason_codes"])

    def test_transport_schedule_policy_marks_official_baseline_covered_source(self) -> None:
        unit = _pilot_unit(
            source_notice_id="355122",
            title="关于两校区学生通勤班车增加班次的通知",
            published_at="2026-03-18 11:12",
            multimodal_status="pending",
            body_text=(
                "为方便我校师生两校区通勤，3月20日（本周五）起，"
                "对两校区学生通勤班车增加2个班次。具体见下表："
            ),
            body_excerpt=(
                "为方便我校师生两校区通勤，3月20日（本周五）起，"
                "对两校区学生通勤班车增加2个班次。具体见下表："
            ),
            search_text="关于两校区学生通勤班车增加班次的通知\n3月20日起增加2个班次",
        )

        preview = build_transport_schedule_batch_preview(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={
                "candidates": [{"unit_id": unit["unit_id"], "status": "pending"}]
            },
            generated_at="2026-04-29T00:00:00+08:00",
            transport_baseline_effective_date="2026-03-01",
            transport_baseline_source_notice_ids=("355122",),
        )

        entry = preview.admission_manifest["entries"][0]
        self.assertEqual(entry["consumption_class"], "search_only")
        self.assertIsNone(entry["target"])
        self.assertEqual(entry["baseline_status"], "available")
        self.assertEqual(entry["temporal_relation"], "baseline_source")
        self.assertEqual(entry["overlay_kind"], "covered_by_official_baseline")
        self.assertEqual(entry["ocr_priority"], "search_only")
        self.assertIn("official_baseline_source_covered", entry["baseline_gate_reason_codes"])
        self.assertEqual(preview.stage_report["stage_candidate_count"], 0)

    def test_transport_schedule_policy_marks_active_temporary_overlay(self) -> None:
        unit = _pilot_unit(
            source_notice_id="355867",
            title="关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
            published_at="2026-04-25 13:11",
            multimodal_status="pending",
            body_text="现将4月27日-5月5日期间两校区班车及地铁接驳车运营安排通知如下。",
        )

        preview = build_transport_schedule_batch_preview(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={
                "candidates": [{"unit_id": unit["unit_id"], "status": "pending"}]
            },
            generated_at="2026-04-29T00:00:00+08:00",
            transport_baseline_effective_date="2026-03-01",
        )

        entry = preview.admission_manifest["entries"][0]
        self.assertEqual(entry["temporal_relation"], "active_or_future_window")
        self.assertEqual(entry["overlay_kind"], "temporary_overlay")
        self.assertEqual(entry["ocr_priority"], "execute_now")
        self.assertIn("temporary_window_detected", entry["baseline_gate_reason_codes"])

    def test_transport_schedule_policy_marks_one_off_weekend_overlay(self) -> None:
        preview = build_transport_schedule_batch_preview(
            searchable_notice_preview={"units": [_pilot_unit()]},
            multimodal_candidate_inventory={"candidates": []},
            generated_at="2026-04-29T00:00:00+08:00",
            transport_baseline_effective_date="2026-03-20",
        )

        entry = preview.admission_manifest["entries"][0]
        self.assertEqual(entry["temporal_relation"], "expired_temporary_window")
        self.assertEqual(entry["overlay_kind"], "temporary_overlay")
        self.assertEqual(entry["ocr_priority"], "search_only")
        self.assertIn("temporary_window_detected", entry["baseline_gate_reason_codes"])

    def test_transport_schedule_policy_prefers_temporary_window_over_reservation_start(
        self,
    ) -> None:
        unit = _pilot_unit(
            source_notice_id="355881",
            title="关于开通丰台校区社会实践专车的通知",
            published_at="2026-04-25 16:26",
            multimodal_status="pending",
            body_text=(
                "4月28日（周二）至4月30日（周四）临时开通社会实践专车。4月26日9：00起开放预约。"
            ),
        )

        preview = build_transport_schedule_batch_preview(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={
                "candidates": [{"unit_id": unit["unit_id"], "status": "pending"}]
            },
            generated_at="2026-04-29T00:00:00+08:00",
            transport_baseline_effective_date="2026-03-20",
        )

        entry = preview.admission_manifest["entries"][0]
        self.assertEqual(entry["temporal_relation"], "active_or_future_window")
        self.assertEqual(entry["overlay_kind"], "temporary_overlay")
        self.assertEqual(entry["ocr_priority"], "execute_now")
        self.assertIn("temporary_window_detected", entry["baseline_gate_reason_codes"])

    def test_transport_schedule_policy_keeps_pre_baseline_history_search_only(self) -> None:
        unit = _pilot_unit(
            source_notice_id="350001",
            title="关于寒假期间班车安排的通知",
            published_at="2026-02-01 09:00",
            multimodal_status="pending",
            body_text="寒假期间班车安排见下表。",
        )

        preview = build_transport_schedule_batch_preview(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={
                "candidates": [{"unit_id": unit["unit_id"], "status": "pending"}]
            },
            generated_at="2026-04-29T00:00:00+08:00",
            transport_baseline_effective_date="2026-03-01",
        )

        entry = preview.admission_manifest["entries"][0]
        self.assertEqual(entry["temporal_relation"], "pre_baseline")
        self.assertEqual(entry["overlay_kind"], "historical_search_only")
        self.assertEqual(entry["ocr_priority"], "search_only")
        self.assertFalse(entry["current_eligible"])

    def test_output_files_are_phase_six_pilot_artifacts(self) -> None:
        preview = build_transport_schedule_single_notice_pilot_preview(
            searchable_notice_preview={"units": [_pilot_unit()]},
            multimodal_candidate_inventory={"candidates": []},
            source_notice_id="355512",
            generated_at="2026-04-29T00:00:00+08:00",
        )

        self.assertEqual(
            set(preview_to_output_files(preview)),
            {
                "consumer-admission-manifest.json",
                "replay.dry-run.json",
                "stage-report.json",
                "consistency-report.json",
                "source-to-searchable-downstream-trace.json",
                "rejected-deferred-source-report.json",
            },
        )


if __name__ == "__main__":
    unittest.main()
