from __future__ import annotations

import unittest
from dataclasses import dataclass

from campus_ingestion_core.internal_notice_consumption_admission import (
    InMemoryInternalNoticeConsumptionAdmissionStore,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.wechat_public_notice_state_audit import (
    audit_wechat_public_notice_state,
)


class WeChatPublicNoticeStateAuditTest(unittest.TestCase):
    def test_audit_marks_reprojectable_and_purgeable_suspects(self) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                _entry(
                    "woa_article_reproject",
                    "notice_unit:wechat:woa_article_reproject:notice_window",
                    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    role_metadata={
                        "body_state": "fetch_failed",
                        "manifest_key": "source-truth/article-manifest.json",
                        "content_blocks_key": "source-truth/content-blocks.jsonl",
                        "media_refs_key": "source-truth/media-refs.jsonl",
                        "source_bucket": "source",
                    },
                ),
                _entry(
                    "woa_article_purge",
                    "notice_unit:wechat:woa_article_purge:pending_multimodal",
                    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
                    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
                    role_metadata={
                        "body_state": "captured",
                        "consumer_admission_batch_id": "batch-wechat-003",
                        "source_image_object_keys": (),
                    },
                ),
            )
        )
        read_model_store = _ReadModelStore(
            (
                _ReadModelRow(
                    source_notice_id="woa_orphan",
                    unit_id="notice_unit:wechat:woa_orphan:notice_window",
                ),
            )
        )

        report = audit_wechat_public_notice_state(
            projection_store=projection_store,
            read_model_store=read_model_store,
            admission_store=InMemoryInternalNoticeConsumptionAdmissionStore(),
        )

        self.assertEqual(report.projection_entry_count, 2)
        self.assertEqual(report.read_model_entry_count, 1)
        self.assertEqual(report.suspect_unit_count, 3)
        self.assertEqual(report.orphan_read_model_unit_count, 1)
        self.assertEqual(report.reproject_notice_ids, ("woa_article_reproject",))
        self.assertEqual(report.purge_notice_ids, ("woa_article_purge", "woa_orphan"))


@dataclass(frozen=True, slots=True)
class _ReadModelRow:
    source_notice_id: str
    unit_id: str


class _ReadModelStore:
    def __init__(self, rows: tuple[_ReadModelRow, ...]) -> None:
        self.rows = rows

    def list_by_scope(self, *args, **kwargs) -> tuple[_ReadModelRow, ...]:
        return self.rows


def _entry(
    notice_id: str,
    unit_id: str,
    target_surface: str,
    consumption_status: str,
    *,
    role_metadata: dict[str, object],
) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family="wechat_public_notice",
        source_corpus="campus_notices",
        source_collection="wechat_public_notice",
        source_notice_id=notice_id,
        unit_id=unit_id,
        primary_role="notice_window",
        semantic_owner="notice_body",
        default_agent="notice",
        target_surface=target_surface,
        temporal_policy="announcement_window",
        completeness_status="complete",
        answerability="body_only_answerable",
        consumption_status=consumption_status,
        source_notice_document_id=f"wechat_notice:muc:{notice_id}",
        source_document_id=f"wechat_notice:muc:{notice_id}",
        role_metadata=role_metadata,
    )


if __name__ == "__main__":
    unittest.main()
