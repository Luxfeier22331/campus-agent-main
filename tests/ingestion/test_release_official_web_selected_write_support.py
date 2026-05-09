from __future__ import annotations

import json

import unittest

from dataclasses import dataclass

from pathlib import Path

from tempfile import TemporaryDirectory

from unittest.mock import patch

from campus_ingestion_worker.release_official_web_selected_write import (
    preview_official_web_selected_write,
    release_official_web_selected_write,
)


class _FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = dict(objects or {})

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data


class _FakeProjectionReporter:
    def __init__(self) -> None:
        self.snapshots: list[dict[str, object]] = []

    def report(self, *, snapshot: dict[str, object]) -> None:
        self.snapshots.append(snapshot)


@dataclass(frozen=True)
class _PublishReport:
    corpus: str
    collection: str
    release_id: str
    schema_version: str
    current: bool
    counts: dict[str, int]


class _FakeStructuredProjectionPublisher:
    def __init__(self) -> None:
        self.published: list[dict[str, object]] = []

    def publish_release(self, **kwargs: object) -> _PublishReport:
        self.published.append(dict(kwargs))
        return _PublishReport(
            corpus=str(kwargs["corpus"]),
            collection=str(kwargs["collection"]),
            release_id=str(kwargs["release_id"]),
            schema_version=str(kwargs["schema_version"]),
            current=True,
            counts={"records": 1},
        )


class _ExplodingStructuredProjectionPublisher:
    def publish_release(self, **_: object) -> _PublishReport:
        raise AssertionError("publish_release should not be called during selected-write preview")


def _selected_write_task(
    *,
    selected_write_target: str = "campus_services/contact_directory",
) -> dict[str, object]:
    if selected_write_target == "campus_services/service_guide":
        task_type = "official_web_selected_write_service_guide"
    elif selected_write_target == "calendar/academic_calendar":
        task_type = "official_web_selected_write_academic_calendar"
    else:
        task_type = "official_web_selected_write_contact_directory"
    input_ref: dict[str, object]
    if selected_write_target == "campus_services/service_guide":
        input_ref = {
            "fieldStatus": {
                "process_steps": "present",
                "required_materials": "source_not_provided",
                "service_entry": "source_not_provided",
                "service_material": "source_not_provided",
                "service_name": "present",
                "service_process": "present",
                "source_url": "present",
                "source_version_evidence": "present",
            },
            "optionalEvidence": ["service_entry", "service_material"],
            "optionalFields": ["service_entry", "required_materials", "service_material"],
            "policyVersion": "official_web_selected_write_admission.v1",
            "requiredEvidence": ["service_process"],
            "requiredFields": [
                "service_name",
                "process_steps",
                "source_url",
                "source_version_evidence",
                "service_process",
            ],
            "sourceObjectKeys": [
                "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json"
            ],
            "sourceUrls": ["https://www.muc.edu.cn/"],
            "targetLabel": "中央民族大学学生校园卡服务",
        }
    elif selected_write_target == "calendar/academic_calendar":
        input_ref = {
            "fieldStatus": {
                "academic_year_label": "present",
                "term_label": "present",
                "date_range": "present",
                "calendar_arrangement": "present",
                "source_url": "present",
                "source_version_evidence": "present",
                "holiday_name": "source_not_provided",
                "week_index": "present",
                "class_day_pattern": "present",
            },
            "optionalEvidence": [],
            "optionalFields": ["holiday_name", "week_index", "class_day_pattern"],
            "policyVersion": "official_web_selected_write_admission.v1",
            "requiredEvidence": ["calendar_arrangement"],
            "requiredFields": [
                "academic_year_label",
                "term_label",
                "date_range",
                "calendar_arrangement",
                "source_url",
                "source_version_evidence",
            ],
            "sourceObjectKeys": [
                "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json"
            ],
            "sourceUrls": ["https://www.muc.edu.cn/ggfw/mdxl.htm"],
            "targetLabel": "中央民族大学公开校历",
        }
    else:
        input_ref = {
            "fieldStatus": {
                "email": "source_not_provided",
                "location": "present",
                "office_hours": "source_not_provided",
                "organization_name": "present",
                "phone": "present",
                "source_url": "present",
                "source_version_evidence": "present",
            },
            "optionalEvidence": ["email", "location", "office_hours"],
            "optionalFields": ["email", "location", "office_hours"],
            "policyVersion": "official_web_selected_write_admission.v1",
            "requiredEvidence": ["phone"],
            "requiredFields": [
                "organization_name",
                "phone",
                "source_url",
                "source_version_evidence",
            ],
            "sourceObjectKeys": [
                "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json"
            ],
            "sourceUrls": ["https://www.muc.edu.cn/"],
            "targetLabel": "中央民族大学主页页脚联系方式",
        }
    return {
        "createdAt": "2026-05-01T08:00:00+00:00",
        "inputRef": input_ref,
        "inventoryId": "muc-main-homepage-contact",
        "jobId": "owtarget_contact",
        "runId": "owrun_contact",
        "selectedWriteId": "owselected_muc_main_homepage_contact_owrun_contact",
        "selectedWriteTarget": selected_write_target,
        "status": "claimed",
        "taskId": "owselected_muc_main_homepage_contact_owrun_contact",
        "taskType": task_type,
        "updatedAt": "2026-05-01T08:00:00+00:00",
    }


__all__ = [name for name in globals() if not name.startswith("__")]
