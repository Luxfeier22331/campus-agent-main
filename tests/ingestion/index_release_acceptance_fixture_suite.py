from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.index_release_acceptance import (
    load_release_retrieval_acceptance_cases,
)
from campus_ingestion_core.registry_scope_release_support import (
    _validate_default_qrels_coverage_for_scope,
)

from tests.ingestion.index_release_acceptance_test_support import (
    _INSTITUTIONAL_RULES_RELEASE_ACCEPTANCE_PATH,
    _INSTITUTIONAL_RULES_RETRIEVAL_EVAL_MANIFEST_PATH,
    _QUERY_ENABLED_RELEASE_ACCEPTANCE_FIXTURES,
    _REPO_ROOT,
    _STUDENT_RULES_RELEASE_ACCEPTANCE_PATH,
)


class IndexReleaseAcceptanceFixtureSuite:
    def test_default_qrels_coverage_uses_denominator_policy_fixture(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            qrels_path = root / "qrels.json"
            qrels_path.write_text(
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
                                "fixture": str(qrels_path),
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

            with patch(
                "campus_ingestion_core.registry_scope_release_support._default_qrels_denominator_policy_path",
                return_value=policy_path,
            ):
                issues = _validate_default_qrels_coverage_for_scope(
                    corpus="regulations",
                    collection="student_rules",
                )

        self.assertIn(
            "regulations/student_rules: qrels scenario no_hit has no denominator class mapping",
            issues,
        )

    def test_student_rules_release_acceptance_fixture_loads_for_alias_publish(self) -> None:
        cases = load_release_retrieval_acceptance_cases(
            _STUDENT_RULES_RELEASE_ACCEPTANCE_PATH,
            corpus="regulations",
            collection="student_rules",
        )

        self.assertGreaterEqual(len(cases), 15)
        case_by_id = {case.case_id: case for case in cases}
        self.assertEqual(
            case_by_id["policy-title-medical"].expected_document_ids,
            ("handbook:b85de1cb327a26dc63488e247403ae3126d524be",),
        )
        self.assertEqual(
            case_by_id["policy-title-medical"].expected_version_ids,
            (),
        )
        self.assertEqual(
            case_by_id["policy-title-national-scholarship-article-nine"].query,
            "中央民族大学本科学生国家奖学金评审办法 第九条",
        )
        self.assertEqual(
            case_by_id["policy-title-national-scholarship-article-nine"].expected_document_ids,
            ("handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",),
        )
        self.assertEqual(
            case_by_id["policy-title-national-encouragement-scholarship"].forbidden_document_ids,
            ("handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",),
        )
        self.assertEqual(
            case_by_id["semantic-degree-application"].expected_document_ids,
            ("handbook:742d4831bfb443b99323041e263fac2fd9aafcf6",),
        )
        self.assertEqual(
            case_by_id["semantic-scholarship-eligibility"].expected_document_ids,
            (
                "handbook:a531a3c85de862c737d0576e957bf59598822c54",
                "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
            ),
        )
        self.assertEqual(
            case_by_id["short-fact-attendance-discipline-threshold"].expected_document_ids,
            ("handbook:9350d885657d7409e524e73666b828b826f07191",),
        )
        self.assertEqual(
            case_by_id["short-fact-attendance-discipline-threshold"].expected_condition_subjects,
            ("attendance_absence_threshold",),
        )
        self.assertTrue(case_by_id["no-hit-impossible-query"].expected_no_hit)

    def test_default_query_enabled_release_acceptance_fixtures_load(self) -> None:
        for corpus, collection, fixture_name in _QUERY_ENABLED_RELEASE_ACCEPTANCE_FIXTURES:
            with self.subTest(scope=f"{corpus}/{collection}"):
                cases = load_release_retrieval_acceptance_cases(
                    _REPO_ROOT / "packages/evals/fixtures" / fixture_name,
                    corpus=corpus,
                    collection=collection,
                )

                self.assertGreaterEqual(len(cases), 5)
                self.assertTrue(any(case.expected_no_hit for case in cases), fixture_name)
                self.assertTrue(any(case.expected_document_ids for case in cases), fixture_name)

    def test_curriculum_social_practice_release_case_uses_campus_member_authorization(
        self,
    ) -> None:
        cases = load_release_retrieval_acceptance_cases(
            _REPO_ROOT / "packages/evals/fixtures/curriculum_plan_release_acceptance.v1.json",
            corpus="curriculum",
            collection="curriculum_plan",
        )
        case_by_id = {case.case_id: case for case in cases}

        social_practice_case = case_by_id["curriculum-title-social-practice"]

        self.assertEqual(
            social_practice_case.expected_document_ids,
            ("curriculum:中央民族大学大学生社会实践环节实施方案",),
        )
        self.assertEqual(social_practice_case.entitlement_groups, ("campus_members",))
        self.assertEqual(social_practice_case.visibility_level, "restricted")

    def test_institutional_rules_release_acceptance_covers_consumption_manifest_titles(
        self,
    ) -> None:
        cases = load_release_retrieval_acceptance_cases(
            _INSTITUTIONAL_RULES_RELEASE_ACCEPTANCE_PATH,
            corpus="regulations",
            collection="institutional_rules",
        )
        manifest = json.loads(
            _INSTITUTIONAL_RULES_RETRIEVAL_EVAL_MANIFEST_PATH.read_text(encoding="utf-8")
        )
        released_docs = tuple(manifest["documents"])
        title_cases = {
            case.query: case
            for case in cases
            if case.expected_document_ids and case.case_id.startswith("institutional-title-exact-")
        }

        self.assertEqual(len(released_docs), 42)
        self.assertEqual(set(title_cases), {item["title"] for item in released_docs})
        for item in released_docs:
            case = title_cases[item["title"]]
            self.assertEqual(case.expected_document_ids, (item["document_id"],))
            self.assertEqual(case.expected_version_ids, (item["version_id"],))
            self.assertEqual(case.entitlement_groups, ("campus_members",))
            self.assertEqual(case.visibility_level, "restricted")
            self.assertEqual(case.visibility_scope, "campus")

    def test_load_release_retrieval_acceptance_cases_rejects_empty_case_file(self) -> None:
        with TemporaryDirectory() as temp_dir:
            case_path = Path(temp_dir) / "cases.json"
            case_path.write_text(json.dumps({"cases": []}), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "must contain at least one acceptance case"):
                load_release_retrieval_acceptance_cases(
                    case_path,
                    corpus="regulations",
                    collection="student_rules",
                )
