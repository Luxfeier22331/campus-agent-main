from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.collected_notice_schedule_image_ocr_mini_batch import (
    build_schedule_image_ocr_mini_batch_manifest,
    build_schedule_image_ocr_mini_batch_post_run_preview,
)


class CollectedNoticeScheduleImageOcrMiniBatchTests(unittest.TestCase):
    def test_manifest_selects_only_baseline_eligible_execute_now_schedule_images(self) -> None:
        manifest = build_schedule_image_ocr_mini_batch_manifest(
            consumer_admission_manifest=_consumer_manifest(),
            multimodal_candidate_inventory=_candidate_inventory(),
            generated_at="2026-04-29T12:00:00+08:00",
        )

        self.assertEqual(
            manifest["execution_manifest"]["phase"], "phase-06-3-schedule-image-ocr-mini-batch"
        )
        self.assertEqual(manifest["execution_manifest"]["counts"]["selected_notice_count"], 2)
        self.assertEqual(manifest["execution_manifest"]["counts"]["selected_image_count"], 2)
        self.assertEqual(
            [row["source_notice_id"] for row in manifest["evidence_inventory"]],
            ["355867", "355881"],
        )
        self.assertEqual(
            [row["object_key"] for row in manifest["evidence_inventory"]],
            [
                "authenticated_notice_portal/attachment-a/capture/table-a.png",
                "authenticated_notice_portal/attachment-b/capture/table-b.png",
            ],
        )
        self.assertTrue(all(row["object_exists"] for row in manifest["evidence_inventory"]))
        self.assertEqual(manifest["gap_report"]["blocked_candidate_count"], 2)
        self.assertEqual(
            [row["source_notice_id"] for row in manifest["gap_report"]["blocked_candidates"]],
            ["355122", "355900"],
        )

    def test_post_run_preview_merges_ocr_text_and_extracts_transport_rows(self) -> None:
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            _write_ocr_output(root / "355867" / "image-1", notice_id="355867")
            manifest = build_schedule_image_ocr_mini_batch_manifest(
                consumer_admission_manifest=_consumer_manifest(),
                multimodal_candidate_inventory=_candidate_inventory(),
                generated_at="2026-04-29T12:00:00+08:00",
            )

            preview = build_schedule_image_ocr_mini_batch_post_run_preview(
                searchable_notice_preview={"units": [_searchable_unit()]},
                execution_manifest=manifest["execution_manifest"],
                ocr_output_dir=root,
                generated_at="2026-04-29T12:30:00+08:00",
            )

        self.assertFalse(preview["searchable_merge_preview"]["write_enabled"])
        merged_unit = preview["searchable_merge_preview"]["units"][0]
        self.assertEqual(merged_unit["source_notice_id"], "355867")
        self.assertEqual(merged_unit["multimodal_merge_status"], "completed")
        self.assertIn("4月28日-5月5日", merged_unit["search_text_preview"])

        replay = preview["transport_replay_dry_run"]
        self.assertFalse(replay["write_enabled"])
        self.assertFalse(replay["current_promotion_enabled"])
        self.assertEqual(replay["extracted_schedule_row_count"], 1)
        row = replay["transport_schedule_rows"][0]
        self.assertEqual(row["source_notice_id"], "355867")
        self.assertEqual(row["route_id"], "route:fengtai-to-haidian")
        self.assertEqual(row["departure_time"], "08:00")
        self.assertEqual(row["service_date_ranges"], [["2026-04-28", "2026-05-05"]])
        self.assertEqual(preview["transport_consistency_report"]["verdict"], "passed")
        closeout = preview["media_extraction_closeout_result_manifest"]
        self.assertEqual(
            closeout["schema_version"], "notice_media_extraction_closeout_result_manifest.v1"
        )
        self.assertEqual(closeout["results"][0]["candidate_id"], "notice-mm:a")
        self.assertEqual(closeout["results"][0]["status"], "completed")
        self.assertEqual(closeout["results"][0]["attempt_id"], "notice-mm:a:attempt:1")
        self.assertEqual(closeout["results"][0]["attempt_number"], 1)


def _consumer_manifest() -> dict[str, object]:
    return {
        "entries": [
            {
                "source_notice_id": "355122",
                "title": "baseline source",
                "consumption_class": "search_only",
                "ocr_priority": "search_only",
                "overlay_kind": "covered_by_official_baseline",
            },
            {
                "source_notice_id": "355867",
                "title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
                "consumption_class": "needs_multimodal",
                "ocr_priority": "execute_now",
                "overlay_kind": "temporary_overlay",
                "temporal_relation": "active_or_future_window",
                "baseline_gate_reason_codes": ["temporary_window_detected"],
            },
            {
                "source_notice_id": "355881",
                "title": "关于开通丰台校区社会实践专车的通知",
                "consumption_class": "needs_multimodal",
                "ocr_priority": "execute_now",
                "overlay_kind": "temporary_overlay",
                "temporal_relation": "active_or_future_window",
                "baseline_gate_reason_codes": ["temporary_window_detected"],
            },
            {
                "source_notice_id": "355900",
                "title": "machine review",
                "consumption_class": "needs_multimodal",
                "ocr_priority": "machine_review_required",
                "overlay_kind": "unresolved_machine_review",
            },
        ]
    }


def _candidate_inventory() -> dict[str, object]:
    return {
        "candidates": [
            _candidate("355867", "notice-mm:a", "attachment-0001", 1, "table-a.png"),
            _candidate("355881", "notice-mm:b", "attachment-0001", 1, "table-b.png"),
            _candidate("355900", "notice-mm:c", "attachment-0001", 1, "table-c.png"),
            {
                **_candidate("355122", "notice-mm:d", "attachment-0001", 1, "table-d.png"),
                "status": "skipped",
            },
        ]
    }


def _candidate(
    notice_id: str,
    candidate_id: str,
    media_ref_id: str,
    image_index: int,
    filename: str,
) -> dict[str, object]:
    return {
        "candidate_id": candidate_id,
        "unit_id": f"searchable:notice:muc_internal_portal:{notice_id}",
        "source_notice_id": notice_id,
        "title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
        "published_at": "2026-04-25 13:11",
        "media_ref_id": media_ref_id,
        "image_index": image_index,
        "media_kind": "image",
        "processing_family": "schedule_image_ocr",
        "priority": "high",
        "status": "pending",
        "reason_codes": ["image_attachment_pending_text_extraction"],
        "source_object_ref": {
            "bucket": "campus-rag-source",
            "key": f"authenticated_notice_portal/attachment-{candidate_id[-1]}/capture/{filename}",
            "sha256": "a" * 64,
            "byte_size": 123,
            "mime_type": "image/png",
        },
    }


def _searchable_unit() -> dict[str, object]:
    return {
        "unit_id": "searchable:notice:muc_internal_portal:355867",
        "source_channel": "authenticated_notice_portal",
        "source_surface": "notice",
        "source_corpus": "campus_notices",
        "source_collection": "internal_notice",
        "site_id": "muc_internal_portal",
        "source_notice_id": "355867",
        "source_document_id": "notice:muc_internal_portal:355867",
        "title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
        "published_at": "2026-04-25 13:11",
        "source_url": "https://my.muc.edu.cn/#/print?type=5&notice_id=355867",
        "body_text": "现将4月27日-5月5日期间两校区班车及地铁接驳车运营安排通知如下。",
        "body_excerpt": "现将4月27日-5月5日期间两校区班车及地铁接驳车运营安排通知如下。",
        "search_text": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
        "source_object_refs": [{"bucket": "campus-rag-source", "key": "source.json"}],
        "multimodal_status": "pending",
        "target_hints": {"candidate_targets": ["transport_schedule"]},
        "updated_at": "2026-04-29T00:00:00+00:00",
    }


def _write_ocr_output(image_dir: Path, *, notice_id: str) -> None:
    image_dir.mkdir(parents=True)
    manifest = {
        "notice_id": notice_id,
        "notice_title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
        "release_time": "2026-04-25 13:11",
        "organization": "丰台校区管委会办公室",
        "image_index": 1,
        "attachment_ref_id": "attachment-0001",
        "filename": "table-a.png",
        "mime_type": "image/png",
        "byte_size": 123,
        "sha256": "a" * 64,
        "object_key": "authenticated_notice_portal/attachment-a/capture/table-a.png",
        "image_use": "schedule_table_image",
    }
    result = {
        "provider": "fixture-ocr",
        "model": "fixture-table-v1",
        "confidence": "medium",
        "extracted_text": "4月28日-5月5日 丰台校区至海淀校区 08:00",
        "tables": [
            [["日期", "线路", "发车时间"], ["4月28日-5月5日", "丰台校区→海淀校区", "08:00"]]
        ],
        "layout_elements": [{"type": "table"}],
    }
    (image_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
    )
    (image_dir / "ocr-result.json").write_text(
        json.dumps(result, ensure_ascii=False), encoding="utf-8"
    )
    (image_dir / "text.txt").write_text(result["extracted_text"], encoding="utf-8")
    (image_dir / "tables.json").write_text(
        json.dumps({"tables": result["tables"]}, ensure_ascii=False), encoding="utf-8"
    )


if __name__ == "__main__":
    unittest.main()
