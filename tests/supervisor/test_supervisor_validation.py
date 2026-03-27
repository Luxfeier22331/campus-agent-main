from __future__ import annotations

import unittest

from campus_contracts import KnowledgeScope, SupervisorRequest
from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.errors import (
    InvalidSupervisorRequestError,
    MissingRoutingInputError,
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
                        collection="student_handbook",
                    ),
                )
            )
        )

        self.assertEqual(capability, "knowledge")

    def test_resolve_requested_capability_infers_availability_from_target(self) -> None:
        capability = resolve_requested_capability(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="官网能打开吗",
                    availability_target_id="official-homepage",
                )
            )
        )

        self.assertEqual(capability, "availability")

    def test_resolve_requested_capability_rejects_missing_scope_for_knowledge(self) -> None:
        context = SupervisorRequestContext.from_request(
            SupervisorRequest(
                user_goal="library hours",
                requested_capability="knowledge",
            )
        )

        with self.assertRaisesRegex(
            MissingRoutingInputError,
            "requested_scope is required for knowledge requests",
        ):
            resolve_requested_capability(context)

    def test_resolve_requested_capability_rejects_target_on_knowledge_request(self) -> None:
        context = SupervisorRequestContext.from_request(
            SupervisorRequest(
                user_goal="library hours",
                requested_capability="knowledge",
                requested_scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_handbook",
                ),
                availability_target_id="official-homepage",
            )
        )

        with self.assertRaisesRegex(
            InvalidSupervisorRequestError,
            "availability_target_id is not allowed for knowledge requests",
        ):
            resolve_requested_capability(context)

    def test_resolve_requested_capability_rejects_scope_on_availability_request(self) -> None:
        context = SupervisorRequestContext.from_request(
            SupervisorRequest(
                user_goal="官网能打开吗",
                requested_capability="availability",
                requested_scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_handbook",
                ),
                availability_target_id="official-homepage",
            )
        )

        with self.assertRaisesRegex(
            InvalidSupervisorRequestError,
            "requested_scope is not allowed for availability requests",
        ):
            resolve_requested_capability(context)
