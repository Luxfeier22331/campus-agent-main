from __future__ import annotations

from dataclasses import asdict, fields
import unittest

from campus_contracts import (
    ActorContext,
    AuthorizedRetrievalFilter,
    AuthorizationProjection,
    AvailabilityCheckPayload,
    AvailabilityObservation,
    ClaimSupport,
    ContextProjection,
    CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
    CURRICULUM_PROGRAM_SLOT_NAME,
    CURRICULUM_SEMESTER_SLOT_NAME,
    CurriculumFollowUpSlots,
    DocumentRef,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    GeoPoint,
    KnowledgeScope,
    PlaceCandidate,
    PlaceCard,
    PlaceLookupPayload,
    PlaceLookupResult,
    PlaceRef,
    ProfileMemoryItem,
    ProfileMemorySummary,
    RagResultDiagnostics,
    SessionSlot,
    SessionSummary,
    RagRequestPayload,
    RagResultPayload,
    SourceTrustSummary,
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
                        visibility_scope=None,
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
                    principal_type="student",
                    roles=("student",),
                    cohort="2023",
                    major="philosophy",
                ),
                authorization=AuthorizationProjection(
                    principal_id="principal-001",
                    projection_source="campus_identity",
                    entitlement_snapshot_id="entitlements-2026-03-29",
                    entitlement_groups=("students",),
                    visibility_scope="north",
                    applicability_scope="undergraduate",
                    ownership_scopes=("conversation:student-001",),
                    approval_state="not_required",
                    retrieval_filter=AuthorizedRetrievalFilter(
                        entitlement_groups=("students",),
                        visibility_level="public",
                        visibility_scope="north",
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
        self.assertEqual(request.context.actor.principal_type, "student")
        self.assertEqual(request.context.authorization.entitlement_snapshot_id, "entitlements-2026-03-29")
        self.assertEqual(request.context.authorization.projection_source, "campus_identity")
        self.assertEqual(
            request.context.authorization.retrieval_filter.entitlement_groups,
            ("students",),
        )
        self.assertEqual(request.context.authorization.retrieval_filter.visibility_level, "public")
        self.assertEqual(request.context.profile_memory.items[0].value, "咨询保研")
        self.assertEqual(request.context.session.confirmed_slots[0].value, "推免资格")

    def test_session_summary_exposes_curriculum_follow_up_slots_with_last_confirmed_precedence(self) -> None:
        summary = SessionSummary(
            confirmed_slots=(
                SessionSlot(name=CURRICULUM_PROGRAM_FAMILY_SLOT_NAME, value="民族实验班", confirmed=True),
                SessionSlot(name=CURRICULUM_SEMESTER_SLOT_NAME, value="第二学期", confirmed=True),
                SessionSlot(name=CURRICULUM_PROGRAM_SLOT_NAME, value="新闻学民族实验班", confirmed=False),
                SessionSlot(name=CURRICULUM_PROGRAM_SLOT_NAME, value="法学民族实验班", confirmed=True),
                SessionSlot(name=CURRICULUM_SEMESTER_SLOT_NAME, value="第四学期", confirmed=True),
            ),
            turn_count=3,
        )

        self.assertEqual(
            summary.curriculum_follow_up,
            CurriculumFollowUpSlots(
                program_family="民族实验班",
                program="法学民族实验班",
                semester="第四学期",
            ),
        )

    def test_supervisor_request_actor_only_no_longer_projects_authorization_filter(self) -> None:
        request = SupervisorRequest(
            user_goal="保研政策怎么准备？",
            actor=ActorContext(
                user_id="student-001",
                principal_id="principal-001",
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
                    visibility_scope=None,
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            ),
        )

    def test_authorized_retrieval_filter_rejects_non_canonical_fields(self) -> None:
        projection_first = AuthorizedRetrievalFilter(
            entitlement_groups=("students",),
            visibility_scope="north",
        )
        field_names = {field.name for field in fields(AuthorizedRetrievalFilter)}

        self.assertEqual(projection_first.entitlement_groups, ("students",))
        self.assertEqual(projection_first.visibility_scope, "north")
        self.assertEqual(projection_first.visibility_level, "public")
        self.assertEqual(
            projection_first.policy_projection_version,
            "phase1-authorization-projection-v1",
        )
        self.assertNotIn("acl_groups", field_names)
        self.assertNotIn("campus_scope", field_names)
        with self.assertRaises(TypeError):
            AuthorizedRetrievalFilter(acl_groups=("staff",))
        with self.assertRaises(TypeError):
            AuthorizedRetrievalFilter(campus_scope="south")

    def test_actor_context_rejects_non_canonical_identity_fields(self) -> None:
        field_names = {field.name for field in fields(ActorContext)}

        self.assertNotIn("groups", field_names)
        self.assertNotIn("campus_scope", field_names)
        with self.assertRaises(TypeError):
            ActorContext(groups=("students",))
        with self.assertRaises(TypeError):
            ActorContext(campus_scope="north")

    def test_rag_result_diagnostics_course_fields_are_serializable(self) -> None:
        diagnostics = RagResultDiagnostics(
            resolution_mode="resolved_family",
            resolved_entity_type="course_family",
            resolved_course_id="course:muc.xigai",
            resolved_course_title="习近平新时代中国特色社会主义思想概论",
            resolved_course_family_id="course_family:muc.ideological_political_theory",
            resolved_course_family_title="思想政治理论课",
            claim_supports=(
                ClaimSupport(
                    claim_type="offering_unit_or_owning_school",
                    claim_text="马克思主义学院",
                    supported=False,
                    support_source_doc_id="",
                    support_snippet="",
                ),
            ),
            unsupported_fields=("offering_unit",),
            partial_answer=True,
        )

        self.assertEqual(
            asdict(diagnostics),
            {
                "resolved_scope_corpus": None,
                "resolved_scope_collection": "",
                "resolved_policy_document_id": "",
                "resolved_policy_title": "",
                "rewritten_query": "",
                "clarification_reason": "",
                "no_answer_reason": "",
                "semantic_outcome": "",
                "retrieval_adequacy_verdict": "",
                "retrieval_adequacy_reason": "",
                "grounding_verdict": "",
                "grounding_downgraded": False,
                "freshness_fail_closed": False,
                "scope_class": "",
                "policy_reason": "",
                "retrieved_title_summary": (),
                "candidate_title_summary": (),
                "resolution_mode": "resolved_family",
                "used_verified_identity": False,
                "used_soft_preference": False,
                "resolved_entity_type": "course_family",
                "resolved_course_id": "course:muc.xigai",
                "resolved_course_title": "习近平新时代中国特色社会主义思想概论",
                "resolved_course_family_id": "course_family:muc.ideological_political_theory",
                "resolved_course_family_title": "思想政治理论课",
                "resolved_program_family_id": "",
                "resolved_program_family_title": "",
                "session_program_family": "",
                "session_program": "",
                "session_semester": "",
                "source_trust_summary": None,
                "claim_supports": (
                    {
                        "claim_type": "offering_unit_or_owning_school",
                        "claim_text": "马克思主义学院",
                        "required_source_trust_tier": "",
                        "supported": False,
                        "support_source_doc_id": "",
                        "support_snippet": "",
                        "support_source_trust_tier": "",
                    },
                ),
                "unsupported_fields": ("offering_unit",),
                "partial_answer": True,
                "prompt_runtime_state": "",
                "prompt_runtime_detail": "",
                "retrieved_sources": (),
                "prompt_trace": None,
            },
        )

    def test_rag_result_diagnostics_exposes_program_family_fields(self) -> None:
        field_names = {field.name for field in fields(RagResultDiagnostics)}

        self.assertIn("resolved_program_family_id", field_names)
        self.assertIn("resolved_program_family_title", field_names)
        self.assertIn("session_program_family", field_names)
        self.assertIn("session_program", field_names)
        self.assertIn("session_semester", field_names)
        self.assertIn("claim_supports", field_names)
        self.assertIn("candidate_title_summary", field_names)
        self.assertIn("used_verified_identity", field_names)
        self.assertIn("used_soft_preference", field_names)
        self.assertIn("retrieval_adequacy_verdict", field_names)
        self.assertIn("retrieval_adequacy_reason", field_names)
        self.assertIn("grounding_verdict", field_names)
        self.assertIn("grounding_downgraded", field_names)
        self.assertIn("freshness_fail_closed", field_names)
        self.assertIn("prompt_runtime_state", field_names)
        self.assertIn("prompt_runtime_detail", field_names)
        self.assertIn("source_trust_summary", field_names)

    def test_evidence_bundle_infers_canonical_source_trust_tier_from_collection(self) -> None:
        source = EvidenceSource(
            doc_id="curriculum:law-ethnic-experimental",
            revision_track="source-faithful",
            version_id="v1:semester-4",
            chunk_id="curriculum:law-ethnic-experimental:semester-4:chunk-0001",
            anchor={"page_start": 1, "page_end": 1},
            canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
            latest_url="https://campus.example/curriculum/law-ethnic-experimental",
            source_channel="pdf_ocr",
            collection="curriculum_plan",
            is_current=False,
            snippet="第四学期开设习近平新时代中国特色社会主义思想概论。",
            score=0.94,
            source_title="法学（民族实验班）本科人才培养方案",
            is_answer_bearing=True,
        )

        EvidenceBundle(
            corpus="curriculum",
            collection="curriculum_plan",
            query_text="法学民族班大二下有什么课",
            sources=(source,),
        )

        self.assertEqual(source.source_trust_tier, "T0")

    def test_evidence_source_rejects_t0_derived_as_contract_enum_value(self) -> None:
        with self.assertRaises(ValueError):
            EvidenceSource(
                doc_id="curriculum:law-ethnic-experimental",
                revision_track="source-faithful",
                version_id="v1:semester-4",
                chunk_id="curriculum:law-ethnic-experimental:semester-4:chunk-0001",
                anchor={"page_start": 1, "page_end": 1},
                canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
                latest_url="https://campus.example/curriculum/law-ethnic-experimental",
                source_channel="pdf_ocr",
                collection="curriculum_plan",
                is_current=False,
                snippet="第四学期开设习近平新时代中国特色社会主义思想概论。",
                score=0.94,
                source_title="法学（民族实验班）本科人才培养方案",
                source_trust_tier="T0-derived",
            )

    def test_source_trust_summary_serializes_as_contract_field(self) -> None:
        diagnostics = RagResultDiagnostics(
            source_trust_summary=SourceTrustSummary(
                observed_tiers=("T0", "T1"),
                answer_bearing_tiers=("T0",),
                blocked_claim_types=("freshness_sensitive_status",),
                freshness_claim_blocked=True,
                authorization_claim_blocked=False,
            )
        )

        self.assertEqual(
            asdict(diagnostics)["source_trust_summary"],
            {
                "observed_tiers": ("T0", "T1"),
                "answer_bearing_tiers": ("T0",),
                "blocked_claim_types": ("freshness_sensitive_status",),
                "freshness_claim_blocked": True,
                "authorization_claim_blocked": False,
            },
        )
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
        self.assertNotIn("acl_level", payload["result"]["evidence"]["sources"][0])

    def test_evidence_source_serializes_canonical_and_unit_identity_fields(self) -> None:
        source = EvidenceSource(
            doc_id="program_semester_facts:law-ethnic-experimental:semester-4",
            revision_track="source-faithful",
            version_id="v2026-04-12",
            chunk_id="program_semester_facts:law-ethnic-experimental:semester-4:row-0001",
            anchor={"section": "semester_course_list"},
            canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
            latest_url="https://campus.example/curriculum/law-ethnic-experimental",
            source_channel="pdf_ocr",
            collection="program_semester_facts",
            is_current=False,
            snippet="第四学期有中国少数民族文字学、侵权责任法。",
            score=0.98,
            source_title="法学（民族实验班）本科人才培养方案 第四学期课程事实",
            canonical_source_id="curriculum:法学（民族实验班）本科人才培养方案",
            canonical_source_title="法学（民族实验班）本科人才培养方案",
            source_unit_kind="semester_course_list",
            source_unit_key="semester-4",
        )

        payload = asdict(source)

        self.assertEqual(payload["canonical_source_id"], "curriculum:法学（民族实验班）本科人才培养方案")
        self.assertEqual(payload["canonical_source_title"], "法学（民族实验班）本科人才培养方案")
        self.assertEqual(payload["source_unit_kind"], "semester_course_list")
        self.assertEqual(payload["source_unit_key"], "semester-4")

    def test_evidence_source_rejects_non_canonical_fields(self) -> None:
        field_names = {field.name for field in fields(EvidenceSource)}

        self.assertNotIn("acl_level", field_names)
        with self.assertRaises(TypeError):
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
            )
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

    def test_response_serializes_place_lookup_result_shape(self) -> None:
        response = SpecialistResponse(
            target="navigation-specialist",
            status="completed",
            answer_text="图书馆在海淀校区主教学区西侧，靠近校医院。",
            confidence="high",
            result=PlaceLookupResult(
                query_text="图书馆在哪里",
                matched_alias="图书馆",
                resolved_place=PlaceRef(
                    place_id="muc.haidian.library",
                    entity_type="building",
                    display_name="图书馆",
                    campus_scope="haidian",
                    campus_area="主教学区西侧",
                ),
                place_card=PlaceCard(
                    place=PlaceRef(
                        place_id="muc.haidian.library",
                        entity_type="building",
                        display_name="图书馆",
                        campus_scope="haidian",
                        campus_area="主教学区西侧",
                    ),
                    location_description="海淀校区主教学区西侧，靠近校医院。",
                    landmark_hint="从知行广场向西步行约 3 分钟可到达。",
                    access_note="校外访客请先完成入校登记。",
                    service_tags=("自习", "借阅", "打印"),
                    coordinate_reference_system="EPSG:4326",
                    point_geometry=GeoPoint(
                        longitude=116.31551,
                        latitude=39.96162,
                    ),
                    source_refs=("seed:campus_navigation/place_catalog.v1",),
                ),
            ),
        )

        payload = asdict(response)

        self.assertEqual(payload["target"], "navigation-specialist")
        self.assertEqual(payload["result"]["query_text"], "图书馆在哪里")
        self.assertEqual(payload["result"]["matched_alias"], "图书馆")
        self.assertEqual(payload["result"]["resolved_place"]["place_id"], "muc.haidian.library")
        self.assertEqual(payload["result"]["place_card"]["place"]["entity_type"], "building")
        self.assertEqual(payload["result"]["place_card"]["point_geometry"]["longitude"], 116.31551)
        self.assertEqual(payload["result"]["place_card"]["coordinate_reference_system"], "EPSG:4326")
        self.assertEqual(
            tuple(payload["result"]["place_card"]["service_tags"]),
            ("自习", "借阅", "打印"),
        )

    def test_response_serializes_place_lookup_clarification_candidates(self) -> None:
        response = SpecialistResponse(
            target="navigation-specialist",
            status="needs_clarification",
            follow_up_question="你要找海淀校区图书馆，还是丰台校区图书馆？",
            confidence="medium",
            result=PlaceLookupResult(
                query_text="图书馆在哪里",
                matched_alias="图书馆",
                candidate_places=(
                    PlaceCandidate(
                        place=PlaceRef(
                            place_id="muc.haidian.library",
                            entity_type="building",
                            display_name="海淀校区图书馆",
                            campus_scope="haidian",
                            campus_area="主教学区西侧",
                        ),
                        clarification_hint="海淀校区主教学区西侧",
                    ),
                    PlaceCandidate(
                        place=PlaceRef(
                            place_id="muc.fengtai.library",
                            entity_type="building",
                            display_name="丰台校区图书馆",
                            campus_scope="fengtai",
                            campus_area="学生活动区北侧",
                        ),
                        clarification_hint="丰台校区学生活动区北侧",
                    ),
                ),
            ),
        )

        payload = asdict(response)

        self.assertEqual(payload["target"], "navigation-specialist")
        self.assertEqual(len(payload["result"]["candidate_places"]), 2)
        self.assertEqual(
            payload["result"]["candidate_places"][1]["place"]["display_name"],
            "丰台校区图书馆",
        )

    def test_response_serializes_place_lookup_result_without_point_geometry(self) -> None:
        response = SpecialistResponse(
            target="navigation-specialist",
            status="completed",
            answer_text="民族博物馆在海淀校区西侧，靠近图书馆。",
            confidence="high",
            result=PlaceLookupResult(
                query_text="民族博物馆在哪里",
                matched_alias="民族博物馆",
                resolved_place=PlaceRef(
                    place_id="muc.haidian.museum",
                    entity_type="building",
                    display_name="民族博物馆",
                    campus_scope="haidian",
                    campus_area="海淀校区西侧",
                ),
                place_card=PlaceCard(
                    place=PlaceRef(
                        place_id="muc.haidian.museum",
                        entity_type="building",
                        display_name="民族博物馆",
                        campus_scope="haidian",
                        campus_area="海淀校区西侧",
                    ),
                    location_description="海淀校区西侧，靠近图书馆。",
                    source_refs=(
                        "seed:campus_navigation/place_catalog.v1",
                        "https://www.muc.edu.cn/xxgk1/xydt.htm",
                    ),
                ),
            ),
        )

        payload = asdict(response)

        self.assertEqual(payload["result"]["place_card"]["point_geometry"], None)
        self.assertEqual(payload["result"]["place_card"]["coordinate_reference_system"], "")

    def test_place_lookup_payload_requires_non_empty_query(self) -> None:
        with self.assertRaisesRegex(ValueError, "query_text must not be empty"):
            PlaceLookupPayload(query_text=" ")

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
                    semantic_outcome="unsupported_by_evidence",
                    scope_class="in_scope",
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
            payload["result"]["diagnostics"]["semantic_outcome"],
            "unsupported_by_evidence",
        )
        self.assertEqual(
            payload["result"]["diagnostics"]["scope_class"],
            "in_scope",
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
