from __future__ import annotations

import unittest
from pathlib import Path

from campus_evals.profile_registry import (
    accepted_profile_ids,
    dispatchable_profile_ids,
    get_profile_definition,
    iter_profile_definitions,
    operations_policy_profile_ids,
    resolve_profile_id,
)

from scripts.eval_gate import audit_eval_gate_configuration


class ProfileRegistryAndAuditSuite(unittest.TestCase):
    def test_registry_rejects_removed_deprecated_alias(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported eval profile"):
            resolve_profile_id("multi-agent-product-path")

        definition = get_profile_definition("multi-agent-runtime-contract")
        self.assertEqual(definition.profile_id, "multi-agent-runtime-contract")
        self.assertEqual(definition.artifact_kind, "composite_gate")

    def test_registry_declares_dispatchable_profiles_without_deprecated_aliases(self) -> None:
        profile_ids = dispatchable_profile_ids()

        self.assertIn("multi-agent-runtime-contract", profile_ids)
        self.assertIn("tool-routing-product-path", profile_ids)
        self.assertIn("public-chat-entry-e2e", profile_ids)
        self.assertIn("answer-quality-contract", profile_ids)
        self.assertNotIn("multi-agent-product-path", profile_ids)
        self.assertEqual(len(profile_ids), len(set(profile_ids)))

    def test_official_web_fresh_news_is_not_eval_gate_profile(self) -> None:
        self.assertNotIn("official-web-fresh-news", accepted_profile_ids())
        self.assertNotIn("official-web-fresh-news", dispatchable_profile_ids())
        self.assertNotIn("official_web_fresh_news", operations_policy_profile_ids())
        with self.assertRaisesRegex(ValueError, "unsupported eval profile"):
            get_profile_definition("official-web-fresh-news")

    def test_profile_registry_contains_no_duplicate_runner_profiles(self) -> None:
        definitions = tuple(iter_profile_definitions())

        self.assertEqual(
            len({definition.profile_id for definition in definitions}),
            len(definitions),
        )

    def test_eval_gate_audit_checks_registry_workflow_policy_and_fixtures(self) -> None:
        report = audit_eval_gate_configuration(repo_root=Path.cwd())

        self.assertTrue(report["passed"], report)
        check_ids = {check["check_id"] for check in report["checks"]}
        self.assertTrue(
            {
                "profile_registry_runners",
                "workflow_dispatch_choices",
                "workflow_contract_generation_check",
                "operations_policy_coverage",
                "denominator_registry_coverage",
                "rag_eval_coverage",
                "tool_family_fixture_coverage",
                "profile_fixture_smoke",
            }.issubset(check_ids)
        )
        rag_check = next(
            check for check in report["checks"] if check["check_id"] == "rag_eval_coverage"
        )
        self.assertTrue(rag_check["passed"])
        self.assertTrue(rag_check["maturity_passed"])
        self.assertEqual(rag_check["maturity_gaps"], [])


if __name__ == "__main__":
    unittest.main()
