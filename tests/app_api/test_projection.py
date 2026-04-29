from __future__ import annotations

import unittest

from campus_app_api import (
    AuthorizationInput,
    AuthorizedRetrievalFilterInput,
    ProfileMemoryRecord,
    SessionSlotRecord,
    VerifiedIdentityInput,
    build_context_projection,
)
from campus_contracts import (
    CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
    CURRICULUM_PROGRAM_SLOT_NAME,
    CURRICULUM_SEMESTER_SLOT_NAME,
    ActorContext,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
    ContextProjection,
    CurriculumFollowUpSlots,
    ProfileMemoryItem,
    ProfileMemorySummary,
    SessionSlot,
    SessionSummary,
)


class AppApiProjectionTest(unittest.TestCase):
    def test_build_context_projection_maps_verified_identity_profile_and_session_layers(
        self,
    ) -> None:
        projection = build_context_projection(
            identity=VerifiedIdentityInput(
                user_id="student-001",
                principal_id="principal-001",
                principal_type="student",
                roles=("student",),
                cohort="2023",
                major="philosophy",
                program="undergraduate",
            ),
            authorization=AuthorizationInput(
                principal_id="principal-001",
                projection_source="campus_identity",
                entitlement_snapshot_id="entitlements-2026-03-29",
                entitlement_groups=("students",),
                visibility_scope="north",
                applicability_scope="undergraduate",
                ownership_scopes=("conversation:student-001",),
                approval_state="not_required",
                retrieval_filter=AuthorizedRetrievalFilterInput(
                    entitlement_groups=("students",),
                    visibility_level="public",
                    visibility_scope="north",
                    policy_projection_version="phase1-authorization-projection-v1",
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
                    principal_type="student",
                    roles=("student",),
                    departments=(),
                    cohort="2023",
                    major="philosophy",
                    program="undergraduate",
                ),
                authorization=AuthorizationProjection(
                    principal_id="principal-001",
                    projection_source="campus_identity",
                    entitlement_snapshot_id="entitlements-2026-03-29",
                    entitlement_groups=("students",),
                    visibility_scope="north",
                    applicability_scope="undergraduate",
                    ownership_scopes=("conversation:student-001",),
                    approval_state="not_required",
                    retrieval_filter=AuthorizedRetrievalFilter(
                        entitlement_groups=("students",),
                        visibility_level="public",
                        visibility_scope="north",
                        policy_projection_version="phase1-authorization-projection-v1",
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
                    confirmed_slots=(
                        SessionSlot(name="policy_topic", value="推免资格", confirmed=True),
                    ),
                    turn_count=4,
                ),
            ),
        )

    def test_build_context_projection_defaults_authorization_from_verified_identity(self) -> None:
        projection = build_context_projection(
            identity=VerifiedIdentityInput(
                user_id="student-001",
                principal_id="principal-001",
                principal_type="student",
            ),
        )

        self.assertEqual(
            projection.actor,
            ActorContext(
                user_id="student-001",
                principal_id="principal-001",
                principal_type="student",
                roles=(),
                departments=(),
                cohort=None,
                major=None,
                program=None,
            ),
        )
        self.assertEqual(
            projection.authorization,
            AuthorizationProjection(
                principal_id="principal-001",
                projection_source="campus_identity",
                entitlement_snapshot_id="",
                entitlement_groups=(),
                visibility_scope=None,
                applicability_scope=None,
                ownership_scopes=(),
                approval_state="",
                retrieval_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=(),
                    visibility_level="public",
                    visibility_scope=None,
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            ),
        )

    def test_build_context_projection_keeps_verified_identity_separate_from_explicit_authorization_input(
        self,
    ) -> None:
        projection = build_context_projection(
            identity=VerifiedIdentityInput(
                user_id="student-001",
                principal_id="principal-001",
                principal_type="student",
                roles=("campus_member", "student"),
                departments=("philosophy",),
                cohort="2023",
                major="philosophy",
                program="undergraduate",
            ),
            authorization=AuthorizationInput(
                principal_id="principal-001",
                projection_source="campus_identity",
                entitlement_snapshot_id="entitlements-2026-04-02",
                entitlement_groups=("campus_members", "students"),
                visibility_scope="north",
                applicability_scope="undergraduate",
                ownership_scopes=("conversation:student-001",),
                approval_state="not_required",
                retrieval_filter=AuthorizedRetrievalFilterInput(
                    entitlement_groups=("campus_members", "students"),
                    visibility_scope="north",
                ),
            ),
        )

        self.assertEqual(
            projection.authorization,
            AuthorizationProjection(
                principal_id="principal-001",
                projection_source="campus_identity",
                entitlement_snapshot_id="entitlements-2026-04-02",
                entitlement_groups=("campus_members", "students"),
                visibility_scope="north",
                applicability_scope="undergraduate",
                ownership_scopes=("conversation:student-001",),
                approval_state="not_required",
                retrieval_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=("campus_members", "students"),
                    visibility_level="public",
                    visibility_scope="north",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            ),
        )
        self.assertEqual(
            projection.actor,
            ActorContext(
                user_id="student-001",
                principal_id="principal-001",
                principal_type="student",
                roles=("campus_member", "student"),
                departments=("philosophy",),
                cohort="2023",
                major="philosophy",
                program="undergraduate",
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
                confirmed_slots=(
                    SessionSlot(name="resolved_topic", value="奖学金", confirmed=True),
                ),
                turn_count=2,
            ),
        )

    def test_build_context_projection_preserves_curriculum_follow_up_slot_contract(self) -> None:
        projection = build_context_projection(
            identity=VerifiedIdentityInput(user_id="student-001", principal_id="principal-001"),
            session_slots=(
                SessionSlotRecord(
                    name=CURRICULUM_PROGRAM_FAMILY_SLOT_NAME, value="民族实验班", confirmed=True
                ),
                SessionSlotRecord(
                    name=CURRICULUM_PROGRAM_SLOT_NAME, value="法学民族实验班", confirmed=True
                ),
                SessionSlotRecord(
                    name=CURRICULUM_SEMESTER_SLOT_NAME, value="第四学期", confirmed=True
                ),
            ),
            turn_count=5,
        )

        self.assertEqual(
            projection.session.curriculum_follow_up,
            CurriculumFollowUpSlots(
                program_family="民族实验班",
                program="法学民族实验班",
                semester="第四学期",
            ),
        )

    def test_build_context_projection_does_not_let_memory_or_session_rewrite_authorization(
        self,
    ) -> None:
        projection = build_context_projection(
            identity=VerifiedIdentityInput(
                user_id="student-001",
                principal_id="principal-001",
                principal_type="student",
            ),
            authorization=AuthorizationInput(
                principal_id="principal-001",
                projection_source="campus_identity",
                entitlement_snapshot_id="entitlements-2026-03-29",
                entitlement_groups=("students",),
                visibility_scope="north",
                applicability_scope="undergraduate",
                ownership_scopes=("conversation:student-001",),
                approval_state="not_required",
                retrieval_filter=AuthorizedRetrievalFilterInput(
                    entitlement_groups=("students",),
                    visibility_level="public",
                    visibility_scope="north",
                    policy_projection_version="phase1-authorization-projection-v1",
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
            session_slots=(SessionSlotRecord(name="campus_scope", value="south", confirmed=True),),
        )

        self.assertEqual(projection.authorization.entitlement_groups, ("students",))
        self.assertEqual(projection.authorization.projection_source, "campus_identity")
        self.assertEqual(
            projection.authorization.retrieval_filter.entitlement_groups,
            ("students",),
        )
        self.assertEqual(projection.authorization.retrieval_filter.visibility_level, "public")
        self.assertEqual(projection.authorization.retrieval_filter.visibility_scope, "north")
        self.assertEqual(projection.profile_memory.items[0].value, "admins")
        self.assertEqual(projection.session.confirmed_slots[0].value, "south")

    def test_verified_identity_input_rejects_legacy_acl_carrier_fields(self) -> None:
        with self.assertRaises(TypeError):
            VerifiedIdentityInput(user_id="student-001", groups=("students",))

        with self.assertRaises(TypeError):
            VerifiedIdentityInput(user_id="student-001", campus_scope="north")

    def test_build_context_projection_does_not_backfill_custom_retrieval_filter_fields(
        self,
    ) -> None:
        projection = build_context_projection(
            identity=VerifiedIdentityInput(
                user_id="student-001",
                principal_id="principal-001",
            ),
            authorization=AuthorizationInput(
                principal_id="principal-001",
                retrieval_filter=AuthorizedRetrievalFilterInput(
                    entitlement_groups=("students",),
                    visibility_scope="north",
                ),
            ),
        )

        self.assertEqual(
            projection.authorization.retrieval_filter,
            AuthorizedRetrievalFilter(
                entitlement_groups=("students",),
                visibility_level="public",
                visibility_scope="north",
                policy_projection_version="phase1-authorization-projection-v1",
            ),
        )


if __name__ == "__main__":
    unittest.main()
