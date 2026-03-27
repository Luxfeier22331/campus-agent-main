from __future__ import annotations

from campus_contracts import ActorContext, KnowledgeScope

from campus_evals.models import GoldenCase, TraceExpectation, expected_source_ref


def student_handbook_smoke_cases() -> tuple[GoldenCase, ...]:
    goals = (
        "library hours",
        "scholarship eligibility",
        "graduation credits",
        "registrar transcript",
        "add/drop",
        "leave of absence",
    )
    return tuple(
        GoldenCase(
            case_id=f"student-handbook-smoke-{index}",
            split="smoke",
            source_type="synthetic_expansion",
            user_goal=goal,
            actor=ActorContext(),
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
            expected_status="completed",
            generator_name="bootstrap-smoke-generator",
            generator_version="v1",
            generation_recipe="phase1-handbook-smoke-topics",
            tags=("phase1", "student_handbook", "smoke"),
        )
        for index, goal in enumerate(goals, start=1)
    )


def student_handbook_release_gate_cases() -> tuple[GoldenCase, ...]:
    scope = KnowledgeScope(corpus="regulations", collection="student_handbook")
    return (
        GoldenCase(
            case_id="release-gate-scholarship-title",
            split="release_gate",
            source_type="expert_authored",
            user_goal="中央民族大学本科学生国家奖学金评审办法",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(expected_source_ref("handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"),),
            required_facts=("国家奖学金",),
            forbidden_claims=("研究生国家奖学金",),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("phase1", "student_handbook", "release_gate"),
        ),
        GoldenCase(
            case_id="release-gate-student-card",
            split="release_gate",
            source_type="expert_authored",
            user_goal="学生证丢了怎么办",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(expected_source_ref("handbook:e90f9707387f9e232ea88ce1c7f5328242e52389"),),
            forbidden_sources=(expected_source_ref("handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"),),
            required_facts=("学生证",),
            forbidden_claims=("无需书面申请",),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("phase1", "student_handbook", "release_gate"),
        ),
        GoldenCase(
            case_id="release-gate-dormitory-lighting",
            split="release_gate",
            source_type="expert_authored",
            user_goal="宿舍照明",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(expected_source_ref("handbook:2ec80263a9e7b11379281349196ceb96afa44c3b"),),
            required_facts=("宿舍照明",),
            forbidden_claims=("每天20:00统一熄灯",),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("phase1", "student_handbook", "release_gate"),
        ),
        GoldenCase(
            case_id="release-gate-medical-title",
            split="release_gate",
            source_type="expert_authored",
            user_goal="中央民族大学学生公费医疗管理办法",
            actor=ActorContext(),
            scope=scope,
            expected_status="completed",
            expected_sources=(expected_source_ref("handbook:b85de1cb327a26dc63488e247403ae3126d524be"),),
            forbidden_sources=(expected_source_ref("handbook:e90f9707387f9e232ea88ce1c7f5328242e52389"),),
            required_facts=("公费医疗",),
            forbidden_claims=("门诊全部免费",),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
            ),
            tags=("phase1", "student_handbook", "release_gate"),
        ),
        GoldenCase(
            case_id="release-gate-no-answer",
            split="release_gate",
            source_type="expert_authored",
            user_goal="火星校区飞船停靠规则",
            actor=ActorContext(),
            scope=scope,
            expected_status="no_answer",
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
                fail_closed_expected=True,
            ),
            tags=("phase1", "student_handbook", "release_gate"),
        ),
        GoldenCase(
            case_id="release-gate-needs-clarification",
            split="release_gate",
            source_type="expert_authored",
            user_goal="奖学金怎么申请？",
            actor=ActorContext(),
            scope=scope,
            expected_status="needs_clarification",
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=False,
                clarification_expected=True,
                error_expected=False,
            ),
            tags=("phase1", "student_handbook", "release_gate"),
        ),
    )
