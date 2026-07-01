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

    def test_metadata_only_attachment_ignores_candidate_for_different_attachment_ref(self) -> None:
        unit = _unit(
            notice_id="355882",
            primary_route="service_status_candidate",
            target_candidates=("transport_schedule",),
            attachment_policy="metadata_only",
            attachment_state="metadata_recorded",
            retention_class="metadata_only",
        )
        unit["attachment_refs"].append(
            _attachment_ref(
                notice_id="355882",
                attachment_ref_id="attachment-0002",
                attachment_policy="fetch_to_quarantine",
                attachment_state="uploaded_quarantine",
                retention_class="quarantine_candidate",
            )
        )

        audit = build_authenticated_notice_state_machine_audit(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "candidate_id": "candidate-schedule-image",
                        "unit_id": unit["unit_id"],
                        "source_notice_id": "355882",
                        "media_ref_id": "attachment-0002",
                        "media_kind": "image",
                        "media_role": "schedule_table_carrier",
                        "processing_family": "schedule_image_ocr",
                        "status": "pending",
                        "target_blocking": True,
                        "source_object_ref": {
                            "bucket": "campus-agent-source",
                            "key": "authenticated_notice_portal/attachment/355882-attachment-0002.png",
                        },
                    }
                ]
            },
        )

        self.assertEqual(audit["verdict"], "passed")
        self.assertEqual(audit["finding_count"], 0)

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

    def test_fetch_manifest_request_must_match_source_truth_attachment_policy(self) -> None:
        unit = _unit(
            notice_id="355119",
            primary_route="notice_level_query",
            attachment_policy="metadata_only",
            attachment_state="metadata_recorded",
            retention_class="metadata_only",
        )

        audit = build_authenticated_notice_state_machine_audit(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={"candidates": []},
            fetch_request_manifest={
                "requests": [
                    {
                        "notice_id": "355119",
                        "attachment_ref_id": "attachment-0001",
                        "attachment_capture_policy": "fetch_to_quarantine",
                    }
                ]
            },
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(
            audit["finding_counts_by_code"],
            {"fetch_request_source_ref_policy_mismatch": 1},
        )

    def test_required_policy_missing_bytes_without_fetch_request_is_high_finding(self) -> None:
        unit = _unit(
            notice_id="477",
            source_surface="file_release",
            primary_route="regulation_candidate",
            target_candidates=("regulation",),
            attachment_policy="fetch_required_for_source_truth",
            attachment_state="not_attempted",
            retention_class="permanent_source_truth",
            required_source_object=True,
        )
        attachment = unit["attachment_refs"][0]
        attachment["object_key"] = None
        attachment["content_sha256"] = None
        attachment["storage_provider"] = "reference_only"
        attachment["ingest_status"] = "reference_only"
        attachment["byte_fetch_required"] = False

        audit = build_authenticated_notice_state_machine_audit(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={"candidates": []},
            fetch_request_manifest={"requests": []},
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(
            audit["finding_counts_by_code"],
            {"required_source_object_missing_bytes_without_fetch_request": 1},
        )

    def test_fetch_required_ref_missing_bytes_must_have_manifest_request(self) -> None:
        unit = _unit(
            notice_id="355868",
            primary_route="service_status_candidate",
            target_candidates=("transport_schedule",),
            attachment_policy="fetch_to_quarantine",
            attachment_state="not_attempted",
            retention_class="quarantine_candidate",
        )
        attachment = unit["attachment_refs"][0]
        attachment["object_key"] = None
        attachment["content_sha256"] = None
        attachment["storage_provider"] = "reference_only"
        attachment["ingest_status"] = "reference_only"
        attachment["byte_fetch_required"] = True

        audit = build_authenticated_notice_state_machine_audit(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={"candidates": []},
            fetch_request_manifest={"requests": []},
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(
            audit["finding_counts_by_code"],
            {"fetch_policy_missing_bytes_without_fetch_request": 1},
        )

    def test_source_capture_repair_requires_fetch_request_or_operator_action(self) -> None:
        unit = _unit(
            notice_id="355867",
            primary_route="service_status_candidate",
            target_candidates=("transport_schedule",),
            attachment_policy="fetch_to_quarantine",
            attachment_state="not_attempted",
            retention_class="quarantine_candidate",
        )
        attachment = unit["attachment_refs"][0]
        attachment["object_key"] = None
        attachment["content_sha256"] = None
        attachment["storage_provider"] = "reference_only"
        attachment["ingest_status"] = "reference_only"
        attachment["byte_fetch_required"] = False

        audit = build_authenticated_notice_state_machine_audit(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "candidate_id": "candidate-repair",
                        "unit_id": unit["unit_id"],
                        "source_notice_id": "355867",
                        "media_ref_id": "attachment-0001",
                        "media_kind": "image",
                        "processing_family": "source_capture_repair",
                        "status": "failed_retryable",
                        "target_blocking": False,
                        "reason_codes": [
                            "source_capture_pending",
                            "missing_collected_attachment_bytes",
                        ],
                    }
                ]
            },
            fetch_request_manifest={"requests": []},
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(
            audit["finding_counts_by_code"],
            {"source_capture_repair_without_fetch_request_or_operator_action": 1},
        )

    def test_source_capture_repair_without_media_ref_is_high_finding(self) -> None:
        unit = _unit(
            notice_id="355869",
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
                        "candidate_id": "candidate-repair-missing-ref",
                        "unit_id": unit["unit_id"],
                        "source_notice_id": "355869",
                        "media_kind": "image",
                        "processing_family": "source_capture_repair",
                        "status": "failed_retryable",
                        "target_blocking": False,
                    }
                ]
            },
            fetch_request_manifest={"requests": []},
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(
            audit["finding_counts_by_code"],
            {"source_capture_repair_missing_media_ref": 1},
        )

    def test_terminal_unavailable_attachment_requires_terminal_state_tuple(self) -> None:
        unit = _unit(
            notice_id="186977",
            primary_route="regulation_candidate",
            target_candidates=("regulation",),
            attachment_policy="terminal_unavailable",
            attachment_state="not_attempted",
            retention_class="quarantine_candidate",
        )
        attachment = unit["attachment_refs"][0]
        attachment["byte_fetch_required"] = True
        attachment["required_source_object"] = True
        attachment["terminal_reason"] = "http_404"
        attachment["last_error_class"] = "terminal_unavailable"

        audit = build_authenticated_notice_state_machine_audit(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "candidate_id": "candidate-terminal",
                        "unit_id": unit["unit_id"],
                        "source_notice_id": "186977",
                        "media_kind": "pdf",
                        "processing_family": "pdf_ocr_text_extraction",
                        "status": "pending",
                        "target_blocking": True,
                        "source_object_ref": {
                            "bucket": "campus-agent-source",
                            "key": "authenticated_notice_portal/attachment/missing.pdf",
                        },
                    }
                ]
            },
            fetch_request_manifest={
                "requests": [
                    {
                        "notice_id": "186977",
                        "attachment_ref_id": "attachment-0001",
                        "attachment_capture_policy": "fetch_required_for_source_truth",
                        "attachment_capture_state": "terminal_missing",
                        "terminal_reason": "http_404",
                    }
                ]
            },
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(
            audit["finding_counts_by_code"],
            {
                "fetch_request_for_terminal_attachment": 1,
                "terminal_attachment_generated_candidate": 1,
                "terminal_unavailable_state_mismatch": 1,
            },
        )

    def test_skip_terminal_attachment_requires_skip_state_tuple(self) -> None:
        unit = _unit(
            notice_id="355700",
            primary_route="service_status_candidate",
            target_candidates=("transport_schedule",),
            attachment_policy="skip_unsupported",
            attachment_state="not_attempted",
            retention_class="quarantine_candidate",
        )
        attachment = unit["attachment_refs"][0]
        attachment["byte_fetch_required"] = True
        attachment["required_source_object"] = True

        audit = build_authenticated_notice_state_machine_audit(
            searchable_notice_preview={"units": [unit]},
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "candidate_id": "candidate-skip",
                        "unit_id": unit["unit_id"],
                        "source_notice_id": "355700",
                        "media_kind": "image",
                        "processing_family": "schedule_image_ocr",
                        "status": "pending",
                        "target_blocking": True,
                        "source_object_ref": {
                            "bucket": "campus-agent-source",
                            "key": "authenticated_notice_portal/attachment/skipped.png",
                        },
                    }
                ]
            },
            fetch_request_manifest={
                "requests": [
                    {
                        "notice_id": "355700",
                        "attachment_ref_id": "attachment-0001",
                        "attachment_capture_policy": "fetch_to_quarantine",
                    }
                ]
            },
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(
            audit["finding_counts_by_code"],
            {
                "fetch_request_for_terminal_attachment": 1,
                "skip_terminal_generated_candidate": 1,
                "skip_terminal_state_mismatch": 1,
            },
        )

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
                            "bucket": "campus-agent-source",
                            "key": "authenticated_notice_portal/file-release-477/capture/source.pdf",
                        },
                    }
                ]
            },
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(
            audit["finding_counts_by_code"],
            {"pdf_candidate_uses_direct_multimodal_path": 1},
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
                            "bucket": "campus-agent-source",
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

    def test_candidate_source_object_ref_must_match_attachment_bytes(self) -> None:
        unit = _unit(
            notice_id="355870",
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
                        "candidate_id": "candidate-stale-source-object",
                        "source_notice_id": "355870",
                        "media_ref_id": "attachment-0001",
                        "media_kind": "image",
                        "media_role": "schedule_table_carrier",
                        "processing_family": "schedule_image_ocr",
                        "status": "pending",
                        "target_blocking": True,
                        "source_object_ref": {
                            "bucket": "campus-agent-source",
                            "key": "authenticated_notice_portal/attachment/stale.png",
                        },
                    }
                ]
            },
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(
            audit["finding_counts_by_code"],
            {"candidate_source_object_ref_missing_attachment_bytes": 1},
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
                            "bucket": "campus-agent-source",
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
                            "bucket": "campus-agent-source",
                            "key": "authenticated_notice_portal/attachment/355867-copy.png",
                        },
                    },
                    {
                        "unit_id": "searchable:notice:example_internal_portal:missing",
                        "candidate_id": "candidate:orphan",
                        "source_notice_id": "missing",
                        "media_kind": "image",
                        "media_role": "schedule_table_carrier",
                        "processing_family": "schedule_image_ocr",
                        "status": "pending",
                        "target_blocking": True,
                        "source_object_ref": {
                            "bucket": "campus-agent-source",
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
        "unit_id": f"searchable:{source_surface}:example_internal_portal:{notice_id}",
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


def _attachment_ref(
    *,
    notice_id: str,
    attachment_ref_id: str,
    attachment_policy: str,
    attachment_state: str,
    retention_class: str,
) -> dict[str, object]:
    return {
        "attachment_ref_id": attachment_ref_id,
        "resource_role": "inline_image",
        "original_filename": f"{notice_id}-{attachment_ref_id}.png",
        "attachment_capture_policy": attachment_policy,
        "attachment_capture_state": attachment_state,
        "retention_class": retention_class,
        "byte_fetch_required": False,
        "required_source_object": False,
        "object_key": f"authenticated_notice_portal/attachment/{notice_id}-{attachment_ref_id}.png",
        "mime_type": "image/png",
        "content_sha256": f"sha256-{notice_id}-{attachment_ref_id}",
        "storage_provider": "object_store",
        "ingest_status": "uploaded",
    }


if __name__ == "__main__":
    unittest.main()
