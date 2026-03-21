import unittest

from campus_agent.context import ContextAssembler
from campus_agent.state import WorkflowActorContext


class _FakeStore:
    def __init__(self) -> None:
        self.last_limit: int | None = None

    def get_user_profile(self, user_id: str):
        return {
            "primary_affiliation": "undergraduate_student",
            "org_units": ["计算机学院"],
            "academic_stage": "senior",
            "source": "sis",
            "confidence": "authoritative",
        }

    def get_user_preferences(self, user_id: str):
        return {"language": "zh-CN", "response_style": "concise"}

    def select_memories(self, user_id: str, *, query: str, limit: int):
        self.last_limit = limit
        return [
            {
                "memory_id": "m-major-best",
                "fact_type": "major",
                "value": "计算机科学与技术",
                "source": "sis",
                "confidence": "authoritative",
            },
            {
                "memory_id": "m-duplicate-major",
                "fact_type": "major",
                "value": "计算机科学与技术",
                "source": "sis",
                "confidence": "high",
            },
            {
                "memory_id": "m-grade",
                "fact_type": "grade",
                "value": "大四",
                "source": "sis",
                "confidence": "high",
            },
            {
                "memory_id": "m-org",
                "fact_type": "org_unit",
                "value": "计算机学院",
                "source": "hr",
                "confidence": "high",
            },
            {
                "memory_id": "m-low",
                "fact_type": "major",
                "value": "软件工程",
                "source": "sis",
                "confidence": "low",
            },
            {
                "memory_id": "m-expired",
                "fact_type": "program",
                "value": "拔尖班",
                "source": "sis",
                "confidence": "authoritative",
                "expires_at": "2000-01-01T00:00:00+00:00",
            },
            {
                "memory_id": "m-no-source",
                "fact_type": "org_unit",
                "value": "网络中心",
                "confidence": "high",
            },
            {
                "memory_id": "m-non-whitelist",
                "fact_type": "favorite_food",
                "value": "米饭",
                "source": "profile",
                "confidence": "high",
            },
            {
                "memory_id": "m-role",
                "fact_type": "employment_role",
                "value": "网络中心教职工",
                "source": "hr",
                "confidence": "medium",
            },
        ]

    def get_conversation_context(self, conversation_id: str):
        return {"summary": "用户上一轮问过毕业审核。"}


class ContextAssemblerTest(unittest.TestCase):
    def test_assemble_prefers_store_filters_memories_and_keeps_summary_out_of_request_context(self) -> None:
        store = _FakeStore()
        assembler = ContextAssembler(store=store)

        context = assembler.assemble(
            conversation_id="conv-001",
            user_query="计算机科学与技术专业大四毕业要求有哪些？",
            actor_context=WorkflowActorContext(
                user_id="user-1",
                snapshot={
                    "profile": {"primary_affiliation": "teacher"},
                    "preferences": {"language": "en"},
                    "selected_memories": [{"memory_id": "snapshot-memory"}],
                    "conversation_summary": "snapshot summary",
                },
            ),
        )

        self.assertEqual(store.last_limit, 10)
        self.assertEqual(context.profile["primary_affiliation"], "undergraduate_student")
        self.assertEqual(context.preferences["response_style"], "concise")
        self.assertEqual(context.conversation_summary, "用户上一轮问过毕业审核。")
        self.assertEqual(
            [item["memory_id"] for item in context.selected_memories],
            ["m-major-best", "m-grade", "m-org"],
        )

        request_context = context.to_request_context()
        self.assertNotIn("conversation_summary", request_context)
        self.assertEqual(
            [item["fact_type"] for item in request_context["memory_facts"]],
            ["major", "grade", "org_unit"],
        )


if __name__ == "__main__":
    unittest.main()
