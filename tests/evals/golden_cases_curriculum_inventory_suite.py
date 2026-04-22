from __future__ import annotations

from tests.evals.golden_cases_test_support import (
    CURRICULUM_SCOPE,
    ExecutionResult,
    ObservedTrace,
    _response,
    _source,
    curriculum_error_gate_cases,
    curriculum_regression_locked_cases,
    curriculum_release_gate_cases,
    curriculum_smoke_cases,
    run_cases,
    unittest,
)


class RunCasesCurriculumInventoryTest(unittest.TestCase):
    def test_curriculum_course_family_cases_forbid_unsupported_offering_unit_guess(self) -> None:
        cases = {case.case_id: case for case in curriculum_regression_locked_cases()}

        self.assertIn(
            "不得猜测开课学院",
            " ".join(cases["curriculum-regression-course-family-partial-answer"].forbidden_claims),
        )
        self.assertIn(
            "不得猜测开课学院",
            " ".join(
                cases[
                    "curriculum-regression-course-family-schedule-partial-answer"
                ].forbidden_claims
            ),
        )
        self.assertIn(
            "不得猜测开课学院",
            " ".join(
                cases[
                    "curriculum-regression-course-single-schedule-partial-answer"
                ].forbidden_claims
            ),
        )

    def test_curriculum_release_gate_course_family_case_accepts_internal_course_facts_surface(
        self,
    ) -> None:
        case = next(
            item
            for item in curriculum_release_gate_cases()
            if item.case_id == "curriculum-release-gate-course-family-membership"
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text=(
                        "根据课程教学计划相关内容，思想政治理论课包括马克思主义基本原理、"
                        "中国近现代史纲要、毛泽东思想和中国特色社会主义理论体系概论、"
                        "习近平新时代中国特色社会主义思想概论、思想道德与法治、形势与政策、中华民族共同体概论。"
                    ),
                    corpus="curriculum",
                    collection="course_facts",
                    sources=(
                        _source(
                            doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                            collection="course_facts",
                            snippet="思想政治理论课包括马克思主义基本原理、习近平新时代中国特色社会主义思想概论、中华民族共同体概论等课程。",
                        ),
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=CURRICULUM_SCOPE,
                    retrieval_called=True,
                    clarification_emitted=False,
                    error_path=False,
                    supporting_sources=(
                        _source(
                            doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                            collection="course_facts",
                            snippet="思想政治理论课包括马克思主义基本原理、习近平新时代中国特色社会主义思想概论、中华民族共同体概论等课程。",
                        ),
                    ),
                ),
            ),
        )

        result = report.results[0]
        self.assertTrue(result.passed)
        self.assertEqual(report.by_metric["answer_accuracy"].passed, 1)

    def test_curriculum_release_gate_short_course_family_alias_case_accepts_internal_course_facts_surface(
        self,
    ) -> None:
        case = next(
            item
            for item in curriculum_release_gate_cases()
            if item.case_id == "curriculum-release-gate-course-family-audience-short-alias"
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text="根据当前已采集的培养方案和通识课程教学计划，可确认思政课面向所有本预科学生。",
                    corpus="curriculum",
                    collection="course_facts",
                    sources=(
                        _source(
                            doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                            collection="course_facts",
                            snippet="思想政治理论课为全校性公共必修课，所有本预科学生应认真完成上述7门课程设置的各教学环节。",
                        ),
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=CURRICULUM_SCOPE,
                    retrieval_called=True,
                    clarification_emitted=False,
                    error_path=False,
                    supporting_sources=(
                        _source(
                            doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                            collection="course_facts",
                            snippet="思想政治理论课为全校性公共必修课，所有本预科学生应认真完成上述7门课程设置的各教学环节。",
                        ),
                    ),
                ),
            ),
        )

        result = report.results[0]
        self.assertTrue(result.passed)
        self.assertEqual(report.by_metric["answer_accuracy"].passed, 1)

    def test_curriculum_release_gate_program_family_case_accepts_internal_program_family_facts_surface(
        self,
    ) -> None:
        case = next(
            item
            for item in curriculum_release_gate_cases()
            if item.case_id == "curriculum-release-gate-program-family-membership"
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text="民大的民族班有法学、信息与计算科学、计算机科学与技术。",
                    corpus="curriculum",
                    collection="program_family_facts",
                    sources=(
                        _source(
                            doc_id="program_family_facts:ethnic-class-membership",
                            collection="program_family_facts",
                            snippet="民大的民族班有法学、信息与计算科学、计算机科学与技术。",
                        ),
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=CURRICULUM_SCOPE,
                    retrieval_called=True,
                    clarification_emitted=False,
                    error_path=False,
                    supporting_sources=(
                        _source(
                            doc_id="program_family_facts:ethnic-class-membership",
                            collection="program_family_facts",
                            snippet="民大的民族班有法学、信息与计算科学、计算机科学与技术。",
                        ),
                    ),
                ),
            ),
        )

        result = report.results[0]
        self.assertTrue(result.passed)
        self.assertEqual(report.by_metric["answer_accuracy"].passed, 1)

    def test_curriculum_smoke_strong_base_program_family_case_accepts_internal_program_family_facts_surface(
        self,
    ) -> None:
        case = next(
            item
            for item in curriculum_smoke_cases()
            if item.case_id == "curriculum-smoke-program-family-strong-base-membership"
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text="按当前已采集的培养方案，强基计划有历史学、哲学、中国少数民族语言文学（古文字学方向）。",
                    corpus="curriculum",
                    collection="program_family_facts",
                    sources=(
                        _source(
                            doc_id="program_family_facts:strong-base-membership",
                            collection="program_family_facts",
                            snippet="按当前已采集的培养方案，强基计划有历史学、哲学、中国少数民族语言文学（古文字学方向）。",
                        ),
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=CURRICULUM_SCOPE,
                    retrieval_called=True,
                    clarification_emitted=False,
                    error_path=False,
                    supporting_sources=(
                        _source(
                            doc_id="program_family_facts:strong-base-membership",
                            collection="program_family_facts",
                            snippet="按当前已采集的培养方案，强基计划有历史学、哲学、中国少数民族语言文学（古文字学方向）。",
                        ),
                    ),
                ),
            ),
        )

        result = report.results[0]
        self.assertTrue(result.passed)
        self.assertEqual(report.by_metric["answer_accuracy"].passed, 1)

    def test_curriculum_regression_sixiuke_schedule_case_accepts_internal_course_facts_surface(
        self,
    ) -> None:
        case = next(
            item
            for item in curriculum_regression_locked_cases()
            if item.case_id == "curriculum-regression-course-family-schedule-sixiuke"
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text=(
                        "根据培养方案和课程教学计划，思想政治理论课目前能确认的有："
                        "马克思主义基本原理：第3学期(文科)；第4学期(理工/艺体)；"
                        "习近平新时代中国特色社会主义思想概论：第1学期(理工/艺体)；第2学期(文科)。"
                    ),
                    corpus="curriculum",
                    collection="course_facts",
                    sources=(
                        _source(
                            doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                            collection="course_facts",
                            snippet="马克思主义基本原理开设学期：第3学期(文科)；第4学期(理工/艺体)。",
                        ),
                        _source(
                            doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                            collection="course_facts",
                            snippet="习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)。",
                        ),
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=CURRICULUM_SCOPE,
                    retrieval_called=True,
                    clarification_emitted=False,
                    error_path=False,
                    supporting_sources=(
                        _source(
                            doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                            collection="course_facts",
                            snippet="马克思主义基本原理开设学期：第3学期(文科)；第4学期(理工/艺体)。",
                        ),
                        _source(
                            doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                            collection="course_facts",
                            snippet="习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)。",
                        ),
                    ),
                ),
            ),
        )

        result = report.results[0]
        self.assertTrue(result.passed)
        self.assertEqual(report.by_metric["answer_accuracy"].passed, 1)

    def test_curriculum_regression_second_degree_alias_variant_case_accepts_internal_program_family_facts_surface(
        self,
    ) -> None:
        case = next(
            item
            for item in curriculum_regression_locked_cases()
            if item.case_id
            == "curriculum-regression-program-family-second-degree-membership-alias-variant"
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text=(
                        "按当前已采集的培养方案，第二学士学位项目有民族学、社会学、文物与博物馆学、"
                        "金融学、会计学、法学、环境工程、数据科学与大数据技术、教育学。"
                    ),
                    corpus="curriculum",
                    collection="program_family_facts",
                    sources=(
                        _source(
                            doc_id="program_family_facts:second-degree-membership",
                            collection="program_family_facts",
                            snippet=(
                                "按当前已采集的培养方案，第二学士学位项目有民族学、社会学、文物与博物馆学、"
                                "金融学、会计学、法学、环境工程、数据科学与大数据技术、教育学。"
                            ),
                        ),
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=CURRICULUM_SCOPE,
                    retrieval_called=True,
                    clarification_emitted=False,
                    error_path=False,
                    supporting_sources=(
                        _source(
                            doc_id="program_family_facts:second-degree-membership",
                            collection="program_family_facts",
                            snippet=(
                                "按当前已采集的培养方案，第二学士学位项目有民族学、社会学、文物与博物馆学、"
                                "金融学、会计学、法学、环境工程、数据科学与大数据技术、教育学。"
                            ),
                        ),
                    ),
                ),
            ),
        )

        result = report.results[0]
        self.assertTrue(result.passed)
        self.assertEqual(report.by_metric["answer_accuracy"].passed, 1)

    def test_curriculum_regression_innovation_experimental_alias_case_accepts_internal_program_family_facts_surface(
        self,
    ) -> None:
        case = next(
            item
            for item in curriculum_regression_locked_cases()
            if item.case_id
            == "curriculum-regression-program-family-innovation-experimental-membership"
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text=(
                        "按当前已采集的培养方案，名称里带“创新班”或“创新实验班”的有经济学拔尖人才创新班、"
                        "理工科交叉创新人才培养实验班、光电科学与工程创新实验班。"
                    ),
                    corpus="curriculum",
                    collection="program_family_facts",
                    sources=(
                        _source(
                            doc_id="program_family_facts:innovation-class-membership",
                            collection="program_family_facts",
                            snippet=(
                                "按当前已采集的培养方案，名称里带“创新班”或“创新实验班”的有经济学拔尖人才创新班、"
                                "理工科交叉创新人才培养实验班、光电科学与工程创新实验班。"
                            ),
                        ),
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=CURRICULUM_SCOPE,
                    retrieval_called=True,
                    clarification_emitted=False,
                    error_path=False,
                    supporting_sources=(
                        _source(
                            doc_id="program_family_facts:innovation-class-membership",
                            collection="program_family_facts",
                            snippet=(
                                "按当前已采集的培养方案，名称里带“创新班”或“创新实验班”的有经济学拔尖人才创新班、"
                                "理工科交叉创新人才培养实验班、光电科学与工程创新实验班。"
                            ),
                        ),
                    ),
                ),
            ),
        )

        result = report.results[0]
        self.assertTrue(result.passed)
        self.assertEqual(report.by_metric["answer_accuracy"].passed, 1)

    def test_curriculum_release_gate_name_pattern_program_family_case_accepts_internal_program_family_facts_surface(
        self,
    ) -> None:
        case = next(
            item
            for item in curriculum_release_gate_cases()
            if item.case_id
            == "curriculum-release-gate-program-family-name-pattern-experimental-membership"
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text=(
                        "按当前已采集的培养方案，名称里带“实验班”的有孝通实验班、法学（民族实验班）、"
                        "信息与计算科学（民族实验班）、计算机科学与技术（民族实验班）、"
                        "理工科交叉创新人才培养实验班、光电科学与工程创新实验班。"
                    ),
                    corpus="curriculum",
                    collection="program_family_facts",
                    sources=(
                        _source(
                            doc_id="program_family_facts:experimental-class-membership",
                            collection="program_family_facts",
                            snippet=(
                                "按当前已采集的培养方案，名称里带“实验班”的有孝通实验班、法学（民族实验班）、"
                                "信息与计算科学（民族实验班）、计算机科学与技术（民族实验班）、"
                                "理工科交叉创新人才培养实验班、光电科学与工程创新实验班。"
                            ),
                        ),
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=CURRICULUM_SCOPE,
                    retrieval_called=True,
                    clarification_emitted=False,
                    error_path=False,
                    supporting_sources=(
                        _source(
                            doc_id="program_family_facts:experimental-class-membership",
                            collection="program_family_facts",
                            snippet=(
                                "按当前已采集的培养方案，名称里带“实验班”的有孝通实验班、法学（民族实验班）、"
                                "信息与计算科学（民族实验班）、计算机科学与技术（民族实验班）、"
                                "理工科交叉创新人才培养实验班、光电科学与工程创新实验班。"
                            ),
                        ),
                    ),
                ),
            ),
        )

        result = report.results[0]
        self.assertTrue(result.passed)
        self.assertEqual(report.by_metric["answer_accuracy"].passed, 1)

    def test_curriculum_smoke_ethnic_experimental_program_family_case_accepts_internal_program_family_facts_surface(
        self,
    ) -> None:
        case = next(
            item
            for item in curriculum_smoke_cases()
            if item.case_id == "curriculum-smoke-program-family-ethnic-experimental-membership"
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text="民大的民族班有法学、信息与计算科学、计算机科学与技术。",
                    corpus="curriculum",
                    collection="program_family_facts",
                    sources=(
                        _source(
                            doc_id="program_family_facts:ethnic-class-membership",
                            collection="program_family_facts",
                            snippet="民大的民族班有法学、信息与计算科学、计算机科学与技术。",
                        ),
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=CURRICULUM_SCOPE,
                    retrieval_called=True,
                    clarification_emitted=False,
                    error_path=False,
                    supporting_sources=(
                        _source(
                            doc_id="program_family_facts:ethnic-class-membership",
                            collection="program_family_facts",
                            snippet="民大的民族班有法学、信息与计算科学、计算机科学与技术。",
                        ),
                    ),
                ),
            ),
        )

        result = report.results[0]
        self.assertTrue(result.passed)
        self.assertEqual(report.by_metric["answer_accuracy"].passed, 1)

    def test_curriculum_error_gate_cases_cover_deterministic_error_paths(self) -> None:
        cases = curriculum_error_gate_cases()

        self.assertEqual(len(cases), 3)
        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "curriculum-error-gate-retrieval-backend-failure",
                "curriculum-error-gate-evidence-shaping-failure",
                "curriculum-error-gate-invalid-backend-contract",
            ),
        )
        self.assertTrue(all(case.expected_status == "error" for case in cases))
        self.assertTrue(all(case.split == "release_gate" for case in cases))
        self.assertTrue(all("error_gate" in case.tags for case in cases))
        self.assertTrue(all(case.scope == CURRICULUM_SCOPE for case in cases))
