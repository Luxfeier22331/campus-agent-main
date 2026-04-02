from __future__ import annotations

from dataclasses import asdict, fields
import unittest

from campus_contracts import (
    ActorContext,
    AuthorizedRetrievalFilter,
    AuthorizationProjection,
    AvailabilityCheckPayload,
    AvailabilityObservation,
    ContextProjection,
    DocumentRef,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    ProfileMemoryItem,
    ProfileMemorySummary,
    RagResultDiagnostics,
    SessionSlot,
    SessionSummary,
    RagRequestPayload,
    RagResultPayload,
    SpecialistRequest,
    SpecialistResponse,
    SupervisorResponse,
    SupervisorRequest,
    TraceContext,
)


class ContractModelsTest(unittest.TestCase):
    def test_supervisor_request_defaults_do_not_inject_fixed_capability_or_scope(self) -> None:
        request = SupervisorRequest(user_goal="library hours")

        self.assertEqual(request.conversation_id, "")
        self.assertEqual(request.request_id, "")
        self.assertIsNone(request.requested_capability)
        self.assertIsNone(request.requested_scope)
        self.assertIsNone(request.availability_target_id)
        self.assertTrue(request.follow_redirects)
        self.assertEqual(
            request.trace,
            TraceContext(trace_id="", parent_run_id="", tool_call_id=""),
        )
        self.assertEqual(
            request.actor,
            ActorContext(
                user_id="",
                principal_id="",
                roles=(),
                departments=(),
                groups=(),
                campus_scope=None,
                cohort=None,
                major=None,
                program=None,
            ),
        )
        self.assertEqual(
            request.context,
            ContextProjection(
                actor=ActorContext(
                    user_id="",
                    principal_id="",
                    roles=(),
                    departments=(),
                    groups=(),
                    campus_scope=None,
                    cohort=None,
                    major=None,
                    program=None,
                ),
                authorization=AuthorizationProjection(
                    principal_id="",
                    entitlement_snapshot_id="",
                    entitlement_groups=(),
                    visibility_scope=None,
                    applicability_scope=None,
                    ownership_scopes=(),
                    approval_state="",
                    retrieval_filter=AuthorizedRetrievalFilter(
                        entitlement_groups=(),
                        visibility_level="public",
                        acl_groups=(),
                        visibility_scope=None,
                        campus_scope=None,
                        policy_projection_version="phase1-authorization-projection-v1",
                    ),
                ),
                profile_memory=ProfileMemorySummary(items=()),
                session=SessionSummary(confirmed_slots=(), turn_count=0),
            ),
        )

    def test_supervisor_request_accepts_typed_context_projection(self) -> None:
        request = SupervisorRequest(
            user_goal="保研政策怎么准备？",
            context=ContextProjection(
                actor=ActorContext(
                    user_id="student-001",
                    principal_id="principal-001",
                    roles=("student",),
                    groups=("students",),
                    campus_scope="north",
                    cohort="2023",
                    major="philosophy",
                ),
                authorization=AuthorizationProjection(
                    principal_id="principal-001",
                    entitlement_snapshot_id="entitlements-2026-03-29",
                    entitlement_groups=("students",),
                    visibility_scope="north",
                    applicability_scope="undergraduate",
                    ownership_scopes=("conversation:student-001",),
                    approval_state="not_required",
                    retrieval_filter=AuthorizedRetrievalFilter(
                        entitlement_groups=("students",),
                        visibility_level="public",
                        acl_groups=("students",),
                        visibility_scope="north",
                        campus_scope="north",
                        policy_projection_version="phase1-authorization-projection-v1",
                    ),
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
                    turn_count=3,
                ),
            ),
        )

        self.assertEqual(request.actor.user_id, "student-001")
        self.assertEqual(request.context.actor.major, "philosophy")
        self.assertEqual(request.context.authorization.entitlement_snapshot_id, "entitlements-2026-03-29")
        self.assertEqual(
            request.context.authorization.retrieval_filter.entitlement_groups,
            ("students",),
        )
        self.assertEqual(request.context.authorization.retrieval_filter.visibility_level, "public")
        self.assertEqual(request.context.authorization.retrieval_filter.acl_groups, ("students",))
        self.assertEqual(request.context.profile_memory.items[0].value, "咨询保研")
        self.assertEqual(request.context.session.confirmed_slots[0].value, "推免资格")

    def test_supervisor_request_actor_only_no_longer_projects_authorization_filter(self) -> None:
        request = SupervisorRequest(
            user_goal="保研政策怎么准备？",
            actor=ActorContext(
                user_id="student-001",
                principal_id="principal-001",
                groups=("students",),
                campus_scope="north",
            ),
        )

        self.assertEqual(
            request.context.authorization,
            AuthorizationProjection(
                principal_id="",
                entitlement_snapshot_id="",
                entitlement_groups=(),
                visibility_scope=None,
                applicability_scope=None,
                ownership_scopes=(),
                approval_state="",
                retrieval_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=(),
                    visibility_level="public",
                    acl_groups=(),
                    visibility_scope=None,
                    campus_scope=None,
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            ),
        )

    def test_authorized_retrieval_filter_does_not_backfill_projection_and_legacy_fields(self) -> None:
        projection_first = AuthorizedRetrievalFilter(
            entitlement_groups=("students",),
            visibility_scope="north",
        )
        legacy_first = AuthorizedRetrievalFilter(
            acl_groups=("staff",),
            campus_scope="south",
        )

        self.assertEqual(projection_first.entitlement_groups, ("students",))
        self.assertEqual(projection_first.acl_groups, ())
        self.assertEqual(projection_first.visibility_scope, "north")
        self.assertIsNone(projection_first.campus_scope)
        self.assertEqual(projection_first.visibility_level, "public")
        self.assertEqual(
            projection_first.policy_projection_version,
            "phase1-authorization-projection-v1",
        )

        self.assertEqual(legacy_first.entitlement_groups, ())
        self.assertEqual(legacy_first.acl_groups, ("staff",))
        self.assertIsNone(legacy_first.visibility_scope)
        self.assertEqual(legacy_first.campus_scope, "south")
        self.assertEqual(legacy_first.visibility_level, "public")
        self.assertEqual(
            legacy_first.policy_projection_version,
            "phase1-authorization-projection-v1",
        )

    def test_rag_result_diagnostics_course_fields_are_serializable(self) -> None:
        diagnostics = RagResultDiagnostics(
            resolution_mode="resolved_family",
            resolved_entity_type="course_family",
            resolved_course_id="course:muc.xigai",
            resolved_course_title="习近平新时代中国特色社会主义思想概论",
            resolved_course_family_id="course_family:muc.ideological_political_theory",
            resolved_course_family_title="思想政治理论课",
            unsupported_fields=("offering_unit",),
            partial_answer=True,
        )

        self.assertEqual(
            asdict(diagnostics),
            {
                "resolved_policy_document_id": "",
                "resolved_policy_title": "",
                "rewritten_query": "",
                "clarification_reason": "",
                "no_answer_reason": "",
                "retrieved_title_summary": (),
                "resolution_mode": "resolved_family",
                "resolved_entity_type": "course_family",
                "resolved_course_id": "course:muc.xigai",
                "resolved_course_title": "习近平新时代中国特色社会主义思想概论",
                "resolved_course_family_id": "course_family:muc.ideological_political_theory",
                "resolved_course_family_title": "思想政治理论课",
                "resolved_program_family_id": "",
                "resolved_program_family_title": "",
                "unsupported_fields": ("offering_unit",),
                "partial_answer": True,
            },
        )

    def test_rag_result_diagnostics_exposes_program_family_fields(self) -> None:
        field_names = {field.name for field in fields(RagResultDiagnostics)}

        self.assertIn("resolved_program_family_id", field_names)
        self.assertIn("resolved_program_family_title", field_names)
    def test_specialist_request_requires_explicit_payload(self) -> None:
        request = SpecialistRequest(
            target="rag-specialist",
            user_goal="library hours",
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
            ),
        )

        self.assertEqual(request.conversation_id, "")
        self.assertEqual(request.request_id, "")
        self.assertEqual(
            request.payload,
            RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
            ),
        )
        self.assertEqual(request.context.actor, ActorContext())

    def test_contract_request_shape_no_longer_owns_scope_catalog_validation(self) -> None:
        request = SpecialistRequest(
            target="rag-specialist",
            user_goal="library hours",
            payload=RagRequestPayload(
                scope=KnowledgeScope(
                    corpus="regulations",
                    collection="curriculum_plan",
                )
            )
        )

        self.assertEqual(request.payload.scope.corpus, "regulations")
        self.assertEqual(request.payload.scope.collection, "curriculum_plan")
    def test_request_accepts_offline_campus_services_scope(self) -> None:
        request = SpecialistRequest(
            target="rag-specialist",
            user_goal="校园110电话是多少？",
            payload=RagRequestPayload(
                scope=KnowledgeScope(
                    corpus="campus_services",
                    collection="contact_directory",
                )
            ),
        )

        self.assertEqual(request.payload.scope.corpus, "campus_services")
        self.assertEqual(request.payload.scope.collection, "contact_directory")

    def test_response_serializes_rag_result_shape(self) -> None:
        response = SpecialistResponse(
            target="rag-specialist",
            status="completed",
            answer_text="The library is open.",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    query_text="library hours",
                    corpus="regulations",
                    collection="student_handbook",
                    sources=(
                        EvidenceSource(
                            doc_id="doc-library-hours",
                            revision_track="source-faithful",
                            version_id="v2026-03-19",
                            chunk_id="chunk-001",
                            anchor={"section": "hours"},
                            acl_level="public",
                            canonical_url="https://campus.example/library#hours",
                            latest_url="https://campus.example/library#hours",
                            source_channel="pdf_ocr",
                            collection="student_handbook",
                            is_current=False,
                            snippet="The library is open from 08:00 to 22:00.",
                            score=0.98,
                            source_title="Library Hours Policy",
                            structural_path=("Chapter 1", "Opening Hours"),
                            content_kind="text",
                            content_role="time_rule",
                            detail_label="Article 3",
                            is_answer_bearing=True,
                        ),
                    ),
                )
            ),
        )

        payload = asdict(response)

        self.assertEqual(payload["target"], "rag-specialist")
        self.assertEqual(payload["status"], "completed")
        self.assertEqual(payload["confidence"], "high")
        self.assertEqual(payload["result"]["evidence"]["corpus"], "regulations")
        self.assertEqual(payload["result"]["evidence"]["collection"], "student_handbook")
        self.assertEqual(
            payload["result"]["evidence"]["sources"][0]["canonical_url"],
            "https://campus.example/library#hours",
        )
        self.assertEqual(
            payload["result"]["evidence"]["sources"][0]["source_title"],
            "Library Hours Policy",
        )
        self.assertEqual(
            tuple(payload["result"]["evidence"]["sources"][0]["structural_path"]),
            ("Chapter 1", "Opening Hours"),
        )
        self.assertEqual(payload["result"]["evidence"]["sources"][0]["content_role"], "time_rule")
        self.assertTrue(payload["result"]["evidence"]["sources"][0]["is_answer_bearing"])
        self.assertEqual(
            tuple(field.name for field in fields(SpecialistResponse)),
            (
                "target",
                "status",
                "answer_text",
                "follow_up_question",
                "confidence",
                "result",
                "error",
            ),
        )

    def test_response_serializes_availability_observation_shape(self) -> None:
        response = SpecialistResponse(
            target="availability-specialist",
            status="completed",
            answer_text="official-homepage timed out during the latest probe.",
            result=AvailabilityObservation(
                target_id="official-homepage",
                observed_status="timeout",
                http_status=None,
                final_url="https://campus.example/official-homepage",
                redirect_chain=(),
                failure_classification="timeout",
            ),
        )

        payload = asdict(response)

        self.assertEqual(payload["target"], "availability-specialist")
        self.assertEqual(payload["result"]["observed_status"], "timeout")
        self.assertEqual(payload["result"]["failure_classification"], "timeout")

    def test_response_serializes_rag_result_diagnostics_shape(self) -> None:
        response = SpecialistResponse(
            target="rag-specialist",
            status="no_answer",
            confidence="low",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    query_text="国奖看第一作者单位吗？",
                    corpus="regulations",
                    collection="student_handbook",
                ),
                diagnostics=RagResultDiagnostics(
                    resolved_policy_document_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                    resolved_policy_title="中央民族大学本科学生国家奖学金评审办法",
                    rewritten_query="中央民族大学本科学生国家奖学金评审办法 国奖看第一作者单位吗？",
                    clarification_reason="",
                    no_answer_reason="resolved_policy_clause_not_found",
                    retrieved_title_summary=("中央民族大学本科学生国家奖学金评审办法",),
                ),
            ),
        )

        payload = asdict(response)

        self.assertEqual(
            payload["result"]["diagnostics"]["resolved_policy_title"],
            "中央民族大学本科学生国家奖学金评审办法",
        )
        self.assertEqual(
            payload["result"]["diagnostics"]["no_answer_reason"],
            "resolved_policy_clause_not_found",
        )
        self.assertEqual(
            tuple(payload["result"]["diagnostics"]["retrieved_title_summary"]),
            ("中央民族大学本科学生国家奖学金评审办法",),
        )

    def test_supervisor_response_serializes_selected_target_and_context_free_shape(self) -> None:
        response = SupervisorResponse(
            selected_target="rag-specialist",
            status="needs_clarification",
            follow_up_question="请说明你想咨询哪一类奖学金。",
            confidence="low",
        )

        payload = asdict(response)

        self.assertEqual(payload["selected_target"], "rag-specialist")
        self.assertEqual(payload["status"], "needs_clarification")
        self.assertEqual(payload["follow_up_question"], "请说明你想咨询哪一类奖学金。")
        self.assertNotIn("target", payload)

    def test_availability_request_payload_serializes(self) -> None:
        request = SpecialistRequest(
            target="availability-specialist",
            user_goal="检查官网是否可访问",
            payload=AvailabilityCheckPayload(
                target_id="official-homepage",
                follow_redirects=False,
            ),
        )

        self.assertEqual(
            asdict(request)["payload"],
            {
                "target_id": "official-homepage",
                "follow_redirects": False,
            },
        )

    def test_specialist_request_rejects_missing_payload(self) -> None:
        with self.assertRaises(TypeError):
            SpecialistRequest(  # type: ignore[call-arg]
                target="rag-specialist",
                user_goal="library hours",
            )

    def test_document_ref_and_error_defaults_are_stable(self) -> None:
        document_ref = DocumentRef(
            document_id="handbook:test-001",
            revision_track="source-faithful",
            version_id="v1:test-001",
            corpus="regulations",
            collection="student_handbook",
            source_uri="https://campus.example/docs/test-001",
            content_hash="sha256:test-001",
        )
        error = ErrorInfo(code="retrieval_failed", message="Qdrant timeout")

        self.assertEqual(document_ref.corpus, "regulations")
        self.assertEqual(document_ref.collection, "student_handbook")
        self.assertFalse(error.retryable)
        self.assertEqual(asdict(error)["message"], "Qdrant timeout")

    def test_document_ref_accepts_campus_services_collections(self) -> None:
        navigation_ref = DocumentRef(
            document_id="service:catalog-001",
            revision_track="source-faithful",
            version_id="v1:catalog-001",
            corpus="campus_services",
            collection="service_catalog",
            source_uri="https://service.muc.edu.cn/v2/site/index",
            content_hash="sha256:catalog-001",
        )
        contact_ref = DocumentRef(
            document_id="service:contact-001",
            revision_track="source-faithful",
            version_id="v1:contact-001",
            corpus="campus_services",
            collection="contact_directory",
            source_uri="campus-agent://campus_services/contact_directory/docs/service:contact-001",
            content_hash="sha256:contact-001",
        )

        self.assertEqual(navigation_ref.corpus, "campus_services")
        self.assertEqual(navigation_ref.collection, "service_catalog")
        self.assertEqual(contact_ref.collection, "contact_directory")


if __name__ == "__main__":
    unittest.main()
