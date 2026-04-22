from __future__ import annotations

from tests.contracts.contract_models_test_support import *


class ContractModelsRuntimeAndToolsSuite(unittest.TestCase):
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

    def test_remote_content_suspicion_summary_serializes_as_contract_field(self) -> None:
        diagnostics = RagResultDiagnostics(
            remote_content_suspicion_summary=RemoteContentSuspicionSummary(
                flagged_source_count=1,
                flag_labels=(
                    "prompt_override_signal",
                    "tool_or_browser_action_request",
                ),
                generation_blocked=True,
            )
        )

        self.assertEqual(
            asdict(diagnostics)["remote_content_suspicion_summary"],
            {
                "flagged_source_count": 1,
                "flag_labels": (
                    "prompt_override_signal",
                    "tool_or_browser_action_request",
                ),
                "generation_blocked": True,
            },
        )

    def test_retrieval_plan_summary_serializes_as_contract_field(self) -> None:
        diagnostics = RagResultDiagnostics(
            retrieval_plan_summary=RetrievalPlanSummary(
                plan_id="regulations:student_rules:current",
                query_mode="current",
                replan_count=0,
                terminal_state="completed",
                step_activities=(
                    RetrievalStepActivitySummary(
                        step_id="indexed-lookup",
                        step_type="indexed_lookup",
                        corpus="regulations",
                        collection="student_rules",
                        status="succeeded",
                        top_k=3,
                        latency_ms=12,
                        candidate_count=2,
                        reference_count=2,
                        failure_kind="",
                    ),
                ),
            ),
        )

        self.assertEqual(
            asdict(diagnostics)["retrieval_plan_summary"],
            {
                "plan_id": "regulations:student_rules:current",
                "query_mode": "current",
                "replan_count": 0,
                "terminal_state": "completed",
                "step_activities": (
                    {
                        "step_id": "indexed-lookup",
                        "step_type": "indexed_lookup",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "status": "succeeded",
                        "top_k": 3,
                        "latency_ms": 12,
                        "candidate_count": 2,
                        "reference_count": 2,
                        "failure_kind": "",
                    },
                ),
            },
        )

    def test_specialist_request_requires_explicit_payload(self) -> None:
        request = SpecialistRequest(
            target="rag-agent",
            user_goal="library hours",
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules")
            ),
        )

        self.assertEqual(request.conversation_id, "")
        self.assertEqual(request.request_id, "")
        self.assertEqual(
            request.payload,
            RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules")
            ),
        )
        self.assertEqual(request.context.actor, ActorContext())

    def test_version_query_requires_as_of_anchor_when_mode_is_as_of(self) -> None:
        with self.assertRaisesRegex(ValueError, "as_of is required when version mode is as_of"):
            VersionQuery(mode="as_of")

    def test_version_query_rejects_as_of_anchor_outside_as_of_mode(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "as_of is only allowed when version mode is as_of",
        ):
            VersionQuery(mode="historical", as_of="2025-09-01")

    def test_version_query_accepts_as_of_anchor_when_mode_is_as_of(self) -> None:
        query = VersionQuery(mode="as_of", as_of="2025-09-01")

        self.assertEqual(query.mode, "as_of")
        self.assertEqual(query.as_of, "2025-09-01")

    def test_version_query_accepts_exact_version_anchor_for_historical_mode(self) -> None:
        query = VersionQuery(mode="historical", version_id="v1:student-handbook")

        self.assertEqual(query.mode, "historical")
        self.assertEqual(query.version_id, "v1:student-handbook")

    def test_version_query_accepts_exact_compare_pair_for_compare_mode(self) -> None:
        query = VersionQuery(
            mode="compare",
            version_id="v1:student-handbook",
            compare_to_version_id="v2:student-handbook",
        )

        self.assertEqual(query.mode, "compare")
        self.assertEqual(query.version_id, "v1:student-handbook")
        self.assertEqual(query.compare_to_version_id, "v2:student-handbook")

    def test_version_query_rejects_compare_secondary_anchor_without_primary_version_id(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "version_id is required when compare_to_version_id is set",
        ):
            VersionQuery(mode="compare", compare_to_version_id="v2:student-handbook")

    def test_contract_request_shape_no_longer_owns_scope_catalog_validation(self) -> None:
        request = SpecialistRequest(
            target="rag-agent",
            user_goal="library hours",
            payload=RagRequestPayload(
                scope=KnowledgeScope(
                    corpus="regulations",
                    collection="curriculum_plan",
                )
            ),
        )

        self.assertEqual(request.payload.scope.corpus, "regulations")
        self.assertEqual(request.payload.scope.collection, "curriculum_plan")

    def test_request_accepts_offline_campus_services_scope(self) -> None:
        request = SpecialistRequest(
            target="rag-agent",
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
            target="rag-agent",
            status="completed",
            answer_text="The library is open.",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    query_text="library hours",
                    corpus="regulations",
                    collection="student_rules",
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
                            collection="student_rules",
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

        self.assertEqual(payload["target"], "rag-agent")
        self.assertEqual(payload["status"], "completed")
        self.assertEqual(payload["confidence"], "high")
        self.assertEqual(payload["result"]["evidence"]["corpus"], "regulations")
        self.assertEqual(payload["result"]["evidence"]["collection"], "student_rules")
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

        self.assertEqual(
            payload["canonical_source_id"], "curriculum:法学（民族实验班）本科人才培养方案"
        )
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
                collection="student_rules",
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

    def test_response_serializes_place_lookup_result_shape(self) -> None:
        response = SpecialistResponse(
            target="navigation-agent",
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

        self.assertEqual(payload["target"], "navigation-agent")
        self.assertEqual(payload["result"]["query_text"], "图书馆在哪里")
        self.assertEqual(payload["result"]["matched_alias"], "图书馆")
        self.assertEqual(payload["result"]["resolved_place"]["place_id"], "muc.haidian.library")
        self.assertEqual(payload["result"]["place_card"]["place"]["entity_type"], "building")
        self.assertEqual(payload["result"]["place_card"]["point_geometry"]["longitude"], 116.31551)
        self.assertEqual(
            payload["result"]["place_card"]["coordinate_reference_system"], "EPSG:4326"
        )
        self.assertEqual(
            tuple(payload["result"]["place_card"]["service_tags"]),
            ("自习", "借阅", "打印"),
        )

    def test_response_serializes_place_lookup_clarification_candidates(self) -> None:
        response = SpecialistResponse(
            target="navigation-agent",
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

        self.assertEqual(payload["target"], "navigation-agent")
        self.assertEqual(len(payload["result"]["candidate_places"]), 2)
        self.assertEqual(
            payload["result"]["candidate_places"][1]["place"]["display_name"],
            "丰台校区图书馆",
        )

    def test_response_serializes_place_lookup_result_without_point_geometry(self) -> None:
        response = SpecialistResponse(
            target="navigation-agent",
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
            target="rag-agent",
            status="no_answer",
            confidence="low",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    query_text="国奖看第一作者单位吗？",
                    corpus="regulations",
                    collection="student_rules",
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
            selected_target="rag-agent",
            status="needs_clarification",
            follow_up_question="请说明你想咨询哪一类奖学金。",
            confidence="low",
        )

        payload = asdict(response)

        self.assertEqual(payload["selected_target"], "rag-agent")
        self.assertEqual(payload["status"], "needs_clarification")
        self.assertEqual(payload["follow_up_question"], "请说明你想咨询哪一类奖学金。")
        self.assertNotIn("target", payload)
