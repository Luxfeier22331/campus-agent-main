from __future__ import annotations

import json
import unittest
from dataclasses import asdict
from unittest.mock import patch

from campus_ingestion_core.internal_notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE,
    NOTICE_PRIMARY_ROLE_ROSTER_PUBLICATION,
    NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
)
from campus_ingestion_core.internal_notice_read_model import (
    InMemoryInternalNoticeReadModelStore,
    PostgresInternalNoticeReadModelStore,
    build_internal_notice_read_model_entries,
    rebuild_internal_notice_read_model,
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
    def test_build_entries_materializes_queryable_notice_and_procurement_rows(self) -> None:
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
                NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
                NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
            },
        )
        procurement = next(
            row for row in rows if row.primary_role == NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE
        )
        self.assertTrue(procurement.queryable)
        self.assertEqual(procurement.title, "中央民族大学丰台校区家具采购项目比选公告")
        self.assertEqual(
            procurement.canonical_markdown_object_key,
            "campus_notices/documents/internal_notice/355222/canonical.md",
        )
        self.assertIn("家具采购项目", procurement.search_text)
        self.assertIn("投标", procurement.search_text)
        self.assertEqual(
            procurement.body_excerpt,
            "# 中央民族大学丰台校区家具采购项目比选公告\n\n供应商应按要求投标。",
        )

        roster = next(
            row for row in rows if row.primary_role == NOTICE_PRIMARY_ROLE_ROSTER_PUBLICATION
        )
        self.assertFalse(roster.queryable)
        self.assertEqual(roster.target_surface, NOTICE_TARGET_SURFACE_UNSUPPORTED)

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
        procurement = next(
            row for row in rows if row.primary_role == NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE
        )

        self.assertLessEqual(
            len(procurement.body_excerpt),
            EXPECTED_BODY_EXCERPT_MAX_CHARS,
        )
        self.assertLessEqual(
            len(procurement.search_text),
            EXPECTED_SEARCH_TEXT_MAX_CHARS,
        )
        self.assertNotIn(long_tail, procurement.body_excerpt)
        self.assertNotIn(long_tail, procurement.search_text)

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
    registry = InMemoryDocumentRegistry((procurement_record, roster_record, service_record))
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
        default_agent="notice-agent",
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
