from __future__ import annotations

import unittest


class EvalCaseGovernanceTest(unittest.TestCase):
    def test_case_lifecycle_statuses_are_repo_owned_and_closed(self) -> None:
        from campus_evals import case_governance

        self.assertEqual(
            case_governance.CASE_LIFECYCLE_STATUSES,
            (
                "candidate",
                "pending_review",
                "accepted_smoke",
                "accepted_regression_locked",
                "accepted_release_gate",
                "exploratory",
                "rejected",
                "duplicate",
                "needs_info",
                "retired",
            ),
        )
        self.assertEqual(
            case_governance.review_decision_for_lifecycle("accepted_release_gate"),
            "accept",
        )
        with self.assertRaisesRegex(ValueError, "unsupported case lifecycle status"):
            case_governance.review_decision_for_lifecycle("accepted_shadow_gate")

    def test_denominator_registry_scaffold_covers_current_admitted_surfaces(self) -> None:
        from campus_evals.case_governance import load_denominator_registry

        registry = load_denominator_registry()
        surface_ids = {entry.surface_id for entry in registry.entries}

        self.assertTrue(
            {
                "student_rules",
                "curriculum_plan",
                "official_web/stable_reference",
                "official_web/fresh_news",
                "service_status_lookup",
                "transport_schedule_lookup",
                "service_guide_lookup",
                "contact_directory_lookup",
                "public_chat_feedback/operator_quality_intake",
            }.issubset(surface_ids)
        )
        for entry in registry.entries:
            self.assertTrue(entry.eval_families)
            self.assertEqual(entry.truth_scope, "denominator_expectation")
            self.assertFalse(entry.authors_domain_truth)

    def test_denominator_registry_rejects_domain_truth_payload(self) -> None:
        from campus_evals.case_governance import validate_denominator_registry

        with self.assertRaisesRegex(ValueError, "must not author domain truth"):
            validate_denominator_registry(
                {
                    "schema_version": 1,
                    "registry_id": "bad",
                    "updated_at": "2026-04-29",
                    "entries": [
                        {
                            "surface_id": "student_rules",
                            "domain_owner": "regulations/student_rules",
                            "capability_family": "rag-agent",
                            "admission_state": "admitted",
                            "truth_scope": "denominator_expectation",
                            "authors_domain_truth": False,
                            "eval_families": ["release_gate"],
                            "accepted_cases": ["case-1"],
                        }
                    ],
                }
            )


if __name__ == "__main__":
    unittest.main()
