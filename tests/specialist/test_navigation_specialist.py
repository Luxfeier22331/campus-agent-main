from __future__ import annotations

import unittest

from campus_contracts import PlaceLookupPayload, SpecialistRequest
from campus_navigation_agent.service import delegate_to_navigation_agent


class NavigationAgentTest(unittest.TestCase):
    def test_campus_qualified_place_lookup_returns_completed_place_card(self) -> None:
        response = delegate_to_navigation_agent(
            SpecialistRequest(
                target="navigation-agent",
                user_goal="海淀图书馆在哪里",
                payload=PlaceLookupPayload(query_text="海淀图书馆在哪里"),
            )
        )

        self.assertEqual(response.target, "navigation-agent")
        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.resolved_place.place_id, "muc.haidian.library")
        self.assertEqual(response.result.place_card.place.display_name, "图书馆")
        self.assertIn("图书馆", response.answer_text)

    def test_ambiguous_library_alias_returns_clarification_candidates(self) -> None:
        response = delegate_to_navigation_agent(
            SpecialistRequest(
                target="navigation-agent",
                user_goal="图书馆在哪里",
                payload=PlaceLookupPayload(query_text="图书馆在哪里"),
            )
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertEqual(len(response.result.candidate_places), 2)
        self.assertIn("海淀校区", response.follow_up_question)
        self.assertIn("丰台校区", response.follow_up_question)

    def test_ambiguous_alias_returns_clarification_candidates(self) -> None:
        response = delegate_to_navigation_agent(
            SpecialistRequest(
                target="navigation-agent",
                user_goal="南门在哪里",
                payload=PlaceLookupPayload(query_text="南门在哪里"),
            )
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertEqual(len(response.result.candidate_places), 2)
        self.assertIn("南门", response.follow_up_question)

    def test_official_map_backed_place_can_complete_without_point_geometry(self) -> None:
        response = delegate_to_navigation_agent(
            SpecialistRequest(
                target="navigation-agent",
                user_goal="民族博物馆在哪里",
                payload=PlaceLookupPayload(query_text="民族博物馆在哪里"),
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.resolved_place.place_id, "muc.haidian.museum")
        self.assertIsNone(response.result.place_card.point_geometry)
        self.assertIn("民族博物馆", response.answer_text)

    def test_unknown_place_returns_no_answer(self) -> None:
        response = delegate_to_navigation_agent(
            SpecialistRequest(
                target="navigation-agent",
                user_goal="量子楼在哪里",
                payload=PlaceLookupPayload(query_text="量子楼在哪里"),
            )
        )

        self.assertEqual(response.status, "no_answer")
        self.assertIsNone(response.result.resolved_place)
        self.assertIsNone(response.result.place_card)


if __name__ == "__main__":
    unittest.main()
