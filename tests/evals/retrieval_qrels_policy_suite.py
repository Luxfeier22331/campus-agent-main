from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.retrieval_qrels_policy import (
    NORMALIZED_QRELS_DENOMINATOR_CLASSES,
    default_query_enabled_retrieval_qrels_paths,
    load_retrieval_qrels_denominator_policy,
    validate_default_query_enabled_qrels_coverage,
    validate_retrieval_qrels_denominator_policy,
)


class RetrievalQrelsPolicyTest(unittest.TestCase):
    def test_default_policy_loads_query_enabled_fixture_paths_and_denominator_classes(
        self,
    ) -> None:
        policy = load_retrieval_qrels_denominator_policy()
        paths = default_query_enabled_retrieval_qrels_paths()

        self.assertEqual(
            set(policy.scopes),
            {
                "regulations/student_rules",
                "regulations/institutional_rules",
                "curriculum/curriculum_plan",
                "official_web/stable_reference",
            },
        )
        self.assertEqual(set(paths), set(policy.scopes))
        self.assertIn("exact_title_or_policy_name", NORMALIZED_QRELS_DENOMINATOR_CLASSES)
        self.assertIn("freshness_sensitive", NORMALIZED_QRELS_DENOMINATOR_CLASSES)
        for scope_key, scope_policy in policy.scopes.items():
            self.assertTrue(paths[scope_key].exists(), paths[scope_key])
            for scenario_id in scope_policy.required_scenarios:
                self.assertIn(scenario_id, scope_policy.scenario_denominator_classes)
                self.assertTrue(scope_policy.scenario_denominator_classes[scenario_id])

    def test_policy_validation_rejects_required_scenario_without_denominator_class(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            policy_path = Path(temp_dir) / "policy.json"
            policy_path.write_text(
                json.dumps(
                    {
                        "schema_version": "retrieval-qrels-denominator-policy-v1",
                        "normalized_denominator_classes": ["no_hit"],
                        "scopes": {
                            "regulations/student_rules": {
                                "fixture": "rag/student_rules/retrieval_qrels.json",
                                "min_case_count": 1,
                                "required_classes": ["no_hit"],
                                "required_scenarios": ["no_hit"],
                                "scenario_denominator_classes": {},
                            }
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_denominator_policy(policy_path)

        self.assertIn(
            "regulations/student_rules: required scenario no_hit has no denominator class mapping",
            issues,
        )

    def test_qrels_coverage_rejects_declared_scenario_without_denominator_class(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            fixture = root / "qrels.json"
            fixture.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "baseline": {},
                        "coverage_scenarios": {"no_hit": ["missing"]},
                        "cases": [
                            {
                                "case_id": "missing",
                                "split": "smoke",
                                "query": "校内宇宙签证办理处",
                                "expected_sources": [],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            policy_path = root / "policy.json"
            policy_path.write_text(
                json.dumps(
                    {
                        "schema_version": "retrieval-qrels-denominator-policy-v1",
                        "normalized_denominator_classes": ["no_hit"],
                        "scopes": {
                            "regulations/student_rules": {
                                "fixture": "qrels.json",
                                "min_case_count": 1,
                                "required_classes": ["no_hit"],
                                "required_scenarios": ["no_hit"],
                                "scenario_denominator_classes": {},
                            }
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_default_query_enabled_qrels_coverage(
                qrels_paths={"regulations/student_rules": fixture},
                policy_path=policy_path,
            )

        self.assertIn(
            "regulations/student_rules: qrels scenario no_hit has no denominator class mapping",
            issues,
        )

    def test_qrels_coverage_requires_empty_expected_sources_cases_in_no_hit_scenario(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            fixture = root / "qrels.json"
            fixture.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "baseline": {},
                        "coverage_scenarios": {"no_hit": ["declared-no-hit"]},
                        "cases": [
                            {
                                "case_id": "declared-no-hit",
                                "split": "smoke",
                                "query": "火星校区飞船停靠规则",
                                "expected_sources": [],
                            },
                            {
                                "case_id": "undeclared-no-hit",
                                "split": "smoke",
                                "query": "校内宇宙签证办理处",
                                "expected_sources": [],
                            },
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            policy_path = root / "policy.json"
            policy_path.write_text(
                json.dumps(
                    {
                        "schema_version": "retrieval-qrels-denominator-policy-v1",
                        "normalized_denominator_classes": ["no_hit"],
                        "scopes": {
                            "regulations/student_rules": {
                                "fixture": "qrels.json",
                                "min_case_count": 1,
                                "required_classes": ["no_hit"],
                                "required_scenarios": ["no_hit"],
                                "scenario_denominator_classes": {"no_hit": ["no_hit"]},
                            }
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_default_query_enabled_qrels_coverage(
                qrels_paths={"regulations/student_rules": fixture},
                policy_path=policy_path,
            )

        self.assertIn(
            "regulations/student_rules: empty-result qrels cases missing from empty-result scenarios: undeclared-no-hit",
            issues,
        )

    def test_qrels_coverage_allows_authz_denied_empty_expected_sources_cases(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            fixture = root / "qrels.json"
            fixture.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "institutional_rules",
                        "baseline": {},
                        "coverage_scenarios": {"authz_denied": ["restricted-deny"]},
                        "cases": [
                            {
                                "case_id": "restricted-deny",
                                "split": "smoke",
                                "query": "受限制度标题",
                                "expected_sources": [],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            policy_path = root / "policy.json"
            policy_path.write_text(
                json.dumps(
                    {
                        "schema_version": "retrieval-qrels-denominator-policy-v1",
                        "normalized_denominator_classes": ["authz_filtered"],
                        "scopes": {
                            "regulations/institutional_rules": {
                                "fixture": "qrels.json",
                                "min_case_count": 1,
                                "required_classes": ["no_hit"],
                                "required_scenarios": ["authz_denied"],
                                "scenario_denominator_classes": {
                                    "authz_denied": ["authz_filtered"]
                                },
                            }
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_default_query_enabled_qrels_coverage(
                qrels_paths={"regulations/institutional_rules": fixture},
                policy_path=policy_path,
            )

        self.assertNotIn(
            "regulations/institutional_rules: empty-result qrels cases missing from empty-result scenarios: restricted-deny",
            issues,
        )


if __name__ == "__main__":
    unittest.main()
