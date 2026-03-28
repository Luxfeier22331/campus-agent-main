from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    ContextProjection,
    ProfileMemoryItem,
    ProfileMemorySummary,
    SessionSlot,
    SessionSummary,
)
from campus_app_api import (
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


if __name__ == "__main__":
    unittest.main()
