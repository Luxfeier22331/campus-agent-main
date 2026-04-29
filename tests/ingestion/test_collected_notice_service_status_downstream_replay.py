from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_service_status_downstream_replay import (
    PHASE_06_SERVICE_STATUS_ID,
    build_service_status_batch_preview,
    preview_to_output_files,
)


def _service_status_unit(
    *,
    source_notice_id: str = "355283",
    title: str = "校医院清明节假期工作安排",
    published_at: str = "2026-03-27 15:44",
    body_text: str | None = None,
    multimodal_status: str = "not_required",
    target_hints: list[str] | None = None,
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
        "source_object_refs": [
            {
                "bucket": "campus-rag-source",
                "key": (
                    f"authenticated_notice_portal/{source_notice_id}/2026/"
                    "source-truth/notice-manifest.json"
                ),
                "role": "source-truth/notice-manifest.json",
            }
        ],
        "run_provenance": {
            "run_id": "muc_internal_portal:notice:test",
        },
        "body_text": body_text
        or (
            "根据学校2026年清明节放假时间安排，2026年4月4日--4月6日为清明节假期，"
            "现将校医院2026年清明节期间值班安排通知如下："
            "海淀校区：一、门诊时间：8：00--11：30 14：00--17：00。"
        ),
        "body_excerpt": "清明节期间两校区只开放急诊。",
        "attachment_refs": [],
        "multimodal_status": multimodal_status,
        "target_hints": {
            "candidate_targets": (["service_status"] if target_hints is None else target_hints),
            "policy": "notice-family-classification.v1",
        },
        "classification": {
            "notice_family": "service_status_override",
            "primary_route": "service_status_candidate",
            "evidence_strength": "strong",
        },
        "created_at": "2026-04-29T00:00:00+08:00",
        "updated_at": "2026-04-29T00:00:00+08:00",
    }


class CollectedNoticeServiceStatusDownstreamReplayTests(unittest.TestCase):
    def test_batch_stages_current_extractable_service_status_without_current_promotion(
        self,
    ) -> None:
        preview = build_service_status_batch_preview(
            searchable_notice_preview={"units": [_service_status_unit()]},
            multimodal_candidate_inventory={"candidates": []},
            generated_at="2026-04-05T12:00:00+08:00",
        )

        self.assertEqual(preview.admission_manifest["phase"], PHASE_06_SERVICE_STATUS_ID)
        self.assertFalse(preview.replay_dry_run["write_enabled"])
        self.assertFalse(preview.stage_report["current_promotion_enabled"])
        self.assertEqual(preview.admission_manifest["counts"]["downstream_admitted"], 1)
        entry = preview.admission_manifest["entries"][0]
        self.assertEqual(entry["consumption_class"], "downstream_admitted")
        self.assertEqual(entry["target"], "service_status")
        self.assertEqual(entry["reason_codes"], ["service_status_current_window_admitted"])

        self.assertEqual(preview.replay_dry_run["service_status_record_count"], 1)
        record = preview.replay_dry_run["service_status_records"][0]
        self.assertEqual(record["subject_id"], "service-counter:campus-hospital")
        self.assertEqual(record["observed_status"], "limited_service")
        self.assertEqual(record["related_notice_refs"], ["notice:muc_internal_portal:355283"])
        self.assertEqual(preview.stage_report["stage_candidate_count"], 1)
        self.assertEqual(preview.consistency_report["verdict"], "passed")
        self.assertEqual(
            preview.source_to_searchable_downstream_trace["admitted_source_notice_ids"],
            ["355283"],
        )

    def test_batch_blocks_pending_multimodal_service_status_candidates(self) -> None:
        preview = build_service_status_batch_preview(
            searchable_notice_preview={
                "units": [
                    _service_status_unit(
                        source_notice_id="355650",
                        title="关于静园10号楼负一层女浴室试运行的通知",
                        body_text=(
                            "静园10号楼负一层女浴室将于4月16日试运行。开放时间：早7:00-晚22:30。"
                        ),
                        multimodal_status="pending",
                    )
                ]
            },
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "unit_id": "searchable:notice:muc_internal_portal:355650",
                        "status": "pending",
                    }
                ]
            },
            generated_at="2026-04-29T00:00:00+08:00",
        )

        self.assertEqual(preview.admission_manifest["counts"]["downstream_admitted"], 0)
        self.assertEqual(preview.admission_manifest["counts"]["needs_multimodal"], 1)
        self.assertEqual(
            preview.admission_manifest["entries"][0]["consumption_class"], "needs_multimodal"
        )
        self.assertEqual(preview.replay_dry_run["service_status_record_count"], 0)
        self.assertEqual(preview.stage_report["stage_candidate_count"], 0)
        self.assertEqual(preview.consistency_report["verdict"], "blocked")
        self.assertEqual(
            preview.rejected_deferred_source_report["entries"][0]["reason_codes"],
            ["multimodal_not_ready"],
        )

    def test_batch_keeps_expired_service_status_search_only(self) -> None:
        preview = build_service_status_batch_preview(
            searchable_notice_preview={"units": [_service_status_unit()]},
            multimodal_candidate_inventory={"candidates": []},
            generated_at="2026-04-29T00:00:00+08:00",
        )

        entry = preview.admission_manifest["entries"][0]
        self.assertEqual(entry["consumption_class"], "search_only")
        self.assertIsNone(entry["target"])
        self.assertEqual(entry["reason_codes"], ["not_current_effective_at_generated_time"])
        self.assertEqual(preview.replay_dry_run["service_status_record_count"], 0)
        self.assertEqual(preview.stage_report["stage_candidate_count"], 0)
        self.assertEqual(preview.consistency_report["verdict"], "passed")
        self.assertEqual(
            preview.rejected_deferred_source_report["entries"][0]["reason_codes"],
            ["not_current_effective_at_generated_time"],
        )

    def test_batch_selects_only_service_status_target_units(self) -> None:
        preview = build_service_status_batch_preview(
            searchable_notice_preview={
                "units": [
                    _service_status_unit(),
                    _service_status_unit(
                        source_notice_id="999999",
                        title="普通通知",
                        body_text="普通通知正文",
                        target_hints=[],
                    ),
                ]
            },
            multimodal_candidate_inventory={"candidates": []},
            generated_at="2026-04-05T12:00:00+08:00",
        )

        self.assertEqual(preview.admission_manifest["counts"]["entry_count"], 1)
        self.assertEqual(preview.replay_dry_run["source_notice_ids"], ["355283"])

    def test_output_files_are_service_status_replay_artifacts(self) -> None:
        preview = build_service_status_batch_preview(
            searchable_notice_preview={"units": [_service_status_unit()]},
            multimodal_candidate_inventory={"candidates": []},
            generated_at="2026-04-05T12:00:00+08:00",
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
