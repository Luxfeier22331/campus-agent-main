from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_multimodal_readiness import (
    PHASE_05_ID,
    build_collected_notice_multimodal_readiness_preview,
    preview_to_output_files,
)


def _unit(
    *,
    notice_id: str,
    title: str,
    attachments: list[dict[str, object]],
    reason_codes: list[str],
    targets: list[str] | None = None,
    body_text: str = "正文",
    source_surface: str = "notice",
) -> dict[str, object]:
    return {
        "schema_version": "collected_notice_searchable_unit.v1",
        "unit_id": f"searchable:{source_surface}:muc_internal_portal:{notice_id}",
        "source_channel": "authenticated_notice_portal",
        "source_surface": source_surface,
        "source_corpus": "campus_notices"
        if source_surface == "notice"
        else "authenticated_documents",
        "source_collection": "internal_notice"
        if source_surface == "notice"
        else "file_release_source",
        "site_id": "muc_internal_portal",
        "source_notice_id": notice_id,
        "source_document_id": f"{source_surface}:muc_internal_portal:{notice_id}",
        "title": title,
        "published_at": "2026-04-01 10:00",
        "source_url": f"https://my.muc.edu.cn/#/print?notice_id={notice_id}",
        "source_home_url": "https://my.muc.edu.cn",
        "source_object_refs": [
            {
                "bucket": "campus-rag-source",
                "key": f"authenticated_notice_portal/{notice_id}/source-truth/notice-manifest.json",
                "role": "source-truth/notice-manifest.json",
            }
        ],
        "run_provenance": {
            "run_id": f"muc_internal_portal:{source_surface}:test",
            "replay_phase": "phase-04-dry-run-reimport-and-universal-search-preview",
        },
        "body_text": body_text,
        "body_excerpt": body_text[:800],
        "attachment_refs": attachments,
        "multimodal_status": "pending" if reason_codes else "not_required",
        "search_text": f"{title}\n{body_text}",
        "visibility_level": "restricted",
        "entitlement_groups": ["campus_members"],
        "admission_batch_id": "phase-04-dry-run-searchable-preview",
        "normalized_markdown_object_key": f"campus_notices/{notice_id}/canonical.md",
        "target_hints": {
            "candidate_targets": list(targets or []),
            "policy": "keyword-hint-preview-v1",
        },
        "defer_reason_codes": [],
        "invalid_reason_codes": [],
        "reason_codes": reason_codes,
        "created_at": "2026-04-29T00:00:00+00:00",
        "updated_at": "2026-04-29T00:00:00+00:00",
    }


def _attachment(
    *,
    attachment_ref_id: str,
    filename: str,
    mime_type: str,
    role: str = "attachment",
    attachment_capture_policy: str = "fetch_to_quarantine",
    attachment_capture_state: str = "uploaded_quarantine",
    retention_class: str = "quarantine_candidate",
) -> dict[str, object]:
    return {
        "attachment_ref_id": attachment_ref_id,
        "ref_order": 1,
        "resource_role": role,
        "content_kind": "inline_image" if role == "inline_image" else None,
        "anchor_text": filename,
        "original_filename": filename,
        "source_url": f"https://my.muc.edu.cn/files/{filename}",
        "final_url": f"https://my.muc.edu.cn/files/{filename}",
        "object_key": f"authenticated_notice_portal/attachment/{filename}",
        "content_sha256": f"sha256-{attachment_ref_id}",
        "mime_type": mime_type,
        "byte_size": 1234,
        "storage_provider": "object_store",
        "ingest_status": "uploaded",
        "attachment_capture_policy": attachment_capture_policy,
        "attachment_capture_state": attachment_capture_state,
        "retention_class": retention_class,
        "byte_fetch_required": False,
        "required_source_object": attachment_capture_policy
        in {"fetch_required_for_source_truth", "fetch_required_for_admitted_owner"},
    }


class CollectedNoticeMultimodalReadinessTests(unittest.TestCase):
    def test_builds_one_candidate_per_media_ref_with_priority_and_output_refs(self) -> None:
        schedule_unit = _unit(
            notice_id="355122",
            title="关于两校区学生通勤班车增加班次的通知",
            attachments=[
                _attachment(
                    attachment_ref_id="attachment-0001",
                    filename="班次表.jpg",
                    mime_type="image/jpeg",
                    role="inline_image",
                )
            ],
            reason_codes=["image_attachment_pending_text_extraction"],
            targets=["transport_schedule"],
        )
        regulation_unit = _unit(
            notice_id="354897",
            title="关于进一步加强校园交通安全管理的通知",
            attachments=[
                _attachment(
                    attachment_ref_id="attachment-0002",
                    filename="校园道路交通安全管理暂行规定.docx",
                    mime_type=(
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    ),
                )
            ],
            reason_codes=["office_attachment_pending_text_extraction"],
            targets=["regulation", "service_status"],
        )

        preview = build_collected_notice_multimodal_readiness_preview(
            invalid_defer_multimodal_report={
                "needs_multimodal_units": [
                    {"unit_id": schedule_unit["unit_id"]},
                    {"unit_id": regulation_unit["unit_id"]},
                ]
            },
            searchable_notice_preview={"units": [schedule_unit, regulation_unit]},
            generated_at="2026-04-29T00:00:00+00:00",
        )

        inventory = preview.candidate_inventory
        self.assertEqual(inventory["phase"], PHASE_05_ID)
        self.assertEqual(inventory["unit_count"], 2)
        self.assertEqual(inventory["candidate_count"], 2)
        by_notice = {item["source_notice_id"]: item for item in inventory["candidates"]}
        schedule = by_notice["355122"]
        self.assertEqual(schedule["media_kind"], "image")
        self.assertEqual(schedule["processing_family"], "schedule_image_ocr")
        self.assertEqual(schedule["priority"], "high")
        self.assertEqual(schedule["status"], "pending")
        self.assertEqual(schedule["policy_action"], "process")
        self.assertEqual(
            schedule["attempt_ledger"]["table"],
            "ingestion_projection.internal_notice_schedule_image_ocr_attempt",
        )
        self.assertEqual(
            set(schedule["normalized_output_refs"]),
            {
                "provider_response",
                "plain_text",
                "layout_elements",
                "searchable_merge_input",
            },
        )
        regulation = by_notice["354897"]
        self.assertEqual(regulation["media_kind"], "office")
        self.assertEqual(regulation["processing_family"], "office_text_extraction")
        self.assertEqual(regulation["media_role"], "owner_document")
        self.assertTrue(regulation["target_blocking"])
        self.assertEqual(regulation["priority"], "high")

        manifest = preview.ocr_batch_manifest
        self.assertFalse(manifest["write_enabled"])
        self.assertFalse(manifest["provider_calls_enabled"])
        self.assertEqual(manifest["pending_attempt_count"], 2)
        self.assertEqual(manifest["counts_by_processing_family"]["schedule_image_ocr"], 1)
        self.assertEqual(manifest["counts_by_processing_family"]["office_text_extraction"], 1)

    def test_file_release_pdf_uses_released_file_text_extraction_not_multimodal(self) -> None:
        unit = _unit(
            notice_id="477",
            title="中央民族大学本科毕业论文（设计）工作管理办法",
            attachments=[
                _attachment(
                    attachment_ref_id="file_release:477",
                    filename="中央民族大学本科毕业论文（设计）工作管理办法.pdf",
                    mime_type="application/pdf",
                    role="released_file",
                )
            ],
            reason_codes=[
                "released_file_text_extraction_pending",
                "pdf_attachment_pending_text_extraction",
            ],
            targets=["regulation"],
            body_text="文件编号：民大校发〔2023〕117号\n下载地址：https://my.muc.edu.cn/file.pdf",
            source_surface="file_release",
        )

        preview = build_collected_notice_multimodal_readiness_preview(
            invalid_defer_multimodal_report={
                "needs_multimodal_units": [{"unit_id": unit["unit_id"]}]
            },
            searchable_notice_preview={"units": [unit]},
            generated_at="2026-04-29T00:00:00+00:00",
        )

        inventory = preview.candidate_inventory
        self.assertEqual(
            inventory["schema_version"],
            "notice_media_extraction_candidate_inventory.v1",
        )
        candidate = inventory["candidates"][0]
        self.assertEqual(candidate["schema_version"], "notice_media_extraction_candidate.v1")
        self.assertEqual(candidate["media_kind"], "pdf")
        self.assertEqual(candidate["processing_family"], "released_file_text_extraction")
        self.assertEqual(candidate["media_role"], "owner_document")
        self.assertTrue(candidate["target_blocking"])
        self.assertNotEqual(candidate["processing_family"], "internal_notice_multimodal")
        self.assertEqual(
            preview.ocr_batch_manifest["counts_by_processing_family"],
            {"released_file_text_extraction": 1},
        )

    def test_metadata_only_attachment_is_not_a_multimodal_candidate(self) -> None:
        unit = _unit(
            notice_id="355881",
            title="关于开通丰台校区社会实践专车的通知",
            attachments=[
                {
                    **_attachment(
                        attachment_ref_id="attachment-0001",
                        filename="专车安排.png",
                        mime_type="image/png",
                        role="inline_image",
                    ),
                    "attachment_capture_policy": "metadata_only",
                    "attachment_capture_state": "metadata_recorded",
                    "byte_fetch_required": False,
                    "retention_class": "metadata_only",
                }
            ],
            reason_codes=["image_attachment_pending_text_extraction"],
            targets=["transport_schedule"],
        )

        preview = build_collected_notice_multimodal_readiness_preview(
            invalid_defer_multimodal_report={
                "needs_multimodal_units": [{"unit_id": unit["unit_id"]}]
            },
            searchable_notice_preview={"units": [unit]},
            generated_at="2026-04-29T00:00:00+00:00",
        )

        self.assertEqual(preview.candidate_inventory["candidate_count"], 0)
        self.assertEqual(preview.ocr_batch_manifest["pending_attempt_count"], 0)

    def test_attachment_without_source_retention_policy_is_not_a_media_candidate(self) -> None:
        attachment = _attachment(
            attachment_ref_id="attachment-0001",
            filename="班车安排.png",
            mime_type="image/png",
            role="inline_image",
        )
        for field in (
            "attachment_capture_policy",
            "attachment_capture_state",
            "retention_class",
            "byte_fetch_required",
            "required_source_object",
        ):
            attachment.pop(field, None)
        unit = _unit(
            notice_id="355867",
            title="关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
            attachments=[attachment],
            reason_codes=["image_attachment_pending_text_extraction"],
            targets=["transport_schedule"],
        )

        preview = build_collected_notice_multimodal_readiness_preview(
            invalid_defer_multimodal_report={
                "needs_multimodal_units": [{"unit_id": unit["unit_id"]}]
            },
            searchable_notice_preview={"units": [unit]},
            generated_at="2026-04-29T00:00:00+00:00",
        )

        self.assertEqual(preview.candidate_inventory["candidate_count"], 0)
        self.assertEqual(preview.ocr_batch_manifest["pending_attempt_count"], 0)

    def test_marks_low_value_posters_skipped_and_missing_media_as_failed_gap(self) -> None:
        low_value = _unit(
            notice_id="354276",
            title="讲座预告｜现代语言文字研究讲座",
            attachments=[
                _attachment(
                    attachment_ref_id="attachment-0001",
                    filename="poster.png",
                    mime_type="image/png",
                    role="inline_image",
                )
            ],
            reason_codes=["image_attachment_pending_text_extraction"],
            targets=[],
        )
        missing_media = _unit(
            notice_id="354304",
            title="《两个结合》研究第三期发布",
            attachments=[],
            reason_codes=["empty_body_text"],
            targets=[],
            body_text="",
        )

        preview = build_collected_notice_multimodal_readiness_preview(
            invalid_defer_multimodal_report={
                "needs_multimodal_units": [
                    {"unit_id": low_value["unit_id"]},
                    {"unit_id": missing_media["unit_id"]},
                ]
            },
            searchable_notice_preview={"units": [low_value, missing_media]},
            generated_at="2026-04-29T00:00:00+00:00",
        )

        by_notice = {
            item["source_notice_id"]: item for item in preview.candidate_inventory["candidates"]
        }
        self.assertEqual(by_notice["354276"]["status"], "skipped")
        self.assertEqual(by_notice["354276"]["policy_action"], "skip")
        self.assertEqual(
            by_notice["354276"]["skip_reason"],
            "low_value_ephemeral_event_poster",
        )
        self.assertEqual(by_notice["354304"]["status"], "failed_retryable")
        self.assertEqual(by_notice["354304"]["processing_family"], "source_capture_repair")
        self.assertIn("missing_processable_media", by_notice["354304"]["reason_codes"])
        self.assertEqual(preview.ocr_batch_manifest["pending_attempt_count"], 0)
        self.assertEqual(preview.gap_report["missing_processable_media_count"], 1)
        self.assertEqual(preview.gap_report["high_value_skip_violation_count"], 0)

    def test_selects_manual_review_and_failed_retryable_units_for_replay(self) -> None:
        manual_review = _unit(
            notice_id="355867",
            title="关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
            attachments=[
                _attachment(
                    attachment_ref_id="attachment-0001",
                    filename="班车安排.png",
                    mime_type="image/png",
                    role="inline_image",
                )
            ],
            reason_codes=["image_attachment_pending_text_extraction"],
            targets=["transport_schedule"],
        )
        manual_review["media_text_status"] = "manual_review"
        manual_review["multimodal_status"] = "completed"
        retryable = _unit(
            notice_id="355868",
            title="关于临时调整校园服务开放时间的通知",
            attachments=[
                _attachment(
                    attachment_ref_id="attachment-0002",
                    filename="开放时间.png",
                    mime_type="image/png",
                    role="inline_image",
                )
            ],
            reason_codes=["image_attachment_pending_text_extraction"],
            targets=["service_status"],
        )
        retryable["media_text_status"] = "failed_retryable"
        retryable["multimodal_status"] = "completed"

        preview = build_collected_notice_multimodal_readiness_preview(
            invalid_defer_multimodal_report={"needs_multimodal_units": []},
            searchable_notice_preview={"units": [manual_review, retryable]},
            generated_at="2026-04-29T00:00:00+00:00",
        )

        self.assertEqual(preview.candidate_inventory["unit_count"], 2)
        self.assertEqual(preview.candidate_inventory["candidate_count"], 2)
        self.assertEqual(
            {row["source_notice_id"] for row in preview.candidate_inventory["candidates"]},
            {"355867", "355868"},
        )

    def test_internal_notice_image_uses_ocr_path_not_multimodal_fallback(self) -> None:
        unit = _unit(
            notice_id="355868",
            title="关于临时调整校园服务开放时间的通知",
            attachments=[
                _attachment(
                    attachment_ref_id="attachment-0002",
                    filename="开放时间.png",
                    mime_type="image/png",
                    role="inline_image",
                )
            ],
            reason_codes=["image_attachment_pending_text_extraction"],
            targets=["service_status"],
        )

        preview = build_collected_notice_multimodal_readiness_preview(
            invalid_defer_multimodal_report={
                "needs_multimodal_units": [{"unit_id": unit["unit_id"]}]
            },
            searchable_notice_preview={"units": [unit]},
            generated_at="2026-04-29T00:00:00+00:00",
        )

        candidate = preview.candidate_inventory["candidates"][0]
        self.assertEqual(candidate["processing_family"], "image_ocr_text_extraction")
        self.assertNotIn(
            "ingestion_projection.internal_notice_multimodal_attempt",
            preview.state_mapping_report["source_attempt_tables"],
        )

    def test_weak_regulation_hint_does_not_make_regular_notice_high_priority(self) -> None:
        unit = _unit(
            notice_id="354925",
            title="关于办理2025年度个人所得税综合所得年度汇算的通知",
            attachments=[
                _attachment(
                    attachment_ref_id="attachment-0001",
                    filename="操作指引.png",
                    mime_type="image/png",
                    role="inline_image",
                    attachment_capture_policy="metadata_only",
                    attachment_capture_state="metadata_recorded",
                    retention_class="metadata_only",
                )
            ],
            reason_codes=["image_attachment_pending_text_extraction"],
            targets=["regulation"],
            body_text="根据《个人所得税综合所得汇算清缴管理办法》有关要求办理。",
        )
        unit["classification"] = {
            "notice_family": "other",
            "primary_route": "no_adoption",
            "processing_policy": "skip",
            "target_candidates": [],
            "evidence_strength": "none",
            "routing_reason_codes": ["no_classifier_route"],
        }

        preview = build_collected_notice_multimodal_readiness_preview(
            invalid_defer_multimodal_report={
                "needs_multimodal_units": [{"unit_id": unit["unit_id"]}]
            },
            searchable_notice_preview={"units": [unit]},
            generated_at="2026-04-29T00:00:00+00:00",
        )

        self.assertEqual(preview.candidate_inventory["candidate_count"], 0)
        self.assertEqual(preview.ocr_batch_manifest["pending_attempt_count"], 0)

    def test_outputs_mapping_attempt_plan_and_searchable_merge_preview(self) -> None:
        unit = _unit(
            notice_id="355867",
            title="关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
            attachments=[
                _attachment(
                    attachment_ref_id="attachment-0001",
                    filename="班车安排.png",
                    mime_type="image/png",
                    role="inline_image",
                )
            ],
            reason_codes=["image_attachment_pending_text_extraction"],
            targets=["transport_schedule"],
        )

        preview = build_collected_notice_multimodal_readiness_preview(
            invalid_defer_multimodal_report={
                "needs_multimodal_units": [{"unit_id": unit["unit_id"]}]
            },
            searchable_notice_preview={"units": [unit]},
            generated_at="2026-04-29T00:00:00+00:00",
        )

        mapping = preview.state_mapping_report
        self.assertEqual(mapping["schema_version"], "notice_multimodal_state_mapping.v1")
        self.assertIn(
            "ingestion_projection.internal_notice_schedule_image_ocr_attempt",
            mapping["source_attempt_tables"],
        )
        self.assertIn(
            "ingestion_projection.wechat_public_notice_multimodal_attempt",
            mapping["source_attempt_tables"],
        )

        attempt_entry = preview.ocr_attempt_plan["attempts"][0]
        self.assertEqual(attempt_entry["attempt_number"], 1)
        self.assertEqual(attempt_entry["state"], "pending")
        self.assertEqual(attempt_entry["provider"], "pending_runtime_config")
        self.assertTrue(attempt_entry["normalized_output_refs"]["searchable_merge_input"])

        merge_unit = preview.searchable_merge_preview["units"][0]
        self.assertEqual(merge_unit["unit_id"], unit["unit_id"])
        self.assertEqual(merge_unit["multimodal_merge_status"], "pending")
        self.assertEqual(len(merge_unit["multimodal_candidate_ids"]), 1)
        self.assertEqual(merge_unit["normalized_multimodal_fragments"], [])

        files = preview_to_output_files(preview)
        self.assertIn("media-extraction-candidate-inventory.json", files)
        self.assertIn("multimodal-candidate-inventory.json", files)
        self.assertEqual(
            files["media-extraction-candidate-inventory.json"]["schema_version"],
            "notice_media_extraction_candidate_inventory.v1",
        )


if __name__ == "__main__":
    unittest.main()
