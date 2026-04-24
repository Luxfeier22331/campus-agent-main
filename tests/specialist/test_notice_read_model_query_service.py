from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
    CampusNoticeDiscoverPayload,
    CampusNoticeGetPayload,
)
from campus_notice_agent.query_service import (
    NoticeAccessContext,
    NoticeDiscoverQuery,
    NoticeGetQuery,
)
from campus_notice_agent.read_model_query_service import (
    NoticeReadModelQueryService,
    NoticeReadModelRecord,
    ObjectStoreNoticeBodyRepository,
)


class NoticeReadModelQueryServiceTest(unittest.TestCase):
    def test_discover_reads_pg_backed_repository_without_fetching_bodies(self) -> None:
        repository = _FakeReadRepository(
            (
                _record(
                    notice_id="355222",
                    title="中央民族大学丰台校区家具采购项目比选公告",
                    target_surface="procurement_notice_history",
                ),
            )
        )
        body_repository = _FakeBodyRepository()
        service = NoticeReadModelQueryService(
            read_repository=repository,
            body_repository=body_repository,
        )

        result = service.discover_notice(
            NoticeDiscoverQuery(
                payload=CampusNoticeDiscoverPayload(
                    query_text="家具采购",
                    source_families=("internal_notice_restricted",),
                    max_results=3,
                ),
                access_context=_restricted_access_context(),
            )
        )

        self.assertEqual(result.outcome, "resolved_current")
        self.assertEqual(result.notice_cards[0].notice_id, "355222")
        self.assertEqual(repository.last_search_query, "家具采购")
        self.assertEqual(body_repository.read_count, 0)

    def test_get_reads_body_after_read_model_and_authorization_gate(self) -> None:
        repository = _FakeReadRepository(
            (
                _record(
                    notice_id="355222",
                    title="中央民族大学丰台校区家具采购项目比选公告",
                    object_key="internal/355222/canonical.md",
                ),
            )
        )
        body_repository = _FakeBodyRepository(
            {"internal/355222/canonical.md": "# 采购公告\n\n供应商应按要求投标。"}
        )
        service = NoticeReadModelQueryService(
            read_repository=repository,
            body_repository=body_repository,
        )

        result = service.get_notice(
            NoticeGetQuery(
                payload=CampusNoticeGetPayload(
                    notice_id="355222",
                    source_family="internal_notice_restricted",
                ),
                access_context=_restricted_access_context(),
            )
        )

        self.assertEqual(result.outcome, "resolved_current")
        self.assertEqual(result.title, "中央民族大学丰台校区家具采购项目比选公告")
        self.assertIn("供应商应按要求投标", result.normalized_body)
        self.assertEqual(body_repository.read_count, 1)

    def test_get_fails_closed_when_canonical_body_is_unavailable(self) -> None:
        service = NoticeReadModelQueryService(
            read_repository=_FakeReadRepository(
                (
                    _record(
                        notice_id="355222",
                        object_key="internal/355222/missing.md",
                    ),
                )
            ),
            body_repository=_FakeBodyRepository(),
        )

        result = service.get_notice(
            NoticeGetQuery(
                payload=CampusNoticeGetPayload(
                    notice_id="355222",
                    source_family="internal_notice_restricted",
                ),
                access_context=_restricted_access_context(),
            )
        )

        self.assertEqual(result.outcome, "temporarily_unverifiable")
        self.assertEqual(result.fail_close_reason, "source_truth_unavailable")
        self.assertEqual(result.source_family, "internal_notice_restricted")

    def test_object_store_body_repository_reads_canonical_markdown(self) -> None:
        body_repository = ObjectStoreNoticeBodyRepository(
            object_store=_FakeObjectStore(
                {
                    ("campus-rag-derived", "internal/355222/canonical.md"): (
                        b"# \xe9\x87\x87\xe8\xb4\xad\xe5\x85\xac\xe5\x91\x8a"
                    ),
                }
            ),
            bucket="campus-rag-derived",
        )

        body = body_repository.get_body("internal/355222/canonical.md")

        self.assertEqual(body, "# 采购公告")

    def test_internal_restricted_discover_fails_closed_without_authorization(self) -> None:
        service = NoticeReadModelQueryService(
            read_repository=_FakeReadRepository((_record(notice_id="355222"),)),
            body_repository=_FakeBodyRepository(),
        )

        result = service.discover_notice(
            NoticeDiscoverQuery(
                payload=CampusNoticeDiscoverPayload(
                    query_text="家具采购",
                    source_families=("internal_notice_restricted",),
                )
            )
        )

        self.assertEqual(result.outcome, "temporarily_unverifiable")
        self.assertEqual(result.fail_close_reason, "source_family_unavailable")


def _restricted_access_context() -> NoticeAccessContext:
    return NoticeAccessContext(
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


def _record(
    *,
    notice_id: str,
    title: str = "测试通知",
    target_surface: str = "notice_level_query",
    object_key: str = "internal/notice/canonical.md",
) -> NoticeReadModelRecord:
    return NoticeReadModelRecord(
        source_family="internal_notice_restricted",
        source_notice_id=notice_id,
        title=title,
        source_url=f"https://portal.example.edu/notices/{notice_id}",
        canonical_url=f"https://portal.example.edu/notices/{notice_id}",
        published_at="2026-04-12",
        target_surface=target_surface,
        primary_role="notice_window",
        canonical_markdown_object_key=object_key,
        attachment_refs=("attachment-1",),
        provenance_refs=(f"notice:muc_internal_portal:{notice_id}",),
    )


class _FakeReadRepository:
    def __init__(self, rows: tuple[NoticeReadModelRecord, ...]) -> None:
        self.rows = rows
        self.last_search_query = ""

    def search(
        self,
        *,
        source_families: tuple[str, ...],
        query_text: str,
        max_results: int,
    ) -> tuple[NoticeReadModelRecord, ...]:
        self.last_search_query = query_text
        return self.rows[:max_results]

    def get_by_notice_id(
        self,
        *,
        notice_id: str,
        source_family: str = "",
    ) -> NoticeReadModelRecord | None:
        for row in self.rows:
            if row.source_notice_id == notice_id and (
                not source_family or row.source_family == source_family
            ):
                return row
        return None


class _FakeBodyRepository:
    def __init__(self, bodies: dict[str, str] | None = None) -> None:
        self.bodies = dict(bodies or {})
        self.read_count = 0

    def get_body(self, object_key: str) -> str:
        self.read_count += 1
        return self.bodies[object_key]


class _FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self.objects = dict(objects)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]


if __name__ == "__main__":
    unittest.main()
