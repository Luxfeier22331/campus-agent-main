from __future__ import annotations

from tests.specialist.rag_specialist_test_support import (
    ActorContext,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
    ContextProjection,
    EvidenceBundle,
    KnowledgeScope,
    PersonalizationHint,
    ProfileMemoryItem,
    ProfileMemorySummary,
    RagAnswerPromptOutput,
    RagClarifyPromptOutput,
    RagPromptExecutionResult,
    RagRequestPayload,
    RagResultPayload,
    ResolvedVersionQuery,
    ResolvedVersionSelection,
    SessionSlot,
    SessionSummary,
    SpecialistRequest,
    VersionQuery,
    _make_evidence,
    _make_versioned_handbook_evidence,
    _rag_prompt_trace,
    _resolved_scope_diagnostics,
    delegate_to_rag_agent,
    frame_rag_intent,
    patch,
    unittest,
)


class RagSpecialistClarificationVersioningTest(unittest.TestCase):
    def test_referential_question_maps_to_needs_clarification_without_retrieval(self) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence()

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="这个规定怎么办理？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("具体", response.follow_up_question)
        self.assertEqual(response.confidence, "low")
        self.assertEqual(
            response.result,
            RagResultPayload(
                evidence=EvidenceBundle(
                    query_text="这个规定怎么办理？",
                    corpus="regulations",
                    collection="student_rules",
                )
            ),
        )
        self.assertFalse(retriever_called)

    def test_referential_question_uses_injected_prompt_executor_for_clarification(self) -> None:
        class FakePromptExecutor:
            def compose_clarify(
                self, packet: object
            ) -> RagPromptExecutionResult[RagClarifyPromptOutput]:
                return RagPromptExecutionResult(
                    output=RagClarifyPromptOutput(follow_up_question="你具体想问哪一项制度？"),
                    prompt_trace=_rag_prompt_trace("rag_clarify_v1"),
                )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="这个规定怎么办理？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: _make_evidence(),
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertEqual(response.follow_up_question, "你具体想问哪一项制度？")
        self.assertEqual(response.result.diagnostics.prompt_trace.prompt_id, "rag_clarify_v1")

    def test_generic_scholarship_question_maps_to_needs_clarification_without_retrieval(
        self,
    ) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence()

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="奖学金怎么申请？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("奖学金", response.follow_up_question)
        self.assertFalse(retriever_called)
        self.assertEqual(
            response.result.diagnostics,
            _resolved_scope_diagnostics(
                corpus="regulations",
                collection="student_rules",
                retrieval_adequacy_verdict="ambiguous",
                retrieval_adequacy_reason="policy_object_missing",
            ),
        )

    def test_handbook_missing_policy_object_with_prompt_executor_skips_clarify_prompt(self) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence()

        class FakePromptExecutor:
            def compose_clarify(
                self, packet: object
            ) -> RagPromptExecutionResult[RagClarifyPromptOutput]:
                raise AssertionError(
                    "clarify prompt should not be used for handbook planner clarification"
                )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="评审办法里第一作者不是本校也能拿第二作者的分吧？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=fake_retriever,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertFalse(retriever_called)
        self.assertEqual(
            response.result.diagnostics,
            _resolved_scope_diagnostics(
                corpus="regulations",
                collection="student_rules",
                clarification_reason="policy_object_missing",
            ),
        )

    def test_contextual_clarification_mentions_recent_goal_when_available(self) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="这个申请条件是什么？",
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001", principal_id="principal-001"),
                    profile_memory=ProfileMemorySummary(
                        items=(
                            ProfileMemoryItem(
                                item_id="memory-001",
                                key="recent_goal",
                                value="咨询保研",
                                source_type="user_declared",
                                confidence="high",
                                visibility="user_visible",
                                last_verified_at="2026-03-28",
                            ),
                        ),
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: _make_evidence(),
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("保研", response.follow_up_question)

    def test_contextual_clarification_mentions_confirmed_slot_when_recent_goal_absent(self) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="这个申请条件是什么？",
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001", principal_id="principal-001"),
                    session=SessionSummary(
                        confirmed_slots=(
                            SessionSlot(name="policy_topic", value="推免资格", confirmed=True),
                        ),
                        turn_count=2,
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: _make_evidence(),
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("推免资格", response.follow_up_question)

    def test_frame_rag_intent_ignores_internal_only_profile_memory(self) -> None:
        request = SpecialistRequest(
            target="rag-agent",
            user_goal="这个申请条件是什么？",
            context=ContextProjection(
                actor=ActorContext(user_id="student-001", principal_id="principal-001"),
                profile_memory=ProfileMemorySummary(
                    items=(
                        ProfileMemoryItem(
                            item_id="memory-001",
                            key="recent_goal",
                            value="处分申诉",
                            source_type="system_inferred",
                            confidence="high",
                            visibility="internal_only",
                            last_verified_at="2026-04-02",
                        ),
                    ),
                ),
            ),
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules")
            ),
        )

        frame = frame_rag_intent(request)

        self.assertEqual(frame.personalization_mode, "generic")
        self.assertEqual(frame.retrieval_plan, "default_rewrite")

        response = delegate_to_rag_agent(
            request, retriever=lambda *args, **kwargs: _make_evidence()
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertNotIn("处分申诉", response.follow_up_question)

    def test_completed_response_passes_typed_personalization_hint_to_retriever(self) -> None:
        captured_kwargs: dict[str, object] = {}

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            captured_kwargs["query"] = query
            captured_kwargs.update(kwargs)
            return _make_evidence(scores=(0.82,), query_text=query)

        request = SpecialistRequest(
            target="rag-agent",
            user_goal="保研流程是什么？",
            context=ContextProjection(
                actor=ActorContext(
                    user_id="student-001",
                    principal_id="principal-001",
                    cohort="2023",
                    major="philosophy",
                ),
                authorization=AuthorizationProjection(
                    visibility_scope="north",
                    retrieval_filter=AuthorizedRetrievalFilter(visibility_scope="north"),
                ),
                profile_memory=ProfileMemorySummary(
                    items=(
                        ProfileMemoryItem(
                            item_id="memory-001",
                            key="recent_goal",
                            value="咨询保研",
                            source_type="user_declared",
                            confidence="high",
                            visibility="user_visible",
                            last_verified_at="2026-03-28",
                        ),
                    ),
                ),
                session=SessionSummary(
                    confirmed_slots=(
                        SessionSlot(name="policy_topic", value="推免资格", confirmed=True),
                    ),
                    turn_count=2,
                ),
            ),
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules")
            ),
        )

        response = delegate_to_rag_agent(request, retriever=fake_retriever)

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            captured_kwargs["personalization_hint"],
            PersonalizationHint(
                actor_claim_terms=("north campus", "2023 cohort", "philosophy major"),
                recent_goal="咨询保研",
                confirmed_slot_terms=("推免资格",),
            ),
        )

    def test_generic_completed_response_uses_injected_prompt_executor_for_answer(self) -> None:
        evidence = _make_evidence(scores=(0.82,), query_text="学生支持政策是什么")

        class FakePromptExecutor:
            def compose_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                return RagPromptExecutionResult(
                    output=RagAnswerPromptOutput(
                        answer_text="根据学生手册，学生支持政策以原文规定为准。"
                    ),
                    prompt_trace=_rag_prompt_trace("rag_answer_v1"),
                )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="学生支持政策是什么",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.answer_text, "根据学生手册，学生支持政策以原文规定为准。")
        self.assertEqual(response.result.diagnostics.prompt_trace.prompt_id, "rag_answer_v1")

    def test_ambiguous_multi_policy_evidence_maps_to_needs_clarification(self) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence(
                scores=(0.68, 0.66),
                doc_ids=("handbook:national-scholarship", "handbook:professional-scholarship"),
                snippets=(
                    "中央民族大学本科学生国家奖学金评审办法 / 第一章 总则 国家奖学金每学年评定一次。",
                    "中央民族大学本科学生专业奖学金评定办法 / 第一章 总则 专业奖学金面向普通培养类型学生。",
                ),
                query_text="国家奖学金还是专业奖学金怎么申请？",
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="国家奖学金还是专业奖学金怎么申请？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("奖学金", response.follow_up_question)
        self.assertFalse(retriever_called)
        self.assertEqual(
            response.result.diagnostics,
            _resolved_scope_diagnostics(
                corpus="regulations",
                collection="student_rules",
                clarification_reason="policy_object_conflict",
            ),
        )

    def test_resolved_historical_version_query_passes_version_filters_to_retriever(self) -> None:
        captured_kwargs: dict[str, object] = {}
        expected_evidence = _make_evidence(
            query_text="国奖",
            scores=(0.82,),
            doc_ids=("handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",),
        )

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            captured_kwargs["query"] = query
            captured_kwargs.update(kwargs)
            return expected_evidence

        with (
            patch(
                "campus_rag_agent.service.build_document_registry_from_env",
                return_value=object(),
            ),
            patch(
                "campus_rag_agent.service.resolve_version_query",
                return_value=ResolvedVersionQuery(
                    mode="historical",
                    status="resolved",
                    primary_selection=ResolvedVersionSelection(
                        document_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                        revision_track="source-faithful",
                        version_id="v1:national-scholarship",
                        anchor="previous",
                    ),
                ),
            ),
        ):
            response = delegate_to_rag_agent(
                SpecialistRequest(
                    target="rag-agent",
                    user_goal="国奖怎么办",
                    payload=RagRequestPayload(
                        scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                        version_query=VersionQuery(mode="historical"),
                    ),
                ),
                retriever=fake_retriever,
            )

        self.assertEqual(response.status, "completed")
        self.assertIn("国家奖学金", captured_kwargs["query"])
        self.assertEqual(
            captured_kwargs["target_document_ids"],
            ("handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",),
        )
        self.assertEqual(
            captured_kwargs["target_version_ids"],
            ("v1:national-scholarship",),
        )
        self.assertEqual(captured_kwargs["target_revision_track"], "source-faithful")

    def test_unresolved_historical_version_query_fails_closed_before_retrieval(self) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence()

        with (
            patch(
                "campus_rag_agent.service.build_document_registry_from_env",
                return_value=object(),
            ),
            patch(
                "campus_rag_agent.service.resolve_version_query",
                return_value=ResolvedVersionQuery(
                    mode="historical",
                    status="unresolved",
                    unresolved_reason="previous_version_not_found",
                ),
            ),
        ):
            response = delegate_to_rag_agent(
                SpecialistRequest(
                    target="rag-agent",
                    user_goal="国奖怎么办",
                    payload=RagRequestPayload(
                        scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                        version_query=VersionQuery(mode="historical"),
                    ),
                ),
                retriever=fake_retriever,
            )

        self.assertFalse(retriever_called)
        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.result.diagnostics.no_answer_reason, "version_filter_unresolved")

    def test_historical_answer_explicitly_marks_non_current_version(self) -> None:
        with (
            patch(
                "campus_rag_agent.service.build_document_registry_from_env",
                return_value=object(),
            ),
            patch(
                "campus_rag_agent.service.resolve_version_query",
                return_value=ResolvedVersionQuery(
                    mode="historical",
                    status="resolved",
                    primary_selection=ResolvedVersionSelection(
                        document_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                        revision_track="source-faithful",
                        version_id="v1:national-scholarship",
                        anchor="previous",
                    ),
                ),
            ),
        ):
            response = delegate_to_rag_agent(
                SpecialistRequest(
                    target="rag-agent",
                    user_goal="国奖第九条怎么要求论文和著作？",
                    payload=RagRequestPayload(
                        scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                        version_query=VersionQuery(mode="historical"),
                    ),
                ),
                retriever=lambda *args, **kwargs: _make_versioned_handbook_evidence(
                    query_text="国奖第九条怎么要求论文和著作？",
                    document_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                    primary_version_id="v1:national-scholarship",
                    primary_snippet="第九条 论文与著作按上一版要求计入综合测评。",
                ),
            )

        self.assertEqual(response.status, "completed")
        self.assertIn("历史版本", response.answer_text)
        self.assertIn("非现行", response.answer_text)
        self.assertEqual(response.result.diagnostics.semantic_outcome, "historical_grounded_answer")

    def test_as_of_answer_explicitly_marks_time_anchor(self) -> None:
        with (
            patch(
                "campus_rag_agent.service.build_document_registry_from_env",
                return_value=object(),
            ),
            patch(
                "campus_rag_agent.service.resolve_version_query",
                return_value=ResolvedVersionQuery(
                    mode="as_of",
                    status="resolved",
                    primary_selection=ResolvedVersionSelection(
                        document_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                        revision_track="source-faithful",
                        version_id="v1:national-scholarship",
                        anchor="as_of",
                    ),
                ),
            ),
        ):
            response = delegate_to_rag_agent(
                SpecialistRequest(
                    target="rag-agent",
                    user_goal="2024年6月1日时国奖第九条怎么要求论文和著作？",
                    payload=RagRequestPayload(
                        scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                        version_query=VersionQuery(mode="as_of", as_of="2024-06-01"),
                    ),
                ),
                retriever=lambda *args, **kwargs: _make_versioned_handbook_evidence(
                    query_text="2024年6月1日时国奖第九条怎么要求论文和著作？",
                    document_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                    primary_version_id="v1:national-scholarship",
                    primary_snippet="第九条 截至该时间点，论文与著作按旧版细则执行。",
                ),
            )

        self.assertEqual(response.status, "completed")
        self.assertIn("截至2024-06-01", response.answer_text)
        self.assertEqual(response.result.diagnostics.semantic_outcome, "as_of_grounded_answer")

    def test_compare_answer_distinguishes_old_and_new_versions(self) -> None:
        with (
            patch(
                "campus_rag_agent.service.build_document_registry_from_env",
                return_value=object(),
            ),
            patch(
                "campus_rag_agent.service.resolve_version_query",
                return_value=ResolvedVersionQuery(
                    mode="compare",
                    status="resolved",
                    primary_selection=ResolvedVersionSelection(
                        document_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                        revision_track="source-faithful",
                        version_id="v1:national-scholarship",
                        anchor="previous",
                    ),
                    comparison_selection=ResolvedVersionSelection(
                        document_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                        revision_track="source-faithful",
                        version_id="v2:national-scholarship",
                        anchor="current",
                    ),
                ),
            ),
        ):
            response = delegate_to_rag_agent(
                SpecialistRequest(
                    target="rag-agent",
                    user_goal="国奖第九条旧版和新版有什么变化？",
                    payload=RagRequestPayload(
                        scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                        version_query=VersionQuery(mode="compare"),
                    ),
                ),
                retriever=lambda *args, **kwargs: _make_versioned_handbook_evidence(
                    query_text="国奖第九条旧版和新版有什么变化？",
                    document_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                    primary_version_id="v1:national-scholarship",
                    primary_snippet="第九条 旧版只认可上一学年的论文与著作。",
                    comparison_version_id="v2:national-scholarship",
                    comparison_snippet="第九条 新版明确论文与著作须与奖学金评审年度相关。",
                ),
            )

        self.assertEqual(response.status, "completed")
        self.assertIn("旧版", response.answer_text)
        self.assertIn("新版", response.answer_text)
        self.assertIn("变化点", response.answer_text)
        self.assertEqual(response.result.diagnostics.semantic_outcome, "compare_grounded_answer")

    def test_compare_answer_fails_closed_when_one_side_support_is_missing(self) -> None:
        with (
            patch(
                "campus_rag_agent.service.build_document_registry_from_env",
                return_value=object(),
            ),
            patch(
                "campus_rag_agent.service.resolve_version_query",
                return_value=ResolvedVersionQuery(
                    mode="compare",
                    status="resolved",
                    primary_selection=ResolvedVersionSelection(
                        document_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                        revision_track="source-faithful",
                        version_id="v1:national-scholarship",
                        anchor="previous",
                    ),
                    comparison_selection=ResolvedVersionSelection(
                        document_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                        revision_track="source-faithful",
                        version_id="v2:national-scholarship",
                        anchor="current",
                    ),
                ),
            ),
        ):
            response = delegate_to_rag_agent(
                SpecialistRequest(
                    target="rag-agent",
                    user_goal="国奖第九条旧版和新版有什么变化？",
                    payload=RagRequestPayload(
                        scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                        version_query=VersionQuery(mode="compare"),
                    ),
                ),
                retriever=lambda *args, **kwargs: _make_versioned_handbook_evidence(
                    query_text="国奖第九条旧版和新版有什么变化？",
                    document_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                    primary_version_id="v1:national-scholarship",
                    primary_snippet="第九条 旧版只认可上一学年的论文与著作。",
                ),
            )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.result.diagnostics.no_answer_reason, "compare_support_incomplete")
