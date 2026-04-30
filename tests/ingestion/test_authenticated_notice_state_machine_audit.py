from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_state_machine_audit import (
    build_authenticated_notice_state_machine_audit,
)


class AuthenticatedNoticeStateMachineAuditTests(unittest.TestCase):
    def test_notice_discover_only_metadata_attachment_with_no_candidates_passes(self) -> None:
        audit = build_authenticated_notice_state_machine_audit(
            searchable_notice_preview={
                "units": [
                    _unit(
                        notice_id="355119",
                        primary_route="notice_level_query",
                        attachment_policy="metadata_only",
                        attachment_state="metadata_recorded",
                        retention_class="metadata_only",
                    )
                ]
            },
            multimodal_candidate_inventory={"candidates": []},
        )

        self.assertEqual(audit["verdict"], "passed")
        self.assertEqual(audit["finding_count"], 0)
        self.assertEqual(audit["attachment_policy_counts"], {"metadata_only": 1})

    def test_metadata_only_attachment_with_multimodal_candidate_is_medium_finding(self) -> None:
        unit = _unit(
            notice_id="355881",
            primary_route="service_status_candidate",
            target_candidates=("transport_schedule",),
            attachment_policy="metadata_only",
            attachment_state="metadata_recorded",
            retention_class="metadata_only",
        )

        audit = build_authenticated_notice_state_machine_audit(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "candidate_id": "candidate-metadata-only",
                        "unit_id": unit["unit_id"],
                        "source_notice_id": "355881",
                        "processing_family": "schedule_image_ocr",
                        "status": "skipped",
                        "target_blocking": False,
                    }
                ]
            },
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(
            audit["finding_counts_by_code"],
            {"metadata_only_generated_multimodal_candidate": 1},
        )
        self.assertEqual(audit["findings"][0]["severity"], "medium")

    def test_uploaded_quarantine_and_required_owner_states_pass(self) -> None:
        audit = build_authenticated_notice_state_machine_audit(
            searchable_notice_preview={
                "units": [
                    _unit(
                        notice_id="355867",
                        primary_route="service_status_candidate",
                        target_candidates=("transport_schedule",),
                        attachment_policy="fetch_to_quarantine",
                        attachment_state="uploaded_quarantine",
                        retention_class="quarantine_candidate",
                    ),
                    _unit(
                        notice_id="477",
                        source_surface="file_release",
                        primary_route="regulation_candidate",
                        attachment_policy="fetch_required_for_source_truth",
                        attachment_state="uploaded_required",
                        retention_class="permanent_source_truth",
                        required_source_object=True,
                    ),
                ]
            },
            multimodal_candidate_inventory={"candidates": []},
        )

        self.assertEqual(audit["verdict"], "passed")
        self.assertEqual(audit["finding_count"], 0)

    def test_fetch_manifest_rejects_non_fetch_policy(self) -> None:
        audit = build_authenticated_notice_state_machine_audit(
            searchable_notice_preview={"units": []},
            multimodal_candidate_inventory={"candidates": []},
            fetch_request_manifest={
                "requests": [
                    {
                        "notice_id": "355119",
                        "attachment_ref_id": "attachment-0001",
                        "attachment_capture_policy": "metadata_only",
                    }
                ]
            },
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(audit["findings"][0]["code"], "non_fetch_policy_in_manifest")
        self.assertEqual(audit["findings"][0]["severity"], "high")

    def test_pdf_candidate_using_legacy_multimodal_family_is_high_finding(self) -> None:
        unit = _unit(
            notice_id="477",
            source_surface="file_release",
            primary_route="regulation_candidate",
            target_candidates=("regulation",),
            attachment_policy="fetch_required_for_source_truth",
            attachment_state="uploaded_required",
            retention_class="permanent_source_truth",
            required_source_object=True,
            mime_type="application/pdf",
            resource_role="released_file",
            original_filename="管理办法.pdf",
        )

        audit = build_authenticated_notice_state_machine_audit(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "candidate_id": "candidate-legacy-pdf",
                        "unit_id": unit["unit_id"],
                        "source_notice_id": "477",
                        "media_kind": "pdf",
                        "processing_family": "internal_notice_multimodal",
                        "status": "pending",
                        "target_blocking": True,
                        "source_object_ref": {
                            "bucket": "campus-rag-source",
                            "key": "authenticated_notice_portal/file-release-477/capture/source.pdf",
                        },
                    }
                ]
            },
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(
            audit["finding_counts_by_code"],
            {"pdf_candidate_uses_multimodal_fallback": 1},
        )

    def test_explicit_candidate_inventory_rejects_legacy_failed_status(self) -> None:
        unit = _unit(
            notice_id="355867",
            primary_route="service_status_candidate",
            target_candidates=("transport_schedule",),
            attachment_policy="fetch_to_quarantine",
            attachment_state="uploaded_quarantine",
            retention_class="quarantine_candidate",
        )

        audit = build_authenticated_notice_state_machine_audit(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "unit_id": unit["unit_id"],
                        "candidate_id": "candidate-legacy-failed",
                        "source_notice_id": "355867",
                        "media_kind": "image",
                        "processing_family": "schedule_image_ocr",
                        "status": "failed",
                        "target_blocking": True,
                        "source_object_ref": {
                            "bucket": "campus-rag-source",
                            "key": "authenticated_notice_portal/attachment/355867.png",
                        },
                    }
                ]
            },
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(audit["finding_counts_by_code"], {"legacy_candidate_status_failed": 1})

    def test_target_blocking_candidate_requires_nonterminal_status_and_source_ref(self) -> None:
        unit = _unit(
            notice_id="355867",
            primary_route="service_status_candidate",
            target_candidates=("transport_schedule",),
            attachment_policy="fetch_to_quarantine",
            attachment_state="uploaded_quarantine",
            retention_class="quarantine_candidate",
        )

        audit = build_authenticated_notice_state_machine_audit(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "unit_id": unit["unit_id"],
                        "candidate_id": "candidate-completed-blocking",
                        "source_notice_id": "355867",
                        "media_kind": "image",
                        "processing_family": "schedule_image_ocr",
                        "status": "completed",
                        "target_blocking": True,
                    }
                ]
            },
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(
            audit["finding_counts_by_code"],
            {
                "target_blocking_candidate_missing_source_object_ref": 1,
                "terminal_candidate_still_target_blocking": 1,
            },
        )

    def test_orphan_and_duplicate_candidates_are_high_findings(self) -> None:
        unit = _unit(
            notice_id="355867",
            primary_route="service_status_candidate",
            target_candidates=("transport_schedule",),
            attachment_policy="fetch_to_quarantine",
            attachment_state="uploaded_quarantine",
            retention_class="quarantine_candidate",
        )

        audit = build_authenticated_notice_state_machine_audit(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "unit_id": unit["unit_id"],
                        "candidate_id": "candidate:duplicate",
                        "source_notice_id": "355867",
                        "media_kind": "image",
                        "media_role": "schedule_table_carrier",
                        "processing_family": "schedule_image_ocr",
                        "status": "pending",
                        "target_blocking": True,
                        "source_object_ref": {
                            "bucket": "campus-rag-source",
                            "key": "authenticated_notice_portal/attachment/355867.png",
                        },
                    },
                    {
                        "unit_id": unit["unit_id"],
                        "candidate_id": "candidate:duplicate",
                        "source_notice_id": "355867",
                        "media_kind": "image",
                        "media_role": "schedule_table_carrier",
                        "processing_family": "schedule_image_ocr",
                        "status": "pending",
                        "target_blocking": True,
                        "source_object_ref": {
                            "bucket": "campus-rag-source",
                            "key": "authenticated_notice_portal/attachment/355867-copy.png",
                        },
                    },
                    {
                        "unit_id": "searchable:notice:muc_internal_portal:missing",
                        "candidate_id": "candidate:orphan",
                        "source_notice_id": "missing",
                        "media_kind": "image",
                        "media_role": "schedule_table_carrier",
                        "processing_family": "schedule_image_ocr",
                        "status": "pending",
                        "target_blocking": True,
                        "source_object_ref": {
                            "bucket": "campus-rag-source",
                            "key": "authenticated_notice_portal/attachment/missing.png",
                        },
                    },
                ]
            },
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(audit["finding_counts_by_code"]["duplicate_candidate_id"], 1)
        self.assertEqual(audit["finding_counts_by_code"]["orphan_media_candidate"], 1)


def _unit(
    *,
    notice_id: str,
    primary_route: str,
    attachment_policy: str,
    attachment_state: str,
    retention_class: str,
    target_candidates: tuple[str, ...] = (),
    source_surface: str = "notice",
    required_source_object: bool = False,
    mime_type: str = "image/png",
    resource_role: str = "inline_image",
    original_filename: str | None = None,
) -> dict[str, object]:
    attachment_ref = {
        "attachment_ref_id": "attachment-0001",
        "resource_role": resource_role,
        "original_filename": original_filename or f"{notice_id}.png",
        "attachment_capture_policy": attachment_policy,
        "attachment_capture_state": attachment_state,
        "retention_class": retention_class,
        "byte_fetch_required": False,
        "required_source_object": required_source_object,
        "object_key": f"authenticated_notice_portal/attachment/{notice_id}.png",
        "mime_type": mime_type,
        "content_sha256": f"sha256-{notice_id}",
        "storage_provider": "object_store",
        "ingest_status": "uploaded",
    }
    return {
        "unit_id": f"searchable:{source_surface}:muc_internal_portal:{notice_id}",
        "source_surface": source_surface,
        "source_notice_id": notice_id,
        "title": f"notice {notice_id}",
        "multimodal_status": "pending",
        "reason_codes": [],
        "classification": {
            "primary_route": primary_route,
            "target_candidates": list(target_candidates),
        },
        "source_retention": {
            "notice_capture_route": (
                "candidate_document_owner"
                if source_surface == "file_release"
                else "notice_level_query_only"
            ),
            "attachment_capture_policy_counts": {attachment_policy: 1},
            "attachment_capture_state_counts": {attachment_state: 1},
            "retention_class_counts": {retention_class: 1},
        },
        "attachment_refs": [attachment_ref],
    }


if __name__ == "__main__":
    unittest.main()
