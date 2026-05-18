from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_media_closeout_state_machine_audit import (
    build_collected_notice_media_closeout_state_machine_audit,
)

from campus_ingestion_core.collected_notice_media_extraction_attempt_ledger import (
    build_media_extraction_attempt_ledger,
)


def _candidate_inventory() -> dict[str, object]:
    return {
        "schema_version": "notice_media_extraction_candidate_inventory.v1",
        "candidate_count": 1,
        "candidates": [
            {
                "candidate_id": "candidate:schedule",
                "unit_id": "unit:355867",
                "source_notice_id": "355867",
                "media_ref_id": "attachment-0001",
                "processing_family": "schedule_image_ocr",
                "media_kind": "image",
                "target_hints": ["transport_schedule"],
                "target_blocking": True,
                "status": "pending",
                "media_text_status": "pending",
                "source_object_ref": {
                    "bucket": "campus-rag-source",
                    "key": "objects/schedule.png",
                    "sha256": "a" * 64,
                    "byte_size": 123,
                },
                "attachment_ref": {
                    "attachment_ref_id": "attachment-0001",
                    "attachment_capture_policy": "fetch_to_quarantine",
                    "attachment_capture_state": "uploaded_quarantine",
                    "retention_class": "quarantine_candidate",
                },
                "normalized_output_refs": {"plain_text": {"key": "ocr.txt"}},
            }
        ],
    }


def _attempt(
    candidate_id: str,
    *,
    status: str,
    source_key: str,
    source_hash: str = "a" * 64,
    retry_budget_remaining: int | None = None,
    next_retry_after: str = "2026-05-01T00:05:00+08:00",
) -> dict[str, object]:
    payload: dict[str, object] = {
        "attempt_id": f"{candidate_id}:attempt:1",
        "candidate_id": candidate_id,
        "unit_id": "unit:355867",
        "source_notice_id": "355867",
        "media_ref_id": "attachment-0001",
        "processing_family": "schedule_image_ocr",
        "attempt_number": 1,
        "status": status,
        "source_object_ref": {
            "bucket": "campus-rag-source",
            "key": source_key,
            "sha256": source_hash,
            "byte_size": 123,
            "storage_provider": "object_store",
        },
        "source_object_hash": source_hash,
        "output_refs": {"plain_text": {"key": "ocr.txt"}} if status == "completed" else {},
    }
    if retry_budget_remaining is not None:
        payload["retry_budget_remaining"] = retry_budget_remaining
    if next_retry_after:
        payload["next_retry_after"] = next_retry_after
    return payload


def _object_verification_report(
    *,
    source_hash: str,
    key: str = "objects/schedule.png",
) -> dict[str, object]:
    return {
        "rows": [
            {
                "bucket": "campus-rag-source",
                "object_key": key,
                "status": "verified",
                "sha256": source_hash,
                "byte_size": 123,
                "storage_provider": "object_store",
                "reference_only": False,
                "check_method": "head_checksum",
                "live_checked_at": "2026-05-01T00:00:00+08:00",
            }
        ]
    }


def _target_admission_manifest(target_admission_state: str) -> dict[str, object]:
    return {
        "entries": [
            {
                "searchable_unit_id": "unit:355867",
                "source_notice_id": "355867",
                "target": "transport_schedule",
                "fact_readiness_state": "blocked_by_required_media",
                "target_admission_state": target_admission_state,
                "consumption_class": target_admission_state,
                "required_fact_groups": ["route", "service_window", "departure_time"],
            }
        ]
    }


def _cleanup_report(*, protected_keys: tuple[str, ...]) -> dict[str, object]:
    return {
        "dry_run_objects": [],
        "blocked_quarantine_objects": [
            {"bucket": "campus-rag-source", "object_key": key} for key in protected_keys
        ],
    }


__all__ = [name for name in globals() if not name.startswith("__")]
