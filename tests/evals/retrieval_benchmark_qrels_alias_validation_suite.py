from __future__ import annotations

from tests.evals.retrieval_benchmark_test_support import (
    CURRICULUM_MANIFEST_PATH,
    Path,
    TemporaryDirectory,
    json,
    unittest,
    validate_retrieval_qrels_fixture,
)


class RetrievalQrelsAliasValidationTest(unittest.TestCase):
    def test_validate_retrieval_qrels_fixture_flags_ambiguous_title_fragment_truth(self) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "ambiguous-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "fixed-phrase-ethnic-experimental-class",
                                "split": "smoke",
                                "query": "民族实验班",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:法学（民族实验班）本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("fixed-phrase-ethnic-experimental-class", issues[0])
        self.assertIn("ambiguously matches", issues[0])
        self.assertIn("needs_clarification", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_course_family_alias_collapsed_to_single_course(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "course-family-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "course-family-alias-collapsed",
                                "split": "smoke",
                                "query": "思政课有哪些专业要上",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:中央民族大学通识课程思想政治理论课教学计划",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "思政课 family alias should not collapse to a single-course qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("course-family-alias-collapsed", issues[0])
        self.assertIn("canonical qrels must not lock this", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_course_family_alias_variant_collapsed_to_single_course(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "course-family-variant-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "course-family-alias-variant-collapsed",
                                "split": "smoke",
                                "query": "思政课程包括哪些课",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:中央民族大学通识课程思想政治理论课教学计划",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "course-family alias variants should not collapse to a single-course qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("course-family-alias-variant-collapsed", issues[0])
        self.assertIn("canonical qrels must not lock this", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_course_family_schedule_alias_collapsed_to_single_doc(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "course-family-schedule-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "course-family-schedule-collapsed",
                                "split": "smoke",
                                "query": "思政课第几学期开",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:中央民族大学通识课程思想政治理论课教学计划",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "course-family schedule should not collapse to a single-doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("course-family-schedule-collapsed", issues[0])
        self.assertIn("canonical qrels must not lock this", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_course_family_schedule_partial_alias_collapsed_to_single_doc(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "course-family-schedule-partial-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "course-family-schedule-partial-collapsed",
                                "split": "smoke",
                                "query": "思政课哪个学院开，第几学期开",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:中央民族大学通识课程思想政治理论课教学计划",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "course-family mixed schedule/offering-unit query must not collapse to a single-doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("course-family-schedule-partial-collapsed", issues[0])
        self.assertIn("canonical qrels must not lock this", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_course_family_schedule_short_alias_collapsed_to_single_doc(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "course-family-schedule-short-alias-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "course-family-schedule-short-alias-collapsed",
                                "split": "smoke",
                                "query": "思政第几学期开",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:中央民族大学通识课程思想政治理论课教学计划",
                                        "grade": 2,
                                    }
                                ],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("course-family-schedule-short-alias-collapsed", issues[0])
        self.assertIn("canonical qrels must not lock this", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_course_family_schedule_alias_variant_collapsed_to_single_doc(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "course-family-schedule-variant-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "course-family-schedule-variant-collapsed",
                                "split": "smoke",
                                "query": "思政课程第几学期开",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:中央民族大学通识课程思想政治理论课教学计划",
                                        "grade": 2,
                                    }
                                ],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("course-family-schedule-variant-collapsed", issues[0])
        self.assertIn("canonical qrels must not lock this", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_program_family_membership_alias_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-membership-collapsed",
                                "split": "smoke",
                                "query": "基地班有哪些",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:历史学（强基计划）本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "program-family membership must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-membership-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_generic_experimental_membership_alias_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-experimental-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-experimental-collapsed",
                                "split": "smoke",
                                "query": "实验班有哪些",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:孝通实验班本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "generic experimental-class membership must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-experimental-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_strong_base_membership_alias_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-strong-base-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-strong-base-collapsed",
                                "split": "smoke",
                                "query": "强基有哪些专业",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:历史学（强基计划）本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "strong-base membership must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-strong-base-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_full_strong_base_membership_alias_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-strong-base-full-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-strong-base-full-collapsed",
                                "split": "smoke",
                                "query": "强基计划有哪些专业",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:历史学（强基计划）本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "full strong-base membership alias must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-strong-base-full-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_second_degree_membership_alias_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-second-degree-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-second-degree-collapsed",
                                "split": "smoke",
                                "query": "二学位有哪些专业",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:民族学本科第二学士学位人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "second-degree membership must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-second-degree-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_full_second_degree_membership_alias_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-second-degree-full-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-second-degree-full-collapsed",
                                "split": "smoke",
                                "query": "第二学士学位有哪些专业",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:民族学本科第二学士学位人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "full second-degree membership alias must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-second-degree-full-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_innovation_experimental_alias_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-innovation-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-innovation-collapsed",
                                "split": "smoke",
                                "query": "创新实验班有哪些",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:光电科学与工程创新实验班本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "innovation-class membership must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-innovation-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_ethnic_experimental_membership_alias_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-ethnic-experimental-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-ethnic-experimental-collapsed",
                                "split": "smoke",
                                "query": "民族实验班有哪些",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:法学（民族实验班）本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "ethnic experimental class membership must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-ethnic-experimental-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_name_pattern_experimental_membership_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-name-pattern-experimental-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-name-pattern-experimental-collapsed",
                                "split": "smoke",
                                "query": "名称里带实验班的培养方案有哪些",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:孝通实验班本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "name-pattern experimental membership must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-name-pattern-experimental-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_name_pattern_innovation_membership_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-name-pattern-innovation-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-name-pattern-innovation-collapsed",
                                "split": "smoke",
                                "query": "名称里带创新班的培养方案有哪些",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:经济学拔尖人才创新班人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "name-pattern innovation membership must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-name-pattern-innovation-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_soft_personalization_only_single_doc_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "soft-personalization-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "soft-personalization-collapsed",
                                "split": "smoke",
                                "query": "基地班",
                                "request_overrides": {
                                    "recent_goal": "我刚刚在看历史学强基计划培养方案",
                                    "confirmed_slot_terms": ["历史学"],
                                },
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:历史学（强基计划）本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "soft personalization alone must not justify canonical single-doc curriculum truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("soft-personalization-collapsed", issues[0])
        self.assertIn("soft personalization alone", issues[0])
