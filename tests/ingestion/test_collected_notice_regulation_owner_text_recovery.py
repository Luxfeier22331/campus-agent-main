from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_regulation_owner_text_recovery import (
    PHASE_06_R1A_ID,
    build_collected_notice_regulation_owner_text_recovery_preview,
    preview_to_output_files,
)


def _admission_entry(
    *,
    notice_id: str,
    unit_id: str | None = None,
    source_surface: str = "file_release",
    admission_class: str = "needs_multimodal",
    target_collection: str = "institutional_rules",
) -> dict[str, object]:
    searchable_unit_id = unit_id or f"searchable:{source_surface}:muc_internal_portal:{notice_id}"
    return {
        "entry_id": f"notice:muc_internal_portal:{notice_id}",
        "source_channel": "authenticated_notice_portal",
        "source_surface": source_surface,
        "source_corpus": "authenticated_documents"
        if source_surface == "file_release"
        else "campus_notices",
        "source_collection": "file_release_source"
        if source_surface == "file_release"
        else "internal_notice",
        "site_id": "muc_internal_portal",
        "source_notice_id": notice_id,
        "source_document_id": f"{source_surface}:muc_internal_portal:{notice_id}",
        "title": f"中央民族大学测试管理办法 {notice_id}",
        "published_at": "2026-04-29 09:00",
        "body_excerpt": "详见附件。",
        "source_url": f"https://my.muc.edu.cn/file/{notice_id}",
        "run_id": "muc_internal_portal:file_release:test",
        "source_object_refs": [
            {
                "bucket": "campus-rag-source",
                "key": f"authenticated_notice_portal/{notice_id}/source-truth/file-release.json",
                "role": "source-truth/file-release-manifest.json",
            }
        ],
        "consumption_class": "needs_multimodal"
        if admission_class == "needs_multimodal"
        else "defer",
        "regulation_admission_class": admission_class,
        "target": None,
        "target_surface": None,
        "target_collection": target_collection,
        "target_identity_preview": None,
        "candidate_key": f"regulation-candidate:{target_collection}:{notice_id}",
        "regulation_title_normalized": f"中央民族大学测试管理办法 {notice_id}",
        "issuing_org": "中央民族大学",
        "duplicate_primary_source_notice_id": None,
        "duplicate_primary_searchable_unit_id": None,
        "target_hints": {"candidate_targets": ["regulation"]},
        "multimodal_policy": "pending",
        "reason_codes": ["multimodal_not_ready"],
        "preconditions": [],
        "searchable_unit_id": searchable_unit_id,
    }


def _candidate(
    *,
    notice_id: str,
    media_kind: str = "pdf",
    source_surface: str = "file_release",
    byte_size: int = 1000,
    status: str = "pending",
    source_object_ref: dict[str, object] | None | str = "default",
) -> dict[str, object]:
    unit_id = f"searchable:{source_surface}:muc_internal_portal:{notice_id}"
    object_ref = (
        {
            "bucket": "campus-rag-source",
            "key": (
                f"authenticated_notice_portal/file-release-{notice_id}/2026/"
                f"sha256-{notice_id}/capture/{notice_id}.{media_kind}"
            ),
            "role": "released_file",
            "sha256": f"sha256-{notice_id}",
            "byte_size": byte_size,
            "mime_type": "application/pdf"
            if media_kind == "pdf"
            else "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "source_url": f"https://my.muc.edu.cn/download/{notice_id}",
            "final_url": f"https://my.muc.edu.cn/download/{notice_id}",
        }
        if source_object_ref == "default"
        else source_object_ref
    )
    output_prefix = f"authenticated_notice_portal/file-release-{notice_id}/2026/sha256-{notice_id}"
    return {
        "schema_version": "notice_multimodal_candidate.v1",
        "candidate_id": f"notice-mm:{notice_id}",
        "unit_id": unit_id,
        "source_channel": "authenticated_notice_portal",
        "source_surface": source_surface,
        "source_corpus": "authenticated_documents"
        if source_surface == "file_release"
        else "campus_notices",
        "source_collection": "file_release_source"
        if source_surface == "file_release"
        else "internal_notice",
        "site_id": "muc_internal_portal",
        "source_notice_id": notice_id,
        "source_document_id": f"{source_surface}:muc_internal_portal:{notice_id}",
        "title": f"中央民族大学测试管理办法 {notice_id}",
        "published_at": "2026-04-29 09:00",
        "source_url": f"https://my.muc.edu.cn/file/{notice_id}",
        "media_ref_id": "released-file",
        "image_index": None,
        "media_kind": media_kind,
        "processing_family": "released_file_text_extraction"
        if media_kind == "pdf"
        else "office_text_extraction",
        "priority": "high",
        "status": status,
        "policy_action": "process",
        "skip_reason": "",
        "reason_codes": [f"{media_kind}_attachment_pending_text_extraction"],
        "target_hints": ["regulation"],
        "source_object_ref": object_ref,
        "attachment_ref": None,
        "attempt_ledger": {
            "table": (
                "ingestion_projection.collected_notice_released_file_text_extraction_attempt"
                if media_kind == "pdf"
                else "ingestion_projection.collected_notice_office_text_extraction_attempt"
            ),
            "identity": {
                "source_corpus": "authenticated_documents",
                "source_collection": "file_release_source",
                "source_notice_id": notice_id,
                "unit_id": unit_id,
                "attempt_number": 1,
            },
        },
        "normalized_output_refs": {
            "provider_response": {
                "bucket": "campus-rag-source",
                "key": f"{output_prefix}/provider/media-extraction-v1/provider-response.jsonl",
                "role": "provider_response",
            },
            "plain_text": {
                "bucket": "campus-rag-source",
                "key": f"{output_prefix}/source-truth/visual-text.jsonl",
                "role": "plain_text",
            },
            "layout_elements": {
                "bucket": "campus-rag-source",
                "key": f"{output_prefix}/source-truth/layout-elements.jsonl",
                "role": "layout_elements",
            },
            "searchable_merge_input": {
                "bucket": "campus-rag-source",
                "key": f"{output_prefix}/source-truth/searchable-merge-input.json",
                "role": "searchable_merge_input",
            },
        },
        "provenance": {
            "phase4_searchable_unit_id": unit_id,
            "phase4_admission_batch_id": "phase-04-dry-run-searchable-preview",
        },
    }


class CollectedNoticeRegulationOwnerTextRecoveryTests(unittest.TestCase):
    def test_selects_file_release_pdf_and_office_attempts_with_stable_limit(self) -> None:
        preview = build_collected_notice_regulation_owner_text_recovery_preview(
            regulation_admission_manifest={
                "entries": [
                    _admission_entry(notice_id="100"),
                    _admission_entry(notice_id="101", target_collection="scoped_rules"),
                    _admission_entry(
                        notice_id="102",
                        source_surface="notice",
                        target_collection="institutional_rules",
                    ),
                    _admission_entry(notice_id="103"),
                    _admission_entry(notice_id="104", admission_class="manual_review"),
                    _admission_entry(notice_id="105"),
                ]
            },
            multimodal_candidate_inventory={
                "candidates": [
                    _candidate(notice_id="100", media_kind="pdf", byte_size=900),
                    _candidate(notice_id="101", media_kind="pdf", byte_size=500),
                    _candidate(notice_id="102", source_surface="notice", media_kind="image"),
                    _candidate(notice_id="103", media_kind="archive", byte_size=50),
                    _candidate(notice_id="105", media_kind="office", byte_size=100),
                ]
            },
            limit=2,
            generated_at="2026-04-29T00:00:00+00:00",
        )

        manifest = preview.batch_manifest
        self.assertEqual(manifest["phase"], PHASE_06_R1A_ID)
        self.assertFalse(manifest["write_enabled"])
        self.assertFalse(manifest["provider_calls_enabled"])
        self.assertFalse(manifest["object_store_writes_enabled"])
        self.assertFalse(manifest["db_writes_enabled"])
        self.assertEqual(manifest["counts"]["in_scope_needs_multimodal_count"], 4)
        self.assertEqual(manifest["counts"]["eligible_attempt_count"], 3)
        self.assertEqual(manifest["counts"]["selected_attempt_count"], 2)
        self.assertEqual(manifest["counts"]["batch_limit_deferred_count"], 1)
        self.assertEqual(manifest["counts"]["gap_count"], 1)
        self.assertEqual(
            manifest["batches"][0]["candidate_ids"],
            ["notice-mm:105", "notice-mm:101"],
        )

        attempt_plan = preview.attempt_plan
        self.assertEqual(attempt_plan["attempt_count"], 2)
        first_attempt = attempt_plan["attempts"][0]
        self.assertEqual(first_attempt["action"], "recover_regulation_owner_text")
        self.assertEqual(first_attempt["state"], "planned")
        self.assertEqual(
            first_attempt["candidate_key"], "regulation-candidate:institutional_rules:105"
        )
        self.assertEqual(first_attempt["source_object_ref"]["role"], "released_file")
        self.assertEqual(
            first_attempt["owner_text_output_ref"],
            first_attempt["normalized_output_refs"]["plain_text"],
        )
        self.assertEqual(
            set(first_attempt["required_outputs"]),
            {
                "provider_response",
                "owner_text",
                "layout_elements",
                "searchable_merge_input",
            },
        )
        self.assertEqual(
            first_attempt["post_recovery_rerun"]["steps"],
            [
                "phase-05-multimodal-ocr-consumption-readiness",
                "phase-06-r1-regulation-candidate-audit-and-admission",
                "phase-06-r2-regulation-promotion-dry-run-and-gated-materialization",
            ],
        )

        merge_unit = preview.searchable_merge_contract["units"][0]
        self.assertEqual(merge_unit["candidate_id"], "notice-mm:105")
        self.assertEqual(merge_unit["required_owner_text_status"], "ready")
        self.assertEqual(merge_unit["current_regulation_admission_class"], "needs_multimodal")

        gap_reasons = {
            row["source_notice_id"]: row["reason_codes"]
            for row in preview.readiness_gap_report["gaps"]
        }
        self.assertEqual(gap_reasons["103"], ["unsupported_media_kind"])
        self.assertEqual(
            preview.readiness_gap_report["deferred"][0]["reason_codes"],
            ["source_surface_out_of_scope"],
        )

    def test_reports_missing_candidate_and_missing_source_object_ref_as_gaps(self) -> None:
        preview = build_collected_notice_regulation_owner_text_recovery_preview(
            regulation_admission_manifest={
                "entries": [
                    _admission_entry(notice_id="200"),
                    _admission_entry(notice_id="201"),
                ]
            },
            multimodal_candidate_inventory={
                "candidates": [
                    _candidate(
                        notice_id="201",
                        media_kind="pdf",
                        source_object_ref=None,
                    )
                ]
            },
            limit=10,
            generated_at="2026-04-29T00:00:00+00:00",
        )

        self.assertEqual(preview.batch_manifest["counts"]["selected_attempt_count"], 0)
        gaps = {row["source_notice_id"]: row for row in preview.readiness_gap_report["gaps"]}
        self.assertEqual(gaps["200"]["reason_codes"], ["no_matching_multimodal_candidate"])
        self.assertEqual(gaps["201"]["reason_codes"], ["missing_source_object_ref"])
        self.assertTrue(gaps["201"]["candidate_id"])

    def test_preview_to_output_files_uses_phase_evidence_filenames(self) -> None:
        preview = build_collected_notice_regulation_owner_text_recovery_preview(
            regulation_admission_manifest={"entries": []},
            multimodal_candidate_inventory={"candidates": []},
            generated_at="2026-04-29T00:00:00+00:00",
        )

        self.assertEqual(
            set(preview_to_output_files(preview)),
            {
                "regulation-owner-text-recovery-batch-manifest.json",
                "regulation-owner-text-attempt-plan.json",
                "regulation-owner-text-searchable-merge-contract.json",
                "regulation-owner-text-readiness-gap-report.json",
            },
        )


if __name__ == "__main__":
    unittest.main()
