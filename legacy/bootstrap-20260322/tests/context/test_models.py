import unittest


from campus_agent.context.models import PreConversationContext


class PreConversationContextTest(unittest.TestCase):
    def test_round_trip_preserves_context_fields(self) -> None:
        context = PreConversationContext(
            actor_snapshot={
                "actor_user_id": "user-123",
                "actor_roles": ["student"],
                "is_authenticated": True,
            },
            profile={
                "primary_affiliation": "undergraduate_student",
                "org_units": ["计算机学院"],
                "academic_stage": "senior",
                "source": "sis",
                "confidence": "authoritative",
            },
            preferences={
                "language": "zh-CN",
                "response_style": "concise",
            },
            conversation_summary="用户上一轮在问毕业要求。",
            selected_memories=[
                {
                    "memory_id": "memory-1",
                    "memory_kind": "profile_fact",
                    "summary": "用户是计算机学院本科生。",
                    "fact_type": "major",
                    "value": "计算机科学与技术",
                    "source": "sis",
                    "confidence": "authoritative",
                }
            ],
        )

        payload = context.to_dict()
        restored = PreConversationContext.from_dict(payload)

        self.assertEqual(restored.profile["primary_affiliation"], "undergraduate_student")
        self.assertEqual(restored.preferences["response_style"], "concise")
        self.assertEqual(restored.selected_memories[0]["memory_id"], "memory-1")

    def test_to_request_context_returns_minimal_rag_subset(self) -> None:
        context = PreConversationContext(
            actor_snapshot={"actor_user_id": "user-123", "is_authenticated": True},
            profile={
                "primary_affiliation": "undergraduate_student",
                "org_units": ["计算机学院"],
                "academic_stage": "senior",
                "source": "sis",
                "confidence": "authoritative",
                "profile_version": "v2",
            },
            preferences={
                "language": "zh-CN",
                "response_style": "concise",
            },
            selected_memories=[
                {
                    "memory_id": "memory-1",
                    "memory_kind": "profile_fact",
                    "summary": "用户是计算机学院本科生。",
                    "fact_type": "major",
                    "value": "计算机科学与技术",
                    "source": "sis",
                    "confidence": "authoritative",
                    "expires_at": "2026-08-31T23:59:59+08:00",
                }
            ],
        )

        request_context = context.to_request_context()

        self.assertEqual(
            request_context["audience_profile"]["primary_affiliation"],
            "undergraduate_student",
        )
        self.assertEqual(
            request_context["presentation_preferences"]["response_style"],
            "concise",
        )
        self.assertEqual(request_context["memory_facts"][0]["fact_type"], "major")
        self.assertNotIn("profile_version", request_context["audience_profile"])
        self.assertNotIn("memory_id", request_context["memory_facts"][0])
        self.assertNotIn("memory_kind", request_context["memory_facts"][0])
        self.assertNotIn("summary", request_context["memory_facts"][0])

    def test_to_context_refs_reports_memory_summary_without_raw_values(self) -> None:
        context = PreConversationContext(
            actor_snapshot={},
            profile={
                "source": "sis",
                "profile_version": "v2",
            },
            preferences={
                "language": "zh-CN",
                "response_style": "concise",
            },
            selected_memories=[
                {
                    "memory_id": "memory-1",
                    "fact_type": "major",
                    "value": "计算机科学与技术",
                },
                {
                    "memory_id": "memory-2",
                    "fact_type": "grade",
                    "value": "大四",
                },
            ],
        )

        refs = context.to_context_refs()

        self.assertEqual(refs["profile_source"], "sis")
        self.assertEqual(refs["profile_version"], "v2")
        self.assertEqual(refs["selected_memory_ids"], ["memory-1", "memory-2"])
        self.assertEqual(refs["selected_memory_fact_types"], ["grade", "major"])
        self.assertEqual(refs["selected_memory_count"], 2)
        self.assertEqual(refs["preference_keys"], ["language", "response_style"])
        self.assertNotIn("计算机科学与技术", str(refs))


if __name__ == "__main__":
    unittest.main()
