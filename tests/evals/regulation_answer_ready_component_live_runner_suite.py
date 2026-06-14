from __future__ import annotations

import json
import unittest
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from campus_contracts import (
    CapabilityResponse,
    ClaimSupport,
    EvidenceBundle,
    KnowledgeScope,
    RagRequestPayload,
    RagResultDiagnostics,
    RagResultPayload,
)
from campus_evals.answer_ready_component_eval import (
    load_answer_ready_component_cases,
)
from campus_evals.answer_ready_component_runtime import (
    AnswerReadyComponentRuntimeArtifact,
)
from campus_knowledge_capability.rag_sdk_models import (
    RagQueryIntent,
    RagSdkEvidenceProjection,
    RagSdkRunRequest,
    RagTaskKind,
)
from campus_knowledge_capability.typed_answer_drafts import (
    ConditionTableDraftRow,
    EligibilityJudgmentDraft,
    PolicyListDraftItem,
    TypedAnswerDraft,
)
from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY

from tests.agent.knowledge_capability_test_support import (
    CapabilityRequest,
    _make_handbook_source,
    _make_official_web_source,
)


def _answer_ready_anchor(**metadata: object) -> dict[str, object]:
    payload = {
        "evidence_contract_version": "answer_ready_evidence.v3",
        "parent_unit_id": "unit:article-1",
        **metadata,
    }
    return {INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: payload}


class RegulationAnswerReadyComponentLiveRunnerSuite(unittest.TestCase):
    def test_inprocess_delegate_uses_default_retriever_when_not_provided(self) -> None:
        from campus_evals.knowledge_inprocess_delegate import (
            delegate_to_knowledge_capability_inprocess,
        )

        request = CapabilityRequest(
            capability="knowledge",
            user_goal="处分怎么消",
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules")
            ),
            request_id="student_discipline_relief_procedure",
        )
        evidence = EvidenceBundle(
            corpus="regulations",
            collection="student_rules",
            query_text="处分怎么消",
            sources=(),
        )
        response = CapabilityResponse(
            capability="knowledge",
            status="completed",
            answer_text="按规定办理。",
            confidence="low",
        )

        with (
            patch(
                "campus_evals.knowledge_inprocess_delegate._service_delegate_to_knowledge_capability"
            ) as service_delegate,
            patch(
                "campus_evals.knowledge_inprocess_delegate._default_retriever",
                return_value=evidence,
                create=True,
            ) as default_retriever,
        ):

            def _delegate_side_effect(
                request_arg: CapabilityRequest, *, retriever, **kwargs: object
            ):
                self.assertEqual(request_arg, request)
                self.assertEqual(retriever("处分怎么消"), evidence)
                default_retriever.assert_called_once_with("处分怎么消")
                return response

            service_delegate.side_effect = _delegate_side_effect

            actual = delegate_to_knowledge_capability_inprocess(request)

        self.assertIs(actual, response)

    def test_preview_collection_override_bypasses_full_release_metadata_validation_only_for_physical_collection(
        self,
    ) -> None:
        from campus_evals.regulation_answer_ready_component_live_runner import (
            _build_preview_release_metadata_validation_override,
        )

        original = Mock()
        override = _build_preview_release_metadata_validation_override(
            original=original,
            scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            qdrant_collection_name="student_rules__r20260507_preview",
            default_alias_name="student_rules",
        )

        preview_profile = Mock()
        preview_profile.corpus = "regulations"
        preview_profile.collection = "student_rules"
        preview_profile.qdrant_index_binding = Mock(alias_name="student_rules__r20260507_preview")

        backend = Mock()
        settings = Mock()

        result = override(
            backend,
            collection_name="student_rules__r20260507_preview",
            profile=preview_profile,
            settings=settings,
            timeout_seconds=30,
        )
        self.assertIsNone(result)
        original.assert_not_called()

        serving_profile = Mock()
        serving_profile.corpus = "regulations"
        serving_profile.collection = "student_rules"
        serving_profile.qdrant_index_binding = Mock(alias_name="student_rules")

        override(
            backend,
            collection_name="student_rules",
            profile=serving_profile,
            settings=settings,
            timeout_seconds=30,
        )
        original.assert_called_once_with(
            backend,
            collection_name="student_rules",
            profile=serving_profile,
            settings=settings,
            timeout_seconds=30,
        )

    def test_preview_collection_override_disables_target_release_proof_only_for_physical_collection(
        self,
    ) -> None:
        from campus_evals.regulation_answer_ready_component_live_runner import (
            _build_preview_release_guard_override,
        )

        profile = Mock()
        profile.corpus = "regulations"
        profile.collection = "student_rules"
        profile.qdrant_index_binding = Mock(alias_name="student_rules")

        original = Mock(return_value=True)
        override = _build_preview_release_guard_override(
            original=original,
            scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            qdrant_collection_name="student_rules__r20260507_preview",
        )

        alias_profile = Mock()
        alias_profile.corpus = "regulations"
        alias_profile.collection = "student_rules"
        alias_profile.qdrant_index_binding = Mock(alias_name="student_rules__r20260507_preview")
        self.assertFalse(override(alias_profile))
        original.assert_not_called()

        self.assertTrue(override(profile))
        original.assert_called_once_with(profile)

    def test_build_runtime_artifacts_filters_collection_cases_and_captures_observations(
        self,
    ) -> None:
        from campus_evals.regulation_answer_ready_component_live_runner import (
            build_runtime_artifacts,
        )

        student_source = replace(
            _make_handbook_source(
                doc_id="handbook:discipline-relief",
                title="中央民族大学解除学生纪律处分实施办法",
                snippet="学生提交解除处分申请表，经学院审核后报学生处。",
                score=0.92,
                chunk_id_suffix="discipline-procedure",
                content_role="procedure",
                is_answer_bearing=True,
                semantic_role="procedure_step",
                polarity="positive",
                action_type="lift_discipline",
                claim_type="procedure",
            ),
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                condition_subject="application_procedure",
                condition_group_id="handbook:discipline-relief:article-3:application_procedure",
                condition_polarity="positive",
                procedure_step_index=1,
                procedure_actor="student",
                procedure_action="submit_materials",
            ),
        )
        student_response = CapabilityResponse(
            capability="knowledge",
            status="completed",
            answer_text="按规定提交解除处分申请表。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_rules",
                    query_text="处分怎么消",
                    sources=(student_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(student_source,),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="procedure_step",
                            claim_text="提交解除处分申请表。",
                            supported=True,
                            support_source_doc_id=student_source.doc_id,
                            support_snippet=student_source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )
        retrieval_observations = {
            "student_discipline_relief_procedure": (
                {"contract_missing": False, "contract_issue_reason": ""},
            )
        }

        def delegate(
            request: CapabilityRequest, *, retrieval_observation_sink=None, **kwargs: object
        ):
            self.assertIsInstance(request.payload, RagRequestPayload)
            self.assertEqual(request.payload.scope, KnowledgeScope("regulations", "student_rules"))
            if retrieval_observation_sink is not None:
                for observation in retrieval_observations["student_discipline_relief_procedure"]:
                    retrieval_observation_sink(observation)
            return student_response

        cases = load_answer_ready_component_cases().cases
        artifacts = build_runtime_artifacts(
            cases=cases,
            collection="student_rules",
            delegate=delegate,
        )

        self.assertTrue(artifacts)
        self.assertTrue(
            all(isinstance(artifact, AnswerReadyComponentRuntimeArtifact) for artifact in artifacts)
        )
        self.assertTrue(all(artifact.case_id.startswith("student_") for artifact in artifacts))
        first = next(
            artifact
            for artifact in artifacts
            if artifact.case_id == "student_discipline_relief_procedure"
        )
        self.assertEqual(first.query, "处分怎么消")
        self.assertEqual(first.release_contract_status, "passed")
        self.assertEqual(first.release_contract_failure_classes, ())
        self.assertEqual(
            tuple(first.retrieval_runtime_observations),
            retrieval_observations["student_discipline_relief_procedure"],
        )

    def test_run_component_eval_for_collection_writes_summary_and_supports_collection_override(
        self,
    ) -> None:
        from campus_evals.regulation_answer_ready_component_live_runner import (
            run_component_eval_for_collection,
        )

        institutional_source = replace(
            _make_official_web_source(
                doc_id="official_web_regulation:91431d30da51d124",
                title="中央民族大学办公自动化系统管理规定（试行）",
                snippet="新增人员的开户由相关部门和单位提出申请，经校办审核后，由校级系统管理员办理。",
                score=0.94,
                chunk_id_suffix="oa-account-procedure",
                content_role="procedure",
                is_answer_bearing=True,
                semantic_role="procedure_step",
                polarity="positive",
                claim_type="procedure",
                collection="institutional_rules",
            ),
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                condition_subject="application_procedure",
                condition_group_id="institutional:appeal:procedure",
                condition_polarity="positive",
                procedure_step_index=1,
                procedure_actor="student",
                procedure_action="submit_materials",
            ),
        )
        deadline_source = replace(
            _make_official_web_source(
                doc_id="official_web_regulation:ce565b348ca6ee31",
                title="中央民族大学二级网站建设与运行管理办法",
                snippet="发现受到攻击等安全问题必须在第一时间进行处理并上报。",
                score=0.93,
                chunk_id_suffix="website-security-deadline",
                content_role="requirement",
                is_answer_bearing=True,
                semantic_role="time_constraint",
                polarity="positive",
                claim_type="time_constraint",
                collection="institutional_rules",
            ),
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                condition_subject="deadline",
                condition_group_id="institutional:appeal:deadline",
                condition_polarity="positive",
            ),
        )

        def delegate(
            request: CapabilityRequest,
            *,
            retrieval_observation_sink=None,
            **kwargs: object,
        ) -> CapabilityResponse:
            self.assertEqual(
                request.payload.scope,
                KnowledgeScope(corpus="regulations", collection="institutional_rules"),
            )
            if retrieval_observation_sink is not None:
                retrieval_observation_sink({"contract_missing": False, "contract_issue_reason": ""})
            query = request.user_goal
            if "流程" in query:
                evidence = (institutional_source,)
                claim_supports = (
                    ClaimSupport(
                        claim_type="procedure_step",
                        claim_text="由相关部门和单位提出申请，经校办审核后，由校级系统管理员办理。",
                        supported=True,
                        support_source_doc_id=institutional_source.doc_id,
                        support_snippet=institutional_source.snippet,
                    ),
                )
                answer_text = "可按以下步骤处理：由相关部门和单位提出申请，经校办审核后，由校级系统管理员办理。"
            elif "时间" in query:
                evidence = (deadline_source,)
                claim_supports = (
                    ClaimSupport(
                        claim_type="time_constraint",
                        claim_text="必须在第一时间进行处理并上报。",
                        supported=True,
                        support_source_doc_id=deadline_source.doc_id,
                        support_snippet=deadline_source.snippet,
                    ),
                )
                answer_text = "发现安全问题后，必须在第一时间进行处理并上报。"
            else:
                evidence = ()
                claim_supports = ()
                answer_text = "当前未检索到足够依据。"
            status = "completed" if evidence else "no_answer"
            return CapabilityResponse(
                capability="knowledge",
                status=status,
                answer_text=answer_text,
                confidence="high" if evidence else "low",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        corpus="regulations",
                        collection="institutional_rules",
                        query_text=query,
                        sources=evidence,
                    ),
                    diagnostics=RagResultDiagnostics(
                        retrieved_sources=evidence,
                        claim_supports=claim_supports,
                        semantic_outcome=(
                            "grounded_answer" if evidence else "unsupported_by_evidence"
                        ),
                        grounding_verdict="grounded" if evidence else "",
                        retrieval_adequacy_verdict="sufficient" if evidence else "insufficient",
                        retrieval_adequacy_reason="sufficient"
                        if evidence
                        else "no_supporting_sources",
                    ),
                ),
            )

        with TemporaryDirectory() as temp_dir:
            summary_path = Path(temp_dir) / "component-eval-summary.json"
            observations_path = Path(temp_dir) / "retrieval-observations.jsonl"
            report = run_component_eval_for_collection(
                collection="institutional_rules",
                summary_output_path=summary_path,
                retrieval_observations_output_path=observations_path,
                delegate=delegate,
                qdrant_collection_name="institutional_rules__r20260507_120000",
            )

            self.assertEqual(report.total, 5)
            self.assertTrue(summary_path.exists())
            payload = json.loads(summary_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["case_family"], "answer_ready_component_eval.v1")
            self.assertEqual(payload["summary"]["total"], 5)
            self.assertFalse(payload["summary"]["overall_passed"])
            self.assertIn(
                "institutional_appeal_procedure", {row["case_id"] for row in payload["results"]}
            )
            self.assertTrue(observations_path.exists())
            lines = [
                json.loads(line)
                for line in observations_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertGreaterEqual(len(lines), 1)

    def test_inprocess_default_grounded_runner_preserves_policy_list_typed_answer_claims(
        self,
    ) -> None:
        from campus_evals.knowledge_inprocess_delegate import (
            _test_support_grounded_runner_for_evidence,
        )

        source = replace(
            _make_handbook_source(
                doc_id="handbook:scholarship-overview",
                title="本科生奖学金目录",
                snippet="当前已收录依据中，本科生奖学金相关制度包括国家奖学金、国家励志奖学金。",
                score=0.91,
                chunk_id_suffix="policy-list-overview",
                content_role="policy_list",
                is_answer_bearing=True,
                semantic_role="category_overview",
                polarity="neutral",
                claim_type="policy_list",
            ),
            anchor=_answer_ready_anchor(
                answer_role="category_overview",
                condition_subject="audience_scope",
                condition_group_id="handbook:scholarship-overview:article-1:audience_scope",
                condition_polarity="neutral",
                category_id="scholarship",
                category_audience="本科生",
                category_member_document_ids=(
                    "handbook:national-scholarship",
                    "handbook:national-encouragement",
                ),
            ),
        )
        evidence = EvidenceBundle(
            corpus="regulations",
            collection="student_rules",
            query_text="本科生有哪些奖学金能申请",
            sources=(source,),
        )
        runner = _test_support_grounded_runner_for_evidence(evidence)
        request = RagSdkRunRequest(
            user_goal="本科生有哪些奖学金能申请",
            query_intent=RagQueryIntent(
                task_kind=RagTaskKind.CATEGORY_DISCOVERY,
                normalized_query="本科生有哪些奖学金能申请",
            ),
            evidence=RagSdkEvidenceProjection.from_evidence_bundle(evidence),
            typed_answer=TypedAnswerDraft(
                kind="policy_list",
                items=(
                    PolicyListDraftItem(
                        source_id=source.doc_id,
                        chunk_id=source.chunk_id,
                        excerpt=source.snippet,
                        text="《本科生奖学金目录》：国家奖学金、国家励志奖学金",
                        category_id="scholarship",
                        audience="本科生",
                        member_document_ids=(
                            "handbook:national-scholarship",
                            "handbook:national-encouragement",
                        ),
                        evidence_contract_version="answer_ready_evidence.v3",
                    ),
                ),
            ),
        )

        result = runner(request)

        self.assertEqual(
            tuple(claim.claim_type for claim in result.output.claims), ("policy_list_item",)
        )
        self.assertEqual(
            tuple(support.claim_id for support in result.output.claim_supports), ("claim-1",)
        )

    def test_inprocess_default_grounded_runner_preserves_judgment_typed_answer_claims(
        self,
    ) -> None:
        from campus_evals.knowledge_inprocess_delegate import (
            _test_support_grounded_runner_for_evidence,
        )

        source = replace(
            _make_handbook_source(
                doc_id="handbook:national-scholarship",
                title="国家奖学金评审办法",
                snippet="在道德风尚、学术研究、学科竞赛等某一方面表现特别优秀的学生，可适当放宽成绩排名要求。",
                score=0.93,
                chunk_id_suffix="rank-exception",
                content_role="eligibility",
                is_answer_bearing=True,
                semantic_role="exception_rule",
                polarity="positive",
                claim_type="condition",
            ),
            anchor=_answer_ready_anchor(
                answer_role="exception_rule",
                condition_subject="rank_threshold",
                condition_group_id="handbook:national-scholarship:article-9:rank_threshold",
                condition_polarity="positive",
            ),
        )
        evidence = EvidenceBundle(
            corpus="regulations",
            collection="student_rules",
            query_text="成绩没前十还能评国奖吗",
            sources=(source,),
        )
        runner = _test_support_grounded_runner_for_evidence(evidence)
        request = RagSdkRunRequest(
            user_goal="成绩没前十还能评国奖吗",
            query_intent=RagQueryIntent(
                task_kind=RagTaskKind.SPECIFIC_POLICY_LOOKUP,
                normalized_query="成绩没前十还能评国奖吗",
            ),
            evidence=RagSdkEvidenceProjection.from_evidence_bundle(evidence),
            typed_answer=TypedAnswerDraft(
                kind="eligibility_judgment",
                judgment=EligibilityJudgmentDraft(
                    source_id=source.doc_id,
                    chunk_id=source.chunk_id,
                    excerpt=source.snippet,
                    condition_subject="rank_threshold",
                    polarity="positive",
                    conclusion="可在特别优秀情形下适当放宽排名要求。",
                    evidence_contract_version="answer_ready_evidence.v3",
                ),
            ),
        )

        result = runner(request)

        self.assertEqual(
            tuple(claim.claim_type for claim in result.output.claims),
            ("eligibility_judgment",),
        )

    def test_inprocess_default_grounded_runner_preserves_condition_table_typed_answer_claims(
        self,
    ) -> None:
        from campus_evals.knowledge_inprocess_delegate import (
            _test_support_grounded_runner_for_evidence,
        )

        source = replace(
            _make_official_web_source(
                doc_id="official_web_regulation:ce565b348ca6ee31",
                title="中央民族大学二级网站建设与运行管理办法",
                snippet="发现受到攻击等安全问题必须在第一时间进行处理并上报。",
                score=0.94,
                chunk_id_suffix="website-deadline-row",
                content_role="deadline",
                is_answer_bearing=True,
                semantic_role="time_constraint",
                polarity="positive",
                claim_type="time_constraint",
                collection="institutional_rules",
            ),
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                condition_subject="deadline",
                condition_group_id="institutional:website:article-11:deadline",
                condition_polarity="positive",
            ),
        )
        evidence = EvidenceBundle(
            corpus="regulations",
            collection="institutional_rules",
            query_text="二级网站安全问题要多久上报",
            sources=(source,),
        )
        runner = _test_support_grounded_runner_for_evidence(evidence)
        request = RagSdkRunRequest(
            user_goal="二级网站安全问题要多久上报",
            query_intent=RagQueryIntent(
                task_kind=RagTaskKind.SPECIFIC_POLICY_LOOKUP,
                normalized_query="二级网站安全问题要多久上报",
            ),
            evidence=RagSdkEvidenceProjection.from_evidence_bundle(evidence),
            typed_answer=TypedAnswerDraft(
                kind="condition_table",
                rows=(
                    ConditionTableDraftRow(
                        source_id=source.doc_id,
                        chunk_id=source.chunk_id,
                        excerpt=source.snippet,
                        condition_subject="deadline",
                        polarity="positive",
                        condition_text="必须在第一时间进行处理并上报。",
                        answer_role="time_constraint",
                        evidence_contract_version="answer_ready_evidence.v3",
                    ),
                ),
            ),
        )

        result = runner(request)

        self.assertEqual(
            tuple(claim.claim_type for claim in result.output.claims),
            ("time_constraint",),
        )


if __name__ == "__main__":
    unittest.main()
