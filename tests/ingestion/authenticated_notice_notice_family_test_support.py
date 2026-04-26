from __future__ import annotations

from pathlib import Path

from campus_ingestion_core.authenticated_notice_notice_family import (
    AuthenticatedNoticeNoticeFamilyConfig,
    classify_authenticated_notice_bundle_record,
    load_authenticated_notice_notice_family_config,
)

NOTICE_FAMILY_CONFIG_PATH = Path(
    "configs/ingestion/campus_notices/internal_notice/notice-family-classification.v1.json"
)


def load_notice_family_config() -> AuthenticatedNoticeNoticeFamilyConfig:
    return load_authenticated_notice_notice_family_config(NOTICE_FAMILY_CONFIG_PATH)


def bundle_record(
    *,
    notice_id: int,
    title: str,
    body: str = "",
    notice_type: str = "5",
    notice_type_name: str = "办公通知",
) -> dict:
    return {
        "notice_id": notice_id,
        "notice": {
            "notice_id": notice_id,
            "notice_title": title,
            "notice_content": body,
            "categories": [
                {
                    "notice_type": notice_type,
                    "notice_type_name": notice_type_name,
                }
            ],
        },
        "links": [],
        "notice_attachments": [],
        "attachments": [],
    }


def classify_notice_family_case(
    *,
    config: AuthenticatedNoticeNoticeFamilyConfig,
    notice_id: int,
    title: str,
    body: str = "",
    notice_type: str = "5",
    notice_type_name: str = "办公通知",
):
    return classify_authenticated_notice_bundle_record(
        bundle_record(
            notice_id=notice_id,
            title=title,
            body=body,
            notice_type=notice_type,
            notice_type_name=notice_type_name,
        ),
        config=config,
    )


__all__ = [
    "NOTICE_FAMILY_CONFIG_PATH",
    "bundle_record",
    "classify_notice_family_case",
    "load_notice_family_config",
]
