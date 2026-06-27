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

        definition = get_profile_definition("tool-runtime-contract")
        self.assertEqual(definition.profile_id, "tool-runtime-contract")
        self.assertEqual(definition.artifact_kind, "composite_gate")

    def test_registry_declares_dispatchable_profiles_without_deprecated_aliases(self) -> None:
        profile_ids = dispatchable_profile_ids()

        self.assertIn("tool-runtime-contract", profile_ids)
        self.assertIn("tool-routing-product-path", profile_ids)
        self.assertIn("online-answer-path", profile_ids)
        self.assertIn("answer-quality-contract", profile_ids)
        self.assertIn("hindsight-memory-product-path", profile_ids)
        self.assertNotIn("personal-memory-extraction", profile_ids)
        self.assertNotIn("multi-agent-product-path", profile_ids)
        self.assertEqual(len(profile_ids), len(set(profile_ids)))

    def test_online_answer_path_profile_is_canonical_runtime_profile(self) -> None:
        definition = get_profile_definition("online-answer-path")

        self.assertEqual(definition.profile_id, "online-answer-path")
        self.assertTrue(definition.supports_collect_runtime)
        self.assertTrue(definition.supports_profile_publish)
        self.assertEqual(definition.operations_profile_id, "online_answer_path")

    def test_old_python_live_eval_profiles_are_removed_from_active_registry(self) -> None:
        removed_profile_ids = (
            "handbook",
            "curriculum",
            "official-web-stable-reference",
            "service-guide-lookup",
            "contact-directory-lookup",
            "institutional-rules-release-baseline",
        )

        for profile_id in removed_profile_ids:
            with self.subTest(profile_id=profile_id):
                self.assertNotIn(profile_id, accepted_profile_ids())
                self.assertNotIn(profile_id, dispatchable_profile_ids())
                with self.assertRaisesRegex(ValueError, "unsupported eval profile"):
                    get_profile_definition(profile_id)

    def test_registry_rejects_retired_personal_memory_extraction_profile(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported eval profile"):
            resolve_profile_id("personal-memory-extraction")

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

        check_ids = {check["check_id"] for check in report["checks"]}
        self.assertTrue(
            {
                "profile_registry_runners",
                "workflow_dispatch_choices",
                "workflow_contract_generation_check",
                "operations_policy_coverage",
                "denominator_registry_coverage",
                "rag_eval_coverage",
                "rag_retrieval_quality_gate",
                "tool_denominator_fixture_coverage",
                "profile_fixture_smoke",
            }.issubset(check_ids)
        )
        rag_check = next(
            check for check in report["checks"] if check["check_id"] == "rag_eval_coverage"
        )
        self.assertTrue(rag_check["passed"])
        self.assertTrue(rag_check["maturity_passed"])
        self.assertEqual(rag_check["maturity_gaps"], [])
        retrieval_quality_check = next(
            check for check in report["checks"] if check["check_id"] == "rag_retrieval_quality_gate"
        )
        self.assertIn("passed", retrieval_quality_check)


if __name__ == "__main__":
    unittest.main()
