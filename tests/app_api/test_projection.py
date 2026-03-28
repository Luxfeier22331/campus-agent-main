from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    AuthorizedRetrievalFilter,
    AuthorizationProjection,
    ContextProjection,
    ProfileMemoryItem,
    ProfileMemorySummary,
    SessionSlot,
    SessionSummary,
)
from campus_app_api import (
    AuthorizationInput,
    AuthorizedRetrievalFilterInput,
    ProfileMemoryRecord,
    SessionSlotRecord,
    VerifiedIdentityInput,
    build_context_projection,
)


class AppApiProjectionTest(unittest.TestCase):
    def test_build_context_projection_maps_verified_identity_profile_and_session_layers(self) -> None:
        projection = build_context_projection(
            identity=VerifiedIdentityInput(
                user_id="student-001",
                principal_id="principal-001",
                roles=("student",),
                groups=("students",),
                campus_scope="north",
                cohort="2023",
                major="philosophy",
                program="undergraduate",
            ),
            authorization=AuthorizationInput(
                principal_id="principal-001",
                entitlement_snapshot_id="entitlements-2026-03-29",
                entitlement_groups=("students",),
                visibility_scope="north",
                applicability_scope="undergraduate",
                ownership_scopes=("conversation:student-001",),
                approval_state="not_required",
                retrieval_filter=AuthorizedRetrievalFilterInput(
                    acl_groups=("students",),
                    visibility_scope="north",
                    campus_scope="north",
                ),
            ),
            profile_records=(
                ProfileMemoryRecord(
                    item_id="memory-001",
                    key="recent_goal",
                    value="咨询保研",
                    source_type="user_declared",
                    confidence="high",
                    visibility="user_visible",
                    last_verified_at="2026-03-28",
                ),
            ),
            session_slots=(
                SessionSlotRecord(name="policy_topic", value="推免资格", confirmed=True),
            ),
            turn_count=4,
        )

        self.assertEqual(
            projection,
            ContextProjection(
                actor=ActorContext(
                    user_id="student-001",
                    principal_id="principal-001",
                    roles=("student",),
                    departments=(),
                    groups=("students",),
                    campus_scope="north",
                    cohort="2023",
                    major="philosophy",
                    program="undergraduate",
                ),
                authorization=AuthorizationProjection(
                    principal_id="principal-001",
                    entitlement_snapshot_id="entitlements-2026-03-29",
                    entitlement_groups=("students",),
                    visibility_scope="north",
                    applicability_scope="undergraduate",
                    ownership_scopes=("conversation:student-001",),
                    approval_state="not_required",
                    retrieval_filter=AuthorizedRetrievalFilter(
                        acl_groups=("students",),
                        visibility_scope="north",
                        campus_scope="north",
                    ),
                ),
                profile_memory=ProfileMemorySummary(
                    items=(
                        ProfileMemoryItem(
                            item_id="memory-001",
                            key="recent_goal",
                            value="咨询保研",
                            source_type="user_declared",
                            confidence="high",
                            visibility="user_visible",
                            last_verified_at="2026-03-28",
                        ),
                    ),
                ),
                session=SessionSummary(
                    confirmed_slots=(SessionSlot(name="policy_topic", value="推免资格", confirmed=True),),
                    turn_count=4,
                ),
            ),
        )

    def test_build_context_projection_defaults_authorization_from_verified_identity(self) -> None:
        projection = build_context_projection(
            identity=VerifiedIdentityInput(
                user_id="student-001",
                principal_id="principal-001",
                groups=("students",),
                campus_scope="north",
            ),
        )

        self.assertEqual(
            projection.authorization,
            AuthorizationProjection(
                principal_id="principal-001",
                entitlement_snapshot_id="",
                entitlement_groups=("students",),
                visibility_scope="north",
                applicability_scope=None,
                ownership_scopes=(),
                approval_state="",
                retrieval_filter=AuthorizedRetrievalFilter(
                    acl_groups=("students",),
                    visibility_scope="north",
                    campus_scope="north",
                ),
            ),
        )

    def test_build_context_projection_filters_unconfirmed_or_blank_session_slots(self) -> None:
        projection = build_context_projection(
            identity=VerifiedIdentityInput(user_id="student-001", principal_id="principal-001"),
            session_slots=(
                SessionSlotRecord(name="policy_topic", value="  ", confirmed=True),
                SessionSlotRecord(name="ignored_topic", value="无效", confirmed=False),
                SessionSlotRecord(name="resolved_topic", value="奖学金", confirmed=True),
            ),
            turn_count=2,
        )

        self.assertEqual(
            projection.session,
            SessionSummary(
                confirmed_slots=(SessionSlot(name="resolved_topic", value="奖学金", confirmed=True),),
                turn_count=2,
            ),
        )

    def test_build_context_projection_does_not_let_memory_or_session_rewrite_authorization(self) -> None:
        projection = build_context_projection(
            identity=VerifiedIdentityInput(
                user_id="student-001",
                principal_id="principal-001",
                groups=("students",),
                campus_scope="north",
            ),
            authorization=AuthorizationInput(
                principal_id="principal-001",
                entitlement_snapshot_id="entitlements-2026-03-29",
                entitlement_groups=("students",),
                visibility_scope="north",
                applicability_scope="undergraduate",
                ownership_scopes=("conversation:student-001",),
                approval_state="not_required",
                retrieval_filter=AuthorizedRetrievalFilterInput(
                    acl_groups=("students",),
                    visibility_scope="north",
                    campus_scope="north",
                ),
            ),
            profile_records=(
                ProfileMemoryRecord(
                    item_id="memory-001",
                    key="groups",
                    value="admins",
                    source_type="user_declared",
                    confidence="high",
                    visibility="user_visible",
                ),
            ),
            session_slots=(
                SessionSlotRecord(name="campus_scope", value="south", confirmed=True),
            ),
        )

        self.assertEqual(projection.authorization.entitlement_groups, ("students",))
        self.assertEqual(projection.authorization.retrieval_filter.campus_scope, "north")
        self.assertEqual(projection.authorization.retrieval_filter.visibility_scope, "north")
        self.assertEqual(projection.profile_memory.items[0].value, "admins")
        self.assertEqual(projection.session.confirmed_slots[0].value, "south")


if __name__ == "__main__":
    unittest.main()
