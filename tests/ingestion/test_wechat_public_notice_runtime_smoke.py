from __future__ import annotations

import unittest
from dataclasses import dataclass

from campus_ingestion_core.internal_notice_consumption_admission import (
    InMemoryInternalNoticeConsumptionAdmissionStore,
    InternalNoticeConsumptionAdmissionRecord,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.wechat_public_notice_multimodal import (
    InMemoryWeChatPublicNoticeMultimodalAttemptStore,
)
from campus_ingestion_core.wechat_public_notice_runtime_smoke import (
    run_wechat_public_notice_runtime_smoke,
)


class WeChatPublicNoticeRuntimeSmokeTest(unittest.TestCase):
    def test_runtime_smoke_reports_ok_for_admitted_queryable_notice(self) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                _entry(
                    "woa_article_alpha",
                    "notice_unit:wechat:woa_article_alpha:notice_window",
                    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    role_metadata={
                        "body_state": "captured",
                        "manifest_key": "source-truth/article-manifest.json",
                        "content_blocks_key": "source-truth/content-blocks.jsonl",
                        "media_refs_key": "source-truth/media-refs.jsonl",
                        "source_bucket": "source",
                        "consumer_admission_batch_id": "batch-wechat-001",
                    },
                ),
            )
        )
        admission_store = InMemoryInternalNoticeConsumptionAdmissionStore(
            (
                InternalNoticeConsumptionAdmissionRecord(
                    batch_id="batch-wechat-001",
                    source_corpus="campus_notices",
                    source_collection="wechat_public_notice",
                    command="wechat_public_notice_projection_rebuild",
                    selected_notice_ids=("woa_article_alpha",),
                    status="completed",
                    result_counts={"projection_entry_count": 1},
                    created_at="2026-04-28T10:00:00Z",
                ),
            )
        )
        read_model_store = _ReadModelStore(
            (_ReadModelRow(unit_id="notice_unit:wechat:woa_article_alpha:notice_window"),)
        )
        object_store = _HeadObjectStore(
            {
                ("source", "source-truth/article-manifest.json"),
                ("source", "source-truth/content-blocks.jsonl"),
                ("source", "source-truth/media-refs.jsonl"),
            }
        )

        report = run_wechat_public_notice_runtime_smoke(
            notice_ids=("woa_article_alpha",),
            projection_store=projection_store,
            read_model_store=read_model_store,
            admission_store=admission_store,
            attempt_store=InMemoryWeChatPublicNoticeMultimodalAttemptStore(),
            object_store=object_store,
        )

        self.assertTrue(report.ok)
        self.assertEqual(report.projection_entry_count, 1)
        self.assertEqual(report.completed_admission_batch_count, 1)
        self.assertEqual(report.projection_entries_missing_admission_count, 0)
        self.assertEqual(report.queryable_without_captured_body_count, 0)
        self.assertEqual(report.source_truth_missing_object_count, 0)

    def test_runtime_smoke_flags_queryable_row_without_captured_body(self) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                _entry(
                    "woa_article_bad",
                    "notice_unit:wechat:woa_article_bad:notice_window",
                    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    role_metadata={
                        "body_state": "fetch_failed",
                        "manifest_key": "source-truth/article-manifest.json",
                        "content_blocks_key": "source-truth/content-blocks.jsonl",
                        "media_refs_key": "source-truth/media-refs.jsonl",
                        "source_bucket": "source",
                        "consumer_admission_batch_id": "batch-wechat-001",
                    },
                ),
            )
        )
        admission_store = InMemoryInternalNoticeConsumptionAdmissionStore(
            (
                InternalNoticeConsumptionAdmissionRecord(
                    batch_id="batch-wechat-001",
                    source_corpus="campus_notices",
                    source_collection="wechat_public_notice",
                    command="wechat_public_notice_projection_rebuild",
                    selected_notice_ids=("woa_article_bad",),
                    status="completed",
                    result_counts={"projection_entry_count": 1},
                    created_at="2026-04-28T10:00:00Z",
                ),
            )
        )

        report = run_wechat_public_notice_runtime_smoke(
            notice_ids=("woa_article_bad",),
            projection_store=projection_store,
            read_model_store=_ReadModelStore(
                (_ReadModelRow(unit_id="notice_unit:wechat:woa_article_bad:notice_window"),)
            ),
            admission_store=admission_store,
            attempt_store=InMemoryWeChatPublicNoticeMultimodalAttemptStore(),
            object_store=_HeadObjectStore(
                {
                    ("source", "source-truth/article-manifest.json"),
                    ("source", "source-truth/content-blocks.jsonl"),
                    ("source", "source-truth/media-refs.jsonl"),
                }
            ),
        )

        self.assertFalse(report.ok)
        self.assertEqual(report.queryable_without_captured_body_count, 1)

    def test_runtime_smoke_flags_pending_multimodal_without_attempt_or_source_image(self) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                _entry(
                    "woa_article_pending",
                    "notice_unit:wechat:woa_article_pending:pending_multimodal",
                    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
                    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
                    role_metadata={
                        "body_state": "captured",
                        "manifest_key": "source-truth/article-manifest.json",
                        "content_blocks_key": "source-truth/content-blocks.jsonl",
                        "media_refs_key": "source-truth/media-refs.jsonl",
                        "source_bucket": "source",
                        "consumer_admission_batch_id": "batch-wechat-002",
                        "inline_image_ref_ids": ("woa_article_pending:media:1",),
                        "source_image_object_keys": (),
                    },
                ),
            )
        )
        admission_store = InMemoryInternalNoticeConsumptionAdmissionStore(
            (
                InternalNoticeConsumptionAdmissionRecord(
                    batch_id="batch-wechat-002",
                    source_corpus="campus_notices",
                    source_collection="wechat_public_notice",
                    command="wechat_multimodal_drain",
                    selected_notice_ids=("woa_article_pending",),
                    status="completed",
                    result_counts={"projection_entry_count": 1},
                    created_at="2026-04-28T10:00:00Z",
                ),
            )
        )

        report = run_wechat_public_notice_runtime_smoke(
            notice_ids=("woa_article_pending",),
            projection_store=projection_store,
            read_model_store=_ReadModelStore(()),
            admission_store=admission_store,
            attempt_store=InMemoryWeChatPublicNoticeMultimodalAttemptStore(),
            object_store=_HeadObjectStore(
                {
                    ("source", "source-truth/article-manifest.json"),
                    ("source", "source-truth/content-blocks.jsonl"),
                    ("source", "source-truth/media-refs.jsonl"),
                }
            ),
        )

        self.assertFalse(report.ok)
        self.assertEqual(report.pending_multimodal_without_attempt_count, 1)
        self.assertEqual(report.pending_multimodal_without_source_image_count, 1)


@dataclass(frozen=True, slots=True)
class _ReadModelRow:
    unit_id: str


class _ReadModelStore:
    def __init__(self, rows: tuple[_ReadModelRow, ...]) -> None:
        self.rows = rows

    def list_by_scope(self, *args, **kwargs) -> tuple[_ReadModelRow, ...]:
        return self.rows


class _HeadObjectStore:
    def __init__(self, available: set[tuple[str, str]]) -> None:
        self.available = available

    def head_object(self, *, bucket: str, key: str) -> dict[str, object]:
        if (bucket, key) not in self.available:
            raise KeyError((bucket, key))
        return {"ContentLength": 1}


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
