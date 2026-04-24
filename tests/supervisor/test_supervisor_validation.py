from __future__ import annotations

import unittest

from campus_contracts import KnowledgeScope, SupervisorRequest, VersionQuery
from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.errors import (
    InvalidSupervisorRequestError,
)
from campus_supervisor_core.validation import resolve_requested_capability


class SupervisorValidationTest(unittest.TestCase):
    def test_resolve_requested_capability_infers_knowledge_from_scope(self) -> None:
        capability = resolve_requested_capability(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="library hours",
                    requested_scope=KnowledgeScope(
                        corpus="regulations",
                        collection="student_rules",
                    ),
                )
            )
        )

        self.assertEqual(capability, "knowledge")

    def test_resolve_requested_capability_infers_place_lookup_from_goal(self) -> None:
        capability = resolve_requested_capability(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="图书馆在哪里",
                )
            )
        )

        self.assertEqual(capability, "place_lookup")

    def test_resolve_requested_capability_allows_missing_scope_for_knowledge(self) -> None:
        context = SupervisorRequestContext.from_request(
            SupervisorRequest(
                user_goal="library hours",
                requested_capability="knowledge",
            )
        )

        capability = resolve_requested_capability(context)

        self.assertEqual(capability, "knowledge")

    def test_resolve_requested_capability_allows_forward_structured_capabilities(self) -> None:
        for requested_capability in ("campus_services", "notice"):
            with self.subTest(requested_capability=requested_capability):
                context = SupervisorRequestContext.from_request(
                    SupervisorRequest(
                        user_goal="校车时刻表",
                        requested_capability=requested_capability,
                    )
                )

                capability = resolve_requested_capability(context)

                self.assertEqual(capability, requested_capability)

    def test_resolve_requested_capability_rejects_scope_on_forward_structured_capability(
        self,
    ) -> None:
        context = SupervisorRequestContext.from_request(
            SupervisorRequest(
                user_goal="校车时刻表",
                requested_capability="campus_services",
                requested_scope=KnowledgeScope(
                    corpus="campus_services",
                    collection="service_catalog",
                ),
            )
        )

        with self.assertRaisesRegex(
            InvalidSupervisorRequestError,
            "requested_scope is only allowed for knowledge requests",
        ):
            resolve_requested_capability(context)

    def test_resolve_requested_capability_rejects_version_query_on_forward_structured_capability(
        self,
    ) -> None:
        context = SupervisorRequestContext.from_request(
            SupervisorRequest(
                user_goal="找一下历史通知",
                requested_capability="notice",
                version_query=VersionQuery(mode="historical"),
            )
        )

        with self.assertRaisesRegex(
            InvalidSupervisorRequestError,
            "version_query is only allowed for knowledge requests",
        ):
            resolve_requested_capability(context)

    def test_resolve_requested_capability_rejects_scope_on_place_lookup_request(self) -> None:
        context = SupervisorRequestContext.from_request(
            SupervisorRequest(
                user_goal="图书馆在哪里",
                requested_capability="place_lookup",
                requested_scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_rules",
                ),
            )
        )

        with self.assertRaisesRegex(
            InvalidSupervisorRequestError,
            "requested_scope is not allowed for place_lookup requests",
        ):
            resolve_requested_capability(context)

    def test_resolve_requested_capability_rejects_version_query_on_place_lookup_request(
        self,
    ) -> None:
        context = SupervisorRequestContext.from_request(
            SupervisorRequest(
                user_goal="图书馆在哪里",
                version_query=VersionQuery(mode="historical"),
            )
        )

        with self.assertRaisesRegex(
            InvalidSupervisorRequestError,
            "version_query is not allowed for place_lookup requests",
        ):
            resolve_requested_capability(context)
