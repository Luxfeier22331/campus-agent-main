from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
    CampusNoticeDiscoverPayload,
    CampusNoticeDiscoverResult,
    ContextProjection,
    NoticeCard,
    SpecialistRequest,
)
from campus_notice_agent.runtime_query_service import (
    PostgresNoticeReadModelRepository,
    build_notice_read_model_query_service_from_env,
)
from campus_notice_agent.service import delegate_to_notice_agent


class NoticeRuntimeWiringTest(unittest.TestCase):
    def test_delegate_builds_default_query_service_from_env(self) -> None:
        query_service = _FakeNoticeQueryService()
        request = SpecialistRequest(
            target="notice-agent",
            user_goal="找采购通知",
            payload=CampusNoticeDiscoverPayload(
                query_text="家具采购",
                source_families=("internal_notice_restricted",),
            ),
            allowed_tools=("campus_notice_discover",),
            actor=ActorContext(user_id="student-001"),
            context=_restricted_context_projection(),
        )

        with patch(
            "campus_notice_agent.service.build_notice_read_model_query_service_from_env",
            return_value=query_service,
        ) as build_query_service:
            response = delegate_to_notice_agent(
                request,
                env={
                    "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL": "postgresql://example.test/db",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                },
            )

        self.assertEqual(response.status, "completed")
        self.assertEqual(query_service.discover_count, 1)
        self.assertEqual(
            build_query_service.call_args.kwargs["env"]["INTERNAL_NOTICE_READ_MODEL_DATABASE_URL"],
            "postgresql://example.test/db",
        )

    def test_delegate_fails_closed_when_default_query_service_is_unavailable(self) -> None:
        request = SpecialistRequest(
            target="notice-agent",
            user_goal="找采购通知",
            payload=CampusNoticeDiscoverPayload(
                query_text="家具采购",
                source_families=("internal_notice_restricted",),
            ),
            allowed_tools=("campus_notice_discover",),
        )

        with patch(
            "campus_notice_agent.service.build_notice_read_model_query_service_from_env",
            return_value=None,
        ):
            response = delegate_to_notice_agent(request, env={})

        self.assertEqual(response.status, "error")
        self.assertEqual(response.error.code, "internal_query_service_unavailable")

    def test_postgres_repository_searches_and_gets_notice_records(self) -> None:
        search_row = _record_payload("355222", title="家具采购公告")
        get_row = _record_payload("355222", title="家具采购公告")
        cursor = _PagedCursor([[(_json(search_row),)], [(_json(get_row),)]])
        repository = PostgresNoticeReadModelRepository(
            database_url="postgresql://example.test/db",
            connection_factory=lambda *_args, **_kwargs: _FakeConnection(cursor),
        )

        search_rows = repository.search(
            source_families=("internal_notice_restricted",),
            query_text="家具采购",
            max_results=5,
        )
        get_result = repository.get_by_notice_id(
            notice_id="355222",
            source_family="internal_notice_restricted",
        )

        self.assertEqual(search_rows[0].source_notice_id, "355222")
        self.assertEqual(search_rows[0].title, "家具采购公告")
        self.assertEqual(get_result.source_notice_id if get_result else "", "355222")
        search_query, search_params = cursor.execute_calls[0]
        self.assertIn("queryable = true", search_query)
        self.assertIn("search_vector", search_query)
        self.assertEqual(search_params[0], ["internal_notice_restricted"])
        get_query, get_params = cursor.execute_calls[1]
        self.assertIn("source_notice_id = %s", get_query)
        self.assertEqual(get_params, ("355222", "internal_notice_restricted"))

    def test_build_query_service_from_env_requires_pg_and_object_store(self) -> None:
        self.assertIsNone(build_notice_read_model_query_service_from_env(env={}))

        service = build_notice_read_model_query_service_from_env(
            env={
                "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL": "postgresql://example.test/db",
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
            }
        )

        self.assertIsNotNone(service)


class _FakeNoticeQueryService:
    def __init__(self) -> None:
        self.discover_count = 0

    def discover_notice(self, query) -> CampusNoticeDiscoverResult:
        self.discover_count += 1
        return CampusNoticeDiscoverResult(
            query_text=query.payload.query_text,
            outcome="resolved_current",
            source_families=("internal_notice_restricted",),
            notice_cards=(
                NoticeCard(
                    notice_id="355222",
                    title="家具采购公告",
                    source_family="internal_notice_restricted",
                    source_url="https://portal.example.edu/notices/355222",
                ),
            ),
        )

    def get_notice(self, query):  # pragma: no cover - not used in this wiring test
        raise AssertionError("get_notice should not be called")


def _restricted_context_projection() -> ContextProjection:
    return ContextProjection(
        actor=ActorContext(user_id="student-001"),
        authorization=AuthorizationProjection(
            principal_id="principal-001",
            entitlement_groups=("students",),
            retrieval_filter=AuthorizedRetrievalFilter(
                entitlement_groups=("students",),
                visibility_level="restricted",
            ),
        ),
    )


def _record_payload(notice_id: str, *, title: str) -> dict[str, object]:
    return {
        "source_family": "internal_notice_restricted",
        "source_notice_id": notice_id,
        "title": title,
        "source_url": f"https://portal.example.edu/notices/{notice_id}",
        "canonical_url": f"https://portal.example.edu/notices/{notice_id}",
        "published_at": "2026-04-12",
        "target_surface": "procurement_notice_history",
        "primary_role": "procurement_notice",
        "canonical_markdown_object_key": f"internal/{notice_id}/canonical.md",
        "attachment_refs": ["attachment-1"],
        "provenance_refs": [f"notice:muc_internal_portal:{notice_id}"],
    }


def _json(payload: dict[str, object]) -> str:
    return json.dumps(payload, ensure_ascii=False)


class _FakeConnection:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor

    def __enter__(self) -> _FakeConnection:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def cursor(self) -> _FakeCursorContext:
        return _FakeCursorContext(self._cursor)


class _FakeCursorContext:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor

    def __enter__(self) -> object:
        return self._cursor

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _PagedCursor:
    def __init__(self, pages: list[list[tuple[object, ...]]]) -> None:
        self._pages = list(pages)
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []

    def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.execute_calls.append((query, params))

    def fetchall(self) -> list[tuple[object, ...]]:
        return self._pages.pop(0) if self._pages else []


if __name__ == "__main__":
    unittest.main()
