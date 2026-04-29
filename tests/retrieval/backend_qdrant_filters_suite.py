from __future__ import annotations

from tests.retrieval.backend_qdrant_test_support import (
    STUDENT_HANDBOOK_QDRANT_COLLECTION,
    AuthorizedRetrievalFilter,
    ChunkProfile,
    InMemoryDocumentRegistry,
    MockEmbeddingSettings,
    MockSparseEmbeddingSettings,
    PersonalizationHint,
    QdrantClient,
    QdrantRetrievalBackend,
    RestrictedDocumentAccessDeniedError,
    RetrievalRequest,
    RetrievalSettings,
    _apply_preferred_document_bias,
    _authorized_filter,
    _build_metadata_filters,
    _build_qdrant_filter,
    _collect_filter_keys,
    _collect_qdrant_filter_keys,
    _make_registry_record,
    _make_source,
    _make_structured_jsonl_with_entitlement_groups,
    build_indexable_chunks_from_jsonl,
    build_mock_embedding_model,
    build_mock_sparse_embedding_model,
    index_chunks_to_qdrant,
    replace,
    unittest,
)


class BackendQdrantFiltersTest(unittest.TestCase):
    def test_build_metadata_filters_treats_public_visibility_as_public_level(self) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="library hours",
                corpus="regulations",
                collection="student_rules",
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=("students",),
                    visibility_level="public",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            )
        )

        self.assertEqual(filters.condition.value, "and")
        self.assertEqual(len(filters.filters), 5)
        self.assertEqual(filters.filters[0].key, "corpus")
        self.assertEqual(filters.filters[0].value, "regulations")
        self.assertEqual(filters.filters[1].key, "collection")
        self.assertEqual(filters.filters[1].value, "student_rules")
        self.assertEqual(filters.filters[2].key, "revision_track")
        self.assertEqual(filters.filters[2].operator.value, "in")
        self.assertEqual(filters.filters[2].value, ["current-effective", "source-faithful"])
        self.assertEqual(filters.filters[3].key, "status")
        self.assertEqual(filters.filters[3].value, "active")
        authz_filter = filters.filters[4]
        self.assertEqual(authz_filter.condition.value, "or")
        auth_keys = _collect_filter_keys(authz_filter)
        self.assertIn("visibility_level", auth_keys)
        self.assertIn("entitlement_groups", auth_keys)
        self.assertNotIn("acl_level", auth_keys)
        self.assertNotIn("acl_groups", auth_keys)

    def test_build_metadata_filters_ignore_personalization_hint_for_authz_and_serving_scope(
        self,
    ) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="保研流程",
                corpus="regulations",
                collection="student_rules",
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=("students",),
                    visibility_level="public",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
                personalization_hint=PersonalizationHint(
                    actor_claim_terms=("2023 cohort", "philosophy major"),
                    recent_goal="咨询保研",
                    confirmed_slot_terms=("推免资格",),
                ),
            )
        )

        self.assertEqual(filters.condition.value, "and")
        self.assertEqual(len(filters.filters), 5)
        self.assertEqual(filters.filters[0].key, "corpus")
        self.assertEqual(filters.filters[1].key, "collection")
        self.assertEqual(filters.filters[2].key, "revision_track")
        self.assertEqual(filters.filters[3].key, "status")
        authz_filter = filters.filters[4]
        self.assertEqual(authz_filter.condition.value, "or")
        auth_keys = _collect_filter_keys(authz_filter)
        self.assertIn("visibility_level", auth_keys)
        self.assertIn("entitlement_groups", auth_keys)

    def test_build_metadata_filters_prefers_authorized_filter_fields(self) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="library hours",
                corpus="regulations",
                collection="student_rules",
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=("students",),
                    visibility_level="public",
                    visibility_scope="north",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            )
        )

        authz_filter = filters.filters[4]
        auth_keys = _collect_filter_keys(authz_filter)
        self.assertIn("entitlement_groups", auth_keys)
        self.assertIn("visibility_scope", auth_keys)
        self.assertNotIn("campus_scope", auth_keys)

    def test_build_metadata_filters_uses_projection_payload_keys(self) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="保研流程",
                corpus="regulations",
                collection="student_rules",
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=("students",),
                    visibility_level="public",
                    visibility_scope="north",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            )
        )

        auth_filter = filters.filters[4]
        auth_keys = _collect_filter_keys(auth_filter)
        self.assertIn("visibility_level", auth_keys)
        self.assertIn("entitlement_groups", auth_keys)
        self.assertIn("visibility_scope", auth_keys)

    def test_build_metadata_filters_omit_entitlement_group_predicates_when_authorized_filter_has_no_entitlement_groups(
        self,
    ) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="library hours",
                corpus="regulations",
                collection="student_rules",
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=(),
                    visibility_level="public",
                    visibility_scope="north",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            )
        )

        authz_filter = filters.filters[4]
        auth_keys = _collect_filter_keys(authz_filter)
        self.assertIn("visibility_level", auth_keys)
        self.assertNotIn("acl_level", auth_keys)
        self.assertNotIn("entitlement_groups", auth_keys)
        self.assertNotIn("acl_groups", auth_keys)

    def test_build_qdrant_filter_omits_entitlement_group_predicates_when_authorized_filter_has_no_entitlement_groups(
        self,
    ) -> None:
        qdrant_filter = _build_qdrant_filter(
            RetrievalRequest(
                query_text="library hours",
                corpus="regulations",
                collection="student_rules",
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=(),
                    visibility_level="public",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            )
        )

        auth_filter = qdrant_filter.must[3]
        auth_keys = _collect_qdrant_filter_keys(auth_filter)
        self.assertIn("visibility_level", auth_keys)
        self.assertNotIn("acl_level", auth_keys)
        self.assertNotIn("entitlement_groups", auth_keys)
        self.assertNotIn("acl_groups", auth_keys)

    def test_build_qdrant_filter_applies_explicit_version_filters_before_current_only(self) -> None:
        qdrant_filter = _build_qdrant_filter(
            RetrievalRequest(
                query_text="旧版国奖评审办法",
                corpus="regulations",
                collection="student_rules",
                target_document_ids=("handbook:national-scholarship",),
                target_version_ids=("v1:national-scholarship",),
                target_revision_track="source-faithful",
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=("students",),
                    visibility_level="public",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            )
        )

        conditions = qdrant_filter.must or []
        version_conditions = [
            condition for condition in conditions if getattr(condition, "key", None) == "version_id"
        ]
        self.assertEqual(len(version_conditions), 1)
        self.assertEqual(
            getattr(getattr(version_conditions[0], "match", None), "any", None),
            ["v1:national-scholarship"],
        )
        revision_conditions = [
            condition
            for condition in conditions
            if getattr(condition, "key", None) == "revision_track"
        ]
        self.assertEqual(len(revision_conditions), 1)
        self.assertEqual(
            getattr(getattr(revision_conditions[0], "match", None), "value", None),
            "source-faithful",
        )
        self.assertFalse(
            any(getattr(condition, "key", None) == "is_current" for condition in conditions)
        )

    def test_backend_fail_closes_scoped_restricted_documents_when_request_has_no_visibility_scope(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        restricted = replace(
            _make_registry_record(
                document_id="handbook:north-campus",
                version_id="v1:north-campus",
                entitlement_groups=("students",),
            ),
            visibility_scope="north",
        )
        registry.upsert(restricted)

        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        restricted_chunks = build_indexable_chunks_from_jsonl(
            record=restricted,
            structured_jsonl_bytes=_make_structured_jsonl_with_entitlement_groups(
                document_id=restricted.document_id,
                version_id=restricted.version_id,
                text="North campus student office hours are restricted.",
                entitlement_groups=("students",),
            ),
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
            embedding_model=embedding_model,
        )

        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        index_chunks_to_qdrant(
            chunks=restricted_chunks,
            qdrant_client=backend.qdrant_client,
            collection_name=STUDENT_HANDBOOK_QDRANT_COLLECTION,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="Tell me about north campus office hours",
                corpus="regulations",
                collection="student_rules",
                authorized_filter=_authorized_filter(
                    entitlement_groups=("students",),
                    visibility_scope=None,
                ),
                top_k=5,
            )
        )

        self.assertEqual(result.sources, ())

    def test_backend_raises_access_denied_for_targeted_restricted_document_without_authorization(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        restricted = replace(
            _make_registry_record(
                document_id="handbook:restricted-notice",
                version_id="v1:restricted-notice",
                entitlement_groups=("students",),
            ),
            visibility_level="restricted",
        )
        registry.upsert(restricted)

        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        with self.assertRaises(RestrictedDocumentAccessDeniedError):
            backend.retrieve(
                RetrievalRequest(
                    query_text="这条通知写了什么？",
                    corpus="regulations",
                    collection="student_rules",
                    target_document_ids=(restricted.document_id,),
                    authorized_filter=AuthorizedRetrievalFilter(
                        entitlement_groups=(),
                        visibility_level="public",
                        visibility_scope=None,
                    ),
                )
            )

    def test_backend_raises_access_denied_when_any_targeted_document_is_restricted_without_authorization(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        allowed = _make_registry_record(
            document_id="handbook:allowed-notice",
            version_id="v1:allowed-notice",
            entitlement_groups=(),
        )
        restricted = replace(
            _make_registry_record(
                document_id="handbook:restricted-notice",
                version_id="v1:restricted-notice",
                entitlement_groups=("students",),
            ),
            visibility_level="restricted",
        )
        registry.upsert(allowed)
        registry.upsert(restricted)

        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        with self.assertRaises(RestrictedDocumentAccessDeniedError):
            backend.retrieve(
                RetrievalRequest(
                    query_text="这条通知写了什么？",
                    corpus="regulations",
                    collection="student_rules",
                    target_document_ids=(allowed.document_id, restricted.document_id),
                    authorized_filter=AuthorizedRetrievalFilter(
                        entitlement_groups=(),
                        visibility_level="public",
                        visibility_scope=None,
                    ),
                )
            )

    def test_build_qdrant_filter_adds_target_document_constraint_when_present(self) -> None:
        qdrant_filter = _build_qdrant_filter(
            RetrievalRequest(
                query_text="国奖评审办法里的论文要求是什么？",
                corpus="regulations",
                collection="student_rules",
                authorized_filter=_authorized_filter(),
                target_document_ids=(
                    "handbook:national-scholarship",
                    "handbook:professional-scholarship",
                ),
            )
        )

        document_conditions = [
            condition
            for condition in qdrant_filter.must or ()
            if getattr(condition, "key", None) == "document_id"
        ]

        self.assertEqual(len(document_conditions), 1)
        self.assertEqual(
            getattr(getattr(document_conditions[0], "match", None), "any", None),
            ["handbook:national-scholarship", "handbook:professional-scholarship"],
        )

    def test_build_metadata_filters_adds_canonical_course_filters_when_present(self) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="思政课有哪些专业要上",
                corpus="curriculum",
                collection="course_facts",
                canonical_course_ids=("course:muc.xigai",),
                canonical_course_family_ids=("course_family:muc.ideological_political_theory",),
            )
        )

        filter_keys = _collect_filter_keys(filters)
        self.assertIn("canonical_course_id", filter_keys)
        self.assertIn("canonical_course_family_id", filter_keys)

    def test_build_qdrant_filter_adds_canonical_course_constraints_when_present(self) -> None:
        qdrant_filter = _build_qdrant_filter(
            RetrievalRequest(
                query_text="思政课有哪些专业要上",
                corpus="curriculum",
                collection="course_facts",
                canonical_course_ids=("course:muc.xigai",),
                canonical_course_family_ids=("course_family:muc.ideological_political_theory",),
            )
        )

        course_conditions = [
            condition
            for condition in qdrant_filter.must or ()
            if getattr(condition, "key", None) == "canonical_course_id"
        ]
        family_conditions = [
            condition
            for condition in qdrant_filter.must or ()
            if getattr(condition, "key", None) == "canonical_course_family_id"
        ]

        self.assertEqual(len(course_conditions), 1)
        self.assertEqual(
            getattr(getattr(course_conditions[0], "match", None), "any", None),
            ["course:muc.xigai"],
        )
        self.assertEqual(len(family_conditions), 1)
        self.assertEqual(
            getattr(getattr(family_conditions[0], "match", None), "any", None),
            ["course_family:muc.ideological_political_theory"],
        )

    def test_build_metadata_filters_adds_canonical_program_family_filter_when_present(self) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="民族班有哪些",
                corpus="curriculum",
                collection="program_family_facts",
                canonical_program_family_ids=("program_family:muc.ethnic_experimental_class",),
            )
        )

        filter_keys = _collect_filter_keys(filters)
        self.assertIn("canonical_program_family_id", filter_keys)

    def test_build_qdrant_filter_adds_canonical_program_family_constraint_when_present(
        self,
    ) -> None:
        qdrant_filter = _build_qdrant_filter(
            RetrievalRequest(
                query_text="基地班有哪些",
                corpus="curriculum",
                collection="program_family_facts",
                canonical_program_family_ids=("program_family:muc.base_class",),
            )
        )

        family_conditions = [
            condition
            for condition in qdrant_filter.must or ()
            if getattr(condition, "key", None) == "canonical_program_family_id"
        ]

        self.assertEqual(len(family_conditions), 1)
        self.assertEqual(
            getattr(getattr(family_conditions[0], "match", None), "any", None),
            ["program_family:muc.base_class"],
        )

    def test_build_metadata_filters_ignore_preferred_document_ids(self) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="基地班培养方案",
                corpus="curriculum",
                collection="curriculum_plan",
                preferred_document_ids=("curriculum:历史学（强基计划）本科人才培养方案",),
            )
        )

        filter_keys = _collect_filter_keys(filters)
        self.assertNotIn("preferred_document_ids", filter_keys)
        self.assertNotIn("document_id", filter_keys)

    def test_apply_preferred_document_bias_promotes_preferred_doc_at_ranking_time(self) -> None:
        biased_sources = _apply_preferred_document_bias(
            sources=(
                _make_source(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    chunk_id="curriculum:law:chunk-0004",
                    snippet="第四学期 国际公法、知识产权法。",
                    score=0.92,
                ),
                _make_source(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    chunk_id="curriculum:history-strong-base:chunk-0004",
                    snippet="第四学期 中国史学史、史学理论专题。",
                    score=0.88,
                ),
            ),
            preferred_document_ids=("curriculum:历史学（强基计划）本科人才培养方案",),
        )

        self.assertEqual(
            [source.doc_id for source in biased_sources],
            [
                "curriculum:历史学（强基计划）本科人才培养方案",
                "curriculum:法学（民族实验班）本科人才培养方案",
            ],
        )
