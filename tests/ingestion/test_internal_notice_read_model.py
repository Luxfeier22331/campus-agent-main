from __future__ import annotations

import json
import unittest
from dataclasses import asdict
from unittest.mock import patch

from campus_ingestion_core.internal_notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE,
    NOTICE_PRIMARY_ROLE_ROSTER_PUBLICATION,
    NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
)
from campus_ingestion_core.internal_notice_read_model import (
    InMemoryInternalNoticeReadModelStore,
    PostgresInternalNoticeReadModelStore,
    build_internal_notice_read_model_entries,
    check_internal_notice_read_model_consistency,
    rebuild_internal_notice_read_model,
    repair_internal_notice_read_model_consistency,
)
from campus_ingestion_core.notice_consumption_projection import (
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
)

from tests.support.in_memory_registry import InMemoryDocumentRegistry

from .internal_notice_scoped_rule_materialization_test_support import (
    _canonical_markdown,
    _FakeObjectStore,
    _record,
)

EXPECTED_BODY_EXCERPT_MAX_CHARS = 800
EXPECTED_SEARCH_TEXT_MAX_CHARS = 2_000


class InternalNoticeReadModelTest(unittest.TestCase):
    def test_build_entries_excludes_non_notice_level_consumer_surfaces(self) -> None:
        registry, object_store, projection_entries = _runtime()

        rows = build_internal_notice_read_model_entries(
            projection_entries,
            registry=registry,
            object_store=object_store,
            bucket_derived="campus-rag-derived",
        )

        self.assertEqual(
            {row.target_surface for row in rows},
            {NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY},
        )
        self.assertNotIn(
            "notice_unit:355222:procurement_notice",
            {row.unit_id for row in rows},
        )
        self.assertNotIn(
            "notice_unit:355111:service_status_override",
            {row.unit_id for row in rows},
        )

    def test_build_entries_materializes_queryable_notice_level_rows(self) -> None:
        registry, object_store, projection_entries = _runtime()

        rows = build_internal_notice_read_model_entries(
            projection_entries,
            registry=registry,
            object_store=object_store,
            bucket_derived="campus-rag-derived",
        )

        queryable = {row.unit_id: row for row in rows if row.queryable}
        self.assertEqual(
            {
                row.target_surface
                for row in queryable.values()
                if row.source_notice_id in {"355222", "355111"}
            },
            {
                NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
            },
        )
        notice_row = next(
            row for row in rows if row.primary_role == NOTICE_PRIMARY_ROLE_NOTICE_WINDOW
        )
        self.assertTrue(notice_row.queryable)
        self.assertEqual(notice_row.title, "中央民族大学丰台校区家具采购项目比选公告")
        self.assertEqual(
            notice_row.source_url,
            "https://portal.example.edu/notices/355222",
        )
        self.assertEqual(
            notice_row.canonical_url,
            "https://portal.example.edu/notices/355222",
        )
        self.assertEqual(notice_row.target_surface, NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY)
        self.assertEqual(
            notice_row.canonical_markdown_object_key,
            "campus_notices/documents/internal_notice/355222/canonical.md",
        )
        self.assertIn("家具采购项目", notice_row.search_text)
        self.assertIn("投标", notice_row.search_text)
        self.assertEqual(
            notice_row.body_excerpt,
            "# 中央民族大学丰台校区家具采购项目比选公告\n\n供应商应按要求投标。",
        )
        self.assertEqual(notice_row.visibility_level, "restricted")
        self.assertEqual(notice_row.entitlement_groups, ("campus_members",))
        self.assertEqual(
            notice_row.policy_projection_version,
            "phase1-authorization-projection-v1",
        )
        self.assertEqual(notice_row.published_at_ts, "2026-04-10T00:00:00+08:00")

    def test_build_entries_keeps_full_body_out_of_read_model_storage(self) -> None:
        registry, object_store, projection_entries = _runtime()
        long_tail = "TAIL_MARKER_SHOULD_NOT_BE_STORED"
        long_body = "正文" * (EXPECTED_SEARCH_TEXT_MAX_CHARS + 100)
        object_store.objects[
            (
                "campus-rag-derived",
                "campus_notices/documents/internal_notice/355222/canonical.md",
            )
        ] = _canonical_markdown(f"# 采购公告\n\n{long_body}\n\n{long_tail}")

        rows = build_internal_notice_read_model_entries(
            projection_entries,
            registry=registry,
            object_store=object_store,
            bucket_derived="campus-rag-derived",
        )
        notice_row = next(
            row for row in rows if row.primary_role == NOTICE_PRIMARY_ROLE_NOTICE_WINDOW
        )

        self.assertLessEqual(
            len(notice_row.body_excerpt),
            EXPECTED_BODY_EXCERPT_MAX_CHARS,
        )
        self.assertLessEqual(
            len(notice_row.search_text),
            EXPECTED_SEARCH_TEXT_MAX_CHARS,
        )
        self.assertNotIn(long_tail, notice_row.body_excerpt)
        self.assertNotIn(long_tail, notice_row.search_text)

    def test_build_entries_indexes_multimodal_processing_summary(self) -> None:
        registry, object_store, projection_entries = _runtime()
        multimodal_entry = _projection_entry(
            notice_id="355333",
            unit_id="notice_unit:355333:processed_multimodal",
            primary_role=NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
            target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
            consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
            title="关于校园空间示意图的通知",
        )
        multimodal_entry.role_metadata.update(
            {
                "multimodal_summary": "图中说明了丰台校区办事地点分布。",
                "multimodal_extracted_text": "北区服务大厅办理校园卡业务。",
            }
        )

        rows = build_internal_notice_read_model_entries(
            (*projection_entries, multimodal_entry),
            registry=registry,
            object_store=object_store,
            bucket_derived="campus-rag-derived",
        )

        multimodal_row = next(
            row for row in rows if row.unit_id == "notice_unit:355333:processed_multimodal"
        )
        self.assertTrue(multimodal_row.queryable)
        self.assertIn("丰台校区办事地点分布", multimodal_row.body_excerpt)
        self.assertIn("校园卡业务", multimodal_row.search_text)

    def test_build_entries_preserves_held_regulation_notice_as_notice_level_card(
        self,
    ) -> None:
        held_record = _record(
            notice_id="187233",
            title_slug="procurement-amendment-summary",
            content_hash="sha256:187233",
            body_key="campus_notices/documents/internal_notice/187233/canonical.md",
            units_key="campus_notices/documents/internal_notice/187233/document-units.jsonl",
            is_current=True,
        )
        registry = InMemoryDocumentRegistry((held_record,))
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-rag-derived",
                    held_record.canonical_markdown_object_key,
                ): _canonical_markdown(
                    "# 关于修订《中央民族大学采购工作管理办法》的通知\n\n"
                    "本通知仅说明主要修订内容，不包含完整管理办法正文。\n"
                )
            }
        )
        held_entry = _projection_entry(
            notice_id="187233",
            unit_id="notice_unit:187233:held_regulation_notice",
            primary_role=NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
            target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
            consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
            title="关于修订《中央民族大学采购工作管理办法》的通知",
        )
        held_entry.role_metadata.update(
            {
                "classification": "amendment_summary_only",
                "regulation_title_normalized": "中央民族大学采购工作管理办法",
                "rejection_reason": "parent_notice_body_not_full_regulation_text",
            }
        )

        rows = build_internal_notice_read_model_entries(
            (held_entry,),
            registry=registry,
            object_store=object_store,
            bucket_derived="campus-rag-derived",
        )

        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertTrue(row.queryable)
        self.assertEqual(row.source_notice_id, "187233")
        self.assertEqual(row.target_surface, NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY)
        self.assertEqual(row.title, "关于修订《中央民族大学采购工作管理办法》的通知")
        self.assertEqual(row.source_url, "https://portal.example.edu/notices/187233")
        self.assertEqual(row.canonical_url, "https://portal.example.edu/notices/187233")
        self.assertEqual(
            row.canonical_document_id,
            "notice:muc_internal_portal:187233",
        )
        self.assertIn("不包含完整管理办法正文", row.body_excerpt)
        self.assertIn("中央民族大学采购工作管理办法", row.search_text)

    def test_rebuild_internal_notice_read_model_replaces_selected_notices(self) -> None:
        registry, object_store, projection_entries = _runtime()
        projection_store = InMemoryNoticeConsumptionProjectionStore(projection_entries)
        read_model_store = InMemoryInternalNoticeReadModelStore(
            (
                _read_model_seed("355222", "stale-unit"),
                _read_model_seed("999999", "unrelated-unit"),
            )
        )

        rows = rebuild_internal_notice_read_model(
            projection_store=projection_store,
            read_model_store=read_model_store,
            registry=registry,
            object_store=object_store,
            bucket_derived="campus-rag-derived",
            source_corpus="campus_notices",
            source_collection="internal_notice",
            notice_ids=("355222",),
        )

        self.assertEqual({row.source_notice_id for row in rows}, {"355222"})
        stored_355222 = read_model_store.list_by_scope(
            "campus_notices",
            "internal_notice",
            notice_ids=("355222",),
        )
        self.assertNotIn("stale-unit", {row.unit_id for row in stored_355222})
        self.assertEqual(
            {
                row.source_notice_id
                for row in read_model_store.list_by_scope("campus_notices", "internal_notice")
            },
            {"355222", "999999"},
        )

    def test_rebuild_internal_notice_read_model_refuses_persistent_full_scope_rebuild(
        self,
    ) -> None:
        registry, object_store, projection_entries = _runtime()
        projection_store = InMemoryNoticeConsumptionProjectionStore(projection_entries)
        read_model_store = object.__new__(PostgresInternalNoticeReadModelStore)

        with self.assertRaisesRegex(
            ValueError,
            "refusing persistent full-scope internal notice read model rebuild",
        ):
            rebuild_internal_notice_read_model(
                projection_store=projection_store,
                read_model_store=read_model_store,
                registry=registry,
                object_store=object_store,
                bucket_derived="campus-rag-derived",
                source_corpus="campus_notices",
                source_collection="internal_notice",
            )

    def test_check_read_model_consistency_reports_missing_queryable_and_extra_rows(self) -> None:
        _registry, _object_store, projection_entries = _runtime()
        projection_store = InMemoryNoticeConsumptionProjectionStore(projection_entries)
        read_model_store = InMemoryInternalNoticeReadModelStore(
            (
                _read_model_seed("355222", "notice_unit:355222:notice_window"),
                _read_model_seed("999999", "orphan-unit"),
            )
        )

        report = check_internal_notice_read_model_consistency(
            projection_store=projection_store,
            read_model_store=read_model_store,
            source_corpus="campus_notices",
            source_collection="internal_notice",
        )

        self.assertFalse(report.ok)
        self.assertEqual(report.projection_entry_count, 5)
        self.assertEqual(report.projection_queryable_count, 1)
        self.assertEqual(report.read_model_entry_count, 2)
        self.assertEqual(report.missing_queryable_projection_unit_ids, ())
        self.assertEqual(report.extra_read_model_unit_ids, ("orphan-unit",))

    def test_repair_read_model_consistency_replaces_selected_notice_rows(self) -> None:
        registry, object_store, projection_entries = _runtime()
        projection_store = InMemoryNoticeConsumptionProjectionStore(projection_entries)
        read_model_store = InMemoryInternalNoticeReadModelStore(
            (
                _read_model_seed("355222", "notice_unit:355222:notice_window"),
                _read_model_seed("355222", "stale-procurement-unit"),
                _read_model_seed("999999", "unrelated-unit"),
            )
        )

        report = repair_internal_notice_read_model_consistency(
            projection_store=projection_store,
            read_model_store=read_model_store,
            registry=registry,
            object_store=object_store,
            bucket_derived="campus-rag-derived",
            source_corpus="campus_notices",
            source_collection="internal_notice",
            notice_ids=("355222",),
        )

        self.assertFalse(report.before.ok)
        self.assertTrue(report.after.ok)
        self.assertEqual(report.rebuilt_count, 1)
        stored_355222 = read_model_store.list_by_scope(
            "campus_notices",
            "internal_notice",
            notice_ids=("355222",),
        )
        self.assertEqual(
            {row.unit_id for row in stored_355222},
            {"notice_unit:355222:notice_window"},
        )
        self.assertEqual(
            {
                row.source_notice_id
                for row in read_model_store.list_by_scope("campus_notices", "internal_notice")
            },
            {"355222", "999999"},
        )

    def test_repair_read_model_consistency_requires_selected_notice_ids(self) -> None:
        registry, object_store, projection_entries = _runtime()
        with self.assertRaisesRegex(ValueError, "selected notice_ids are required"):
            repair_internal_notice_read_model_consistency(
                projection_store=InMemoryNoticeConsumptionProjectionStore(projection_entries),
                read_model_store=InMemoryInternalNoticeReadModelStore(),
                registry=registry,
                object_store=object_store,
                bucket_derived="campus-rag-derived",
                source_corpus="campus_notices",
                source_collection="internal_notice",
            )

    def test_in_memory_read_model_orders_by_publication_timestamp(self) -> None:
        older = _read_model_seed("999999", "notice_unit:999999:older")
        newer = _read_model_seed("111111", "notice_unit:111111:newer")
        older = older.__class__(
            **{
                **asdict(older),
                "published_at": "2026-04-10",
                "published_at_ts": "2026-04-10T08:00:00+08:00",
                "search_text": "测试通知 排序",
            }
        )
        newer = newer.__class__(
            **{
                **asdict(newer),
                "published_at": "2026-04-10",
                "published_at_ts": "2026-04-10T09:00:00+08:00",
                "search_text": "测试通知 排序",
            }
        )
        store = InMemoryInternalNoticeReadModelStore((older, newer))

        rows = store.search(
            source_families=("internal_notice_restricted",),
            query_text="排序",
            max_results=2,
        )

        self.assertEqual([row.source_notice_id for row in rows], ["111111", "999999"])

    def test_in_memory_read_model_get_by_notice_id_uses_publication_timestamp(self) -> None:
        older = _read_model_seed("355222", "notice_unit:355222:z-older")
        newer = _read_model_seed("355222", "notice_unit:355222:a-newer")
        older = older.__class__(
            **{
                **asdict(older),
                "published_at": "2026-04-10",
                "published_at_ts": "2026-04-10T08:00:00+08:00",
            }
        )
        newer = newer.__class__(
            **{
                **asdict(newer),
                "published_at": "2026-04-10",
                "published_at_ts": "2026-04-10T09:00:00+08:00",
            }
        )
        store = InMemoryInternalNoticeReadModelStore((older, newer))

        row = store.get_by_notice_id(notice_id="355222")

        self.assertIsNotNone(row)
        self.assertEqual(row.unit_id, "notice_unit:355222:a-newer")

    def test_postgres_store_ensures_search_indexes_and_rehydrates_records(self) -> None:
        store = object.__new__(PostgresInternalNoticeReadModelStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = "ingestion_projection.internal_notice_read_model"
        row = _read_model_seed("355222", "notice_unit:355222:notice_window")
        cursor = _PagedCursor([[(json.dumps(asdict(row)),)]])

        with patch(
            "campus_ingestion_core.internal_notice_read_model._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            records = store.search(
                source_families=("internal_notice_restricted",),
                query_text="家具采购",
                max_results=5,
            )

        self.assertEqual(records, (row,))
        query, params = cursor.execute_calls[0]
        self.assertIn("queryable = true", query)
        self.assertIn("search_vector", query)
        self.assertEqual(params[0], ["internal_notice_restricted"])

    def test_postgres_store_persists_body_excerpt_and_short_record_payload(self) -> None:
        row = _read_model_seed("355222", "notice_unit:355222:notice_window")
        row = row.__class__(
            **{
                **asdict(row),
                "body_excerpt": "短摘要",
                "search_text": "短搜索文本",
            }
        )
        payload = json.loads(PostgresInternalNoticeReadModelStore._recordset_payload((row,)))

        self.assertEqual(payload[0]["body_excerpt"], "短摘要")
        self.assertEqual(payload[0]["record"]["body_excerpt"], "短摘要")
        self.assertEqual(payload[0]["record"]["search_text"], "短搜索文本")


def _runtime():
    procurement_record = _record(
        notice_id="355222",
        title_slug="procurement-bid",
        content_hash="sha256:procurement",
        body_key="campus_notices/documents/internal_notice/355222/canonical.md",
        units_key="campus_notices/documents/internal_notice/355222/document-units.jsonl",
        is_current=True,
    )
    roster_record = _record(
        notice_id="355326",
        title_slug="student-roster",
        content_hash="sha256:roster",
        body_key="campus_notices/documents/internal_notice/355326/canonical.md",
        units_key="campus_notices/documents/internal_notice/355326/document-units.jsonl",
        is_current=True,
    )
    service_record = _record(
        notice_id="355111",
        title_slug="summer-service",
        content_hash="sha256:service",
        body_key="campus_notices/documents/internal_notice/355111/canonical.md",
        units_key="campus_notices/documents/internal_notice/355111/document-units.jsonl",
        is_current=True,
    )
    pending_multimodal_record = _record(
        notice_id="355333",
        title_slug="campus-map",
        content_hash="sha256:campus-map",
        body_key="campus_notices/documents/internal_notice/355333/canonical.md",
        units_key="campus_notices/documents/internal_notice/355333/document-units.jsonl",
        is_current=True,
    )
    registry = InMemoryDocumentRegistry(
        (
            procurement_record,
            roster_record,
            service_record,
            pending_multimodal_record,
        )
    )
    object_store = _FakeObjectStore(
        objects={
            (
                "campus-rag-derived",
                procurement_record.canonical_markdown_object_key,
            ): _canonical_markdown(
                "# 中央民族大学丰台校区家具采购项目比选公告\n\n供应商应按要求投标。\n"
            ),
            (
                "campus-rag-derived",
                roster_record.canonical_markdown_object_key,
            ): _canonical_markdown("# 优秀学生干部拟推荐名单公示\n\n名单略。\n"),
            (
                "campus-rag-derived",
                service_record.canonical_markdown_object_key,
            ): _canonical_markdown("# 关于暑假期间办理就业相关事务的通知\n\n服务时间调整。\n"),
            (
                "campus-rag-derived",
                pending_multimodal_record.canonical_markdown_object_key,
            ): _canonical_markdown("# 关于校园空间示意图的通知\n\n见附件示意图。\n"),
        }
    )
    projection_entries = (
        _projection_entry(
            notice_id="355222",
            unit_id="notice_unit:355222:notice_window",
            primary_role=NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
            target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
            consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
            title="中央民族大学丰台校区家具采购项目比选公告",
        ),
        _projection_entry(
            notice_id="355222",
            unit_id="notice_unit:355222:procurement_notice",
            primary_role=NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE,
            target_surface=NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
            consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
            title="中央民族大学丰台校区家具采购项目比选公告",
        ),
        _projection_entry(
            notice_id="355326",
            unit_id="notice_unit:355326:roster_publication",
            primary_role=NOTICE_PRIMARY_ROLE_ROSTER_PUBLICATION,
            target_surface=NOTICE_TARGET_SURFACE_UNSUPPORTED,
            consumption_status=NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
            title="关于2026年优秀学生干部拟推荐名单公示",
        ),
        _projection_entry(
            notice_id="355111",
            unit_id="notice_unit:355111:service_status_override",
            primary_role=NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
            target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
            consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
            title="关于暑假期间办理就业相关事务的通知",
        ),
        _projection_entry(
            notice_id="355333",
            unit_id="notice_unit:355333:multimodal_gap",
            primary_role=NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
            target_surface=NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
            consumption_status=NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
            title="关于校园空间示意图的通知",
        ),
    )
    return registry, object_store, projection_entries


def _projection_entry(
    *,
    notice_id: str,
    unit_id: str,
    primary_role: str,
    target_surface: str,
    consumption_status: str,
    title: str,
) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=unit_id,
        primary_role=primary_role,
        semantic_owner="notice_body",
        default_agent="notice",
        target_surface=target_surface,
        temporal_policy="point_in_time_publication",
        completeness_status="complete",
        answerability="body_only_answerable",
        consumption_status=consumption_status,
        source_notice_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_document_id=f"notice:muc_internal_portal:{notice_id}",
        role_metadata={"notice_title": title},
    )


def _read_model_seed(notice_id: str, unit_id: str):
    from campus_ingestion_core.internal_notice_read_model import InternalNoticeReadModelEntry

    return InternalNoticeReadModelEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=unit_id,
        primary_role=NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
        target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
        consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        queryable=True,
        title=f"测试通知 {notice_id}",
        published_at="2026-04-10",
        published_at_ts="2026-04-10T00:00:00+08:00",
        source_url=f"https://portal.example.edu/notices/{notice_id}",
        canonical_document_id=f"notice:muc_internal_portal:{notice_id}",
        canonical_markdown_object_key=(
            f"campus_notices/documents/internal_notice/{notice_id}/canonical.md"
        ),
        body_excerpt="",
        search_text=f"测试通知 {notice_id}",
        projection_updated_at="2026-04-10T00:00:00+00:00",
    )


class _FakeCursorContextManager:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor

    def __enter__(self) -> object:
        return self._cursor

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _FakeConnectionContextManager:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor

    def __enter__(self) -> _FakeConnectionContextManager:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def cursor(self) -> _FakeCursorContextManager:
        return _FakeCursorContextManager(self._cursor)


class _PagedCursor:
    def __init__(self, pages: list[list[tuple[object, ...]]]) -> None:
        self._pages = list(pages)
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []

    def execute(self, query: str, params: tuple[object, ...] = ()) -> None:
        self.execute_calls.append((query, params))

    def fetchall(self) -> list[tuple[object, ...]]:
        if not self._pages:
            return []
        return self._pages.pop(0)


if __name__ == "__main__":
    unittest.main()
