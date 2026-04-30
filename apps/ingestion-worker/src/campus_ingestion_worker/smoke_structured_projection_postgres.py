from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from datetime import datetime
from zoneinfo import ZoneInfo

from campus_ingestion_core.structured_projection_postgres import (
    build_structured_projection_publisher_from_env,
    projection_artifact_checksum,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Publish and verify a small structured projection release in PostgreSQL.",
    )
    parser.add_argument("--release-id")
    parser.add_argument("--generated-at")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    publisher = build_structured_projection_publisher_from_env()
    if publisher is None:
        raise ValueError("CAMPUS_SHARED_POSTGRES_URL is required")
    generated_at = args.generated_at or datetime.now(ZoneInfo("Asia/Shanghai")).isoformat()
    release_id_prefix = args.release_id or _default_release_id(generated_at)
    reports = {}
    for collection, bundle in (
        ("service_status", _smoke_service_status_bundle()),
        ("transport_schedule", _smoke_transport_schedule_bundle()),
        ("service_guide", _smoke_service_guide_bundle()),
        ("contact_directory", _smoke_contact_directory_bundle()),
    ):
        release_id = f"{release_id_prefix}-{collection.replace('_', '-')}"
        report = publisher.publish_release(
            corpus="campus_services",
            collection=collection,
            release_id=release_id,
            generated_at=generated_at,
            schema_version=str(bundle["schema_version"]),
            artifact_object_key=(
                f"campus_services/releases/{collection}/"
                f"{release_id}/structured-projection-smoke.json"
            ),
            artifact_checksum=projection_artifact_checksum(bundle),
            bundle=bundle,
            validation_status="smoke_valid",
        )
        current_release_id = publisher.get_current_release(
            corpus="campus_services",
            collection=collection,
        )
        if current_release_id != release_id:
            raise RuntimeError(
                f"{collection} structured projection smoke current release = "
                f"{current_release_id}, want {release_id}"
            )
        reports[collection] = {
            "release_id": report.release_id,
            "counts": report.counts,
        }
    print(
        json.dumps(
            {
                "status": "ok",
                "corpus": "campus_services",
                "releases": reports,
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def _default_release_id(generated_at: str) -> str:
    compact = (
        generated_at.replace("-", "")
        .replace(":", "")
        .replace("+", "")
        .replace(".", "")
        .replace("T", "T")
    )
    return f"service-status-smoke-{compact}"


def _smoke_service_status_bundle() -> dict[str, object]:
    return {
        "schema_version": "campus_services_projection_bundle.v1",
        "service_status_records": [
            {
                "subject_id": "service:smoke:campus-card",
                "display_name": "校园卡服务状态 smoke",
                "service_family": "service_counter",
                "aliases": ["校园卡", "一卡通", "卡务中心", "structured projection smoke"],
                "campus_scope": "all",
                "affected_scope": "smoke",
                "observed_status": "open",
                "effective_from": "2026-01-01T00:00:00+08:00",
                "effective_until": "2099-12-31T23:59:59+08:00",
                "status_note": "仅用于结构化投影写入 smoke。",
                "severity": "normal",
                "override_source_refs": ["smoke:structured-projection"],
                "related_notice_refs": ["smoke:structured-projection"],
                "extraction_status": "ready",
            }
        ],
    }


def _smoke_transport_schedule_bundle() -> dict[str, object]:
    return {
        "schema_version": "campus_services_projection_bundle.v1",
        "transport_schedule_snapshots": [
            {
                "snapshot_id": "snapshot:bus:smoke-2026-04-20",
                "published_at": "2026-04-20T18:00:00+08:00",
                "effective_from": "2026-04-21T00:00:00+08:00",
                "source_ref": "smoke:transport-schedule",
                "is_current": True,
            }
        ],
        "transport_routes": [
            {
                "route_id": "route:haidian-to-fengtai",
                "display_name": "海淀到丰台通勤车",
                "service_family": "intercampus_commute",
                "aliases": ["校车", "通勤车"],
                "origin_campus": "haidian",
                "destination_campus": "fengtai",
                "stops": [
                    {"stop_id": "stop:haidian-east-gate", "display_name": "海淀东门"},
                    {"stop_id": "stop:fengtai-main-gate", "display_name": "丰台南门"},
                ],
            }
        ],
        "scheduled_departures": [
            {
                "snapshot_id": "snapshot:bus:smoke-2026-04-20",
                "route_id": "route:haidian-to-fengtai",
                "service_dates": ["2026-04-25"],
                "departure_time": "06:50",
                "arrival_time": "08:05",
                "origin_stop_id": "stop:haidian-east-gate",
                "destination_stop_id": "stop:fengtai-main-gate",
                "related_notice_refs": ["smoke:transport-schedule"],
            }
        ],
        "transport_service_exceptions": [],
    }


def _smoke_service_guide_bundle() -> dict[str, object]:
    return {
        "schema_version": "campus_services_service_guide_projection.v1",
        "service_guide_records": [
            {
                "service_id": "service:smoke:medical-reimbursement",
                "display_name": "公费医疗报销 smoke",
                "aliases": ["公费医疗", "医疗报销", "医药费报销", "服务指南 smoke"],
                "category": "healthcare",
                "campus_scope": "all",
                "audience": ["student"],
                "effective_from": "2026-01-01T00:00:00+08:00",
                "effective_until": "2099-12-31T23:59:59+08:00",
                "source_refs": ["smoke:service-guide"],
                "guide_sections": [
                    {
                        "section_id": "service:smoke:medical-reimbursement:section:materials",
                        "section_type": "required_materials",
                        "title": "办理材料",
                        "content": "准备报销单据和学生身份证明。",
                        "order": 1,
                        "source_refs": ["smoke:service-guide"],
                    }
                ],
                "materials": [
                    {
                        "material_id": "service:smoke:medical-reimbursement:material:invoice",
                        "name": "报销单据",
                        "required": True,
                        "source_refs": ["smoke:service-guide"],
                    }
                ],
                "entry_refs": [
                    {
                        "entry_id": "service:smoke:medical-reimbursement:entry:portal",
                        "label": "服务门户",
                        "entry_type": "url",
                        "url": "https://example.invalid/service",
                        "source_refs": ["smoke:service-guide"],
                    }
                ],
                "office_hours": [],
                "contact_refs": [],
                "eligibility_notes": [],
                "extraction_status": "ready",
            }
        ],
        "conflict_records": [],
        "manual_review_sources": [],
    }


def _smoke_contact_directory_bundle() -> dict[str, object]:
    return {
        "schema_version": "campus_services_contact_directory_projection.v1",
        "contact_records": [
            {
                "contact_id": "contact:smoke:campus-card-center",
                "display_name": "卡务中心联系电话 smoke",
                "aliases": ["卡务中心", "一卡通中心", "联系电话 smoke"],
                "contact_group": "campus_card",
                "department": "卡务中心",
                "phones": [
                    {
                        "phone_id": "phone:smoke:transport-office",
                        "label": "咨询电话",
                        "number": "010-00000000",
                        "source_refs": ["smoke:contact-directory"],
                    }
                ],
                "emails": [],
                "location_refs": [],
                "source_refs": ["smoke:contact-directory"],
                "extraction_status": "ready",
            }
        ],
        "conflict_records": [],
        "manual_review_sources": [],
    }


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
