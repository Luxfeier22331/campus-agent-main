from __future__ import annotations

from campus_ingestion_core.process_indexing import (
    audit_payload_indexes,
    required_payload_index_schemas,
)

from tests.retrieval.backend_qdrant_test_support import (
    STUDENT_HANDBOOK_QDRANT_COLLECTION,
    ChunkProfile,
    CorpusQueryDisabledError,
    InMemoryDocumentRegistry,
    Mock,
    MockEmbeddingSettings,
    MockSparseEmbeddingSettings,
    QdrantClient,
    QdrantRetrievalBackend,
    ResponseHandlingException,
    RetrievalBackendError,
    RetrievalRequest,
    RetrievalSettings,
    SparseEmbeddingSettings,
    _authorized_filter,
    _build_hybrid_prefetch,
    _build_qdrant_client,
    _build_rrf_query,
    _make_registry_record,
    _make_runtime_profile,
    _make_structured_jsonl,
    build_indexable_chunks_from_jsonl,
    build_mock_embedding_model,
    build_mock_sparse_embedding_model,
    build_sparse_embedding_model,
    index_chunks_to_qdrant,
    patch,
    qdrant_models,
    unittest,
    uuid,
)


class BackendQdrantClientSettingsTest(unittest.TestCase):
    def test_payload_index_audit_fails_on_missing_or_mismatched_filter_indexes(self) -> None:
        class _CollectionInfo:
            payload_schema = {
                "document_id": qdrant_models.PayloadSchemaType.KEYWORD,
                "is_current": qdrant_models.PayloadSchemaType.KEYWORD,
            }

        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_collection.return_value = _CollectionInfo()

        report = audit_payload_indexes(
            qdrant_client=qdrant_client,
            collection_name="student_rules__r20260501",
        )

        self.assertEqual(report.status, "failed")
        self.assertIn("version_id", report.missing_indexes)
        self.assertIn("is_current", report.mismatched_indexes)
        self.assertEqual(report.summary["collection_name"], "student_rules__r20260501")

    def test_payload_index_audit_passes_when_required_filter_indexes_exist(self) -> None:
        class _CollectionInfo:
            payload_schema = {
                "document_id": qdrant_models.PayloadSchemaType.KEYWORD,
                "notice_id": qdrant_models.PayloadSchemaType.KEYWORD,
                "source_notice_ids": qdrant_models.PayloadSchemaType.KEYWORD,
                "source_document_ids": qdrant_models.PayloadSchemaType.KEYWORD,
                "revision_track": qdrant_models.PayloadSchemaType.KEYWORD,
                "version_id": qdrant_models.PayloadSchemaType.KEYWORD,
                "corpus": qdrant_models.PayloadSchemaType.KEYWORD,
                "collection": qdrant_models.PayloadSchemaType.KEYWORD,
                "target_surface": qdrant_models.PayloadSchemaType.KEYWORD,
                "canonical_course_id": qdrant_models.PayloadSchemaType.KEYWORD,
                "canonical_course_family_id": qdrant_models.PayloadSchemaType.KEYWORD,
                "canonical_program_family_id": qdrant_models.PayloadSchemaType.KEYWORD,
                "visibility_scope": qdrant_models.PayloadSchemaType.KEYWORD,
                "entitlement_groups": qdrant_models.PayloadSchemaType.KEYWORD,
                "visibility_level": qdrant_models.PayloadSchemaType.KEYWORD,
                "policy_projection_version": qdrant_models.PayloadSchemaType.KEYWORD,
                "status": qdrant_models.PayloadSchemaType.KEYWORD,
                "source_channel": qdrant_models.PayloadSchemaType.KEYWORD,
                "answer_role": qdrant_models.PayloadSchemaType.KEYWORD,
                "condition_subject": qdrant_models.PayloadSchemaType.KEYWORD,
                "condition_group_subject": qdrant_models.PayloadSchemaType.KEYWORD,
                "article_no": qdrant_models.PayloadSchemaType.KEYWORD,
                "clause_no": qdrant_models.PayloadSchemaType.KEYWORD,
                "is_current": qdrant_models.PayloadSchemaType.BOOL,
            }

        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_collection.return_value = _CollectionInfo()

        report = audit_payload_indexes(
            qdrant_client=qdrant_client,
            collection_name="student_rules__r20260501",
        )

        self.assertEqual(report.status, "passed")
        self.assertEqual(report.missing_indexes, ())
        self.assertEqual(report.mismatched_indexes, ())

    def test_index_chunks_to_qdrant_skips_payload_indexes_for_local_backend(self) -> None:
        record = _make_registry_record(
            document_id="handbook:test-001",
            version_id="v1:test-001",
            entitlement_groups=("students",),
        )
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=_make_structured_jsonl(
                document_id=record.document_id,
                version_id=record.version_id,
                text="Local qdrant indexing should not create payload indexes.",
            ),
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
            embedding_model=embedding_model,
        )
        qdrant_client = QdrantClient(location=":memory:")
        qdrant_client.create_payload_index = Mock(
            side_effect=AssertionError("should not be called")
        )  # type: ignore[method-assign]

        ids = index_chunks_to_qdrant(
            chunks=chunks,
            qdrant_client=qdrant_client,
            collection_name=STUDENT_HANDBOOK_QDRANT_COLLECTION,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        self.assertEqual(len(ids), 1)

    def test_index_chunks_to_qdrant_creates_named_dense_and_sparse_vectors_for_remote_backend(
        self,
    ) -> None:
        record = _make_registry_record(
            document_id="handbook:test-remote",
            version_id="v1:test-remote",
            entitlement_groups=("students",),
        )
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=_make_structured_jsonl(
                document_id=record.document_id,
                version_id=record.version_id,
                text="Remote qdrant indexing should create visibility payload indexes.",
            ),
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
            embedding_model=embedding_model,
        )
        qdrant_client = QdrantClient(location=":memory:")
        events: list[str] = []

        def collection_exists(_collection_name: str) -> bool:
            return "create_collection" in events

        def create_collection(**_kwargs: object) -> None:
            events.append("create_collection")

        def create_payload_index(**kwargs: object) -> None:
            events.append(f"payload_index:{kwargs['field_name']}")

        def upsert(**_kwargs: object) -> None:
            events.append("upsert")

        qdrant_client.collection_exists = Mock(side_effect=collection_exists)  # type: ignore[method-assign]
        qdrant_client.create_collection = Mock(side_effect=create_collection)  # type: ignore[method-assign]
        qdrant_client.upsert = Mock(side_effect=upsert)  # type: ignore[method-assign]
        qdrant_client.create_payload_index = Mock(side_effect=create_payload_index)  # type: ignore[method-assign]
        with patch("campus_ingestion_core.process._is_local_qdrant_backend", return_value=False):
            ids = index_chunks_to_qdrant(
                chunks=chunks,
                qdrant_client=qdrant_client,
                collection_name=STUDENT_HANDBOOK_QDRANT_COLLECTION,
                sparse_embedding_model=build_sparse_embedding_model(SparseEmbeddingSettings()),
            )

        self.assertEqual(ids, (str(uuid.uuid5(uuid.NAMESPACE_URL, chunks[0].chunk_id)),))
        qdrant_client.create_collection.assert_called_once()
        create_kwargs = qdrant_client.create_collection.call_args.kwargs
        self.assertIn("dense", create_kwargs["vectors_config"])
        self.assertIn("sparse", create_kwargs["sparse_vectors_config"])
        qdrant_client.upsert.assert_called_once()
        first_payload_index_event = next(
            index for index, event in enumerate(events) if event.startswith("payload_index:")
        )
        self.assertLess(first_payload_index_event, events.index("upsert"))
        point = qdrant_client.upsert.call_args.kwargs["points"][0]
        self.assertIn("dense", point.vector)
        self.assertIn("sparse", point.vector)
        self.assertEqual(point.payload["target_surface"], "regulations/student_rules")
        self.assertIsInstance(point.vector["sparse"], qdrant_models.Document)
        self.assertEqual(point.vector["sparse"].text, chunks[0].text)
        self.assertEqual(point.vector["sparse"].model, "qdrant/bm25")
        self.assertIsInstance(point.vector["sparse"].options, qdrant_models.Bm25Config)
        self.assertEqual(
            point.vector["sparse"].options.tokenizer,
            qdrant_models.TokenizerType.MULTILINGUAL,
        )
        self.assertEqual(point.vector["sparse"].options.language, "none")
        indexed_fields = [
            call.kwargs["field_name"] for call in qdrant_client.create_payload_index.call_args_list
        ]
        self.assertEqual(
            indexed_fields,
            [
                "document_id",
                "notice_id",
                "source_notice_ids",
                "source_document_ids",
                "revision_track",
                "version_id",
                "corpus",
                "collection",
                "target_surface",
                "canonical_course_id",
                "canonical_course_family_id",
                "canonical_program_family_id",
                "visibility_scope",
                "entitlement_groups",
                "visibility_level",
                "policy_projection_version",
                "status",
                "source_channel",
                "answer_role",
                "condition_subject",
                "condition_group_subject",
                "article_no",
                "clause_no",
                "is_current",
            ],
        )
        indexed_schemas = {
            call.kwargs["field_name"]: call.kwargs["field_schema"]
            for call in qdrant_client.create_payload_index.call_args_list
        }
        self.assertTrue(
            all(
                indexed_schemas[field_name] == qdrant_models.PayloadSchemaType.KEYWORD
                for field_name in indexed_fields
                if field_name != "is_current"
            )
        )
        self.assertEqual(indexed_schemas["is_current"], qdrant_models.PayloadSchemaType.BOOL)

    def test_required_payload_indexes_include_notice_target_residue_audit_fields(self) -> None:
        indexed_fields = [field_name for field_name, _schema in required_payload_index_schemas()]

        self.assertIn("notice_id", indexed_fields)
        self.assertIn("source_notice_ids", indexed_fields)
        self.assertIn("source_document_ids", indexed_fields)
        self.assertIn("target_surface", indexed_fields)

    def test_required_payload_indexes_include_retrieval_focus_filter_fields(self) -> None:
        indexed_schemas = dict(required_payload_index_schemas())

        self.assertEqual(indexed_schemas["answer_role"], qdrant_models.PayloadSchemaType.KEYWORD)
        self.assertEqual(
            indexed_schemas["condition_subject"], qdrant_models.PayloadSchemaType.KEYWORD
        )
        self.assertEqual(
            indexed_schemas["condition_group_subject"], qdrant_models.PayloadSchemaType.KEYWORD
        )
        self.assertEqual(indexed_schemas["article_no"], qdrant_models.PayloadSchemaType.KEYWORD)
        self.assertEqual(indexed_schemas["clause_no"], qdrant_models.PayloadSchemaType.KEYWORD)

    def test_backend_rejects_query_disabled_corpus(self) -> None:
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        with self.assertRaisesRegex(CorpusQueryDisabledError, "campus_services/service_catalog"):
            backend.retrieve(
                RetrievalRequest(
                    query_text="宿舍报修流程",
                    corpus="campus_services",
                    collection="service_catalog",
                )
            )

    def test_retrieval_settings_from_env_reads_registry_database_url(self) -> None:
        settings = RetrievalSettings.from_env(
            {
                "QDRANT_URL": ":memory:",
                "DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://registry.example/postgres",
            }
        )

        self.assertEqual(settings.qdrant_url, ":memory:")
        self.assertEqual(
            settings.document_registry_database_url,
            "postgresql://registry.example/postgres",
        )
        self.assertEqual(settings.embedding_provider, "gitee")
        self.assertEqual(settings.embedding_model, "Qwen3-Embedding-4B")
        self.assertEqual(settings.embedding_dimensions, 2560)
        self.assertEqual(settings.sparse_provider, "qdrant")
        self.assertEqual(settings.sparse_model, "qdrant/bm25")
        self.assertEqual(settings.sparse_tokenizer, "multilingual")
        self.assertEqual(settings.sparse_language, "none")

    def test_retrieval_settings_from_env_falls_back_to_shared_postgres_url(self) -> None:
        settings = RetrievalSettings.from_env(
            {
                "QDRANT_URL": ":memory:",
                "CAMPUS_SHARED_POSTGRES_URL": "postgresql://shared.example/postgres",
            }
        )

        self.assertEqual(
            settings.document_registry_database_url, "postgresql://shared.example/postgres"
        )

    def test_retrieval_settings_from_env_requires_explicit_qdrant_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "QDRANT_URL is required"):
            RetrievalSettings.from_env({})

    def test_retrieval_settings_from_env_no_longer_requires_qdrant_collection(self) -> None:
        settings = RetrievalSettings.from_env({"QDRANT_URL": ":memory:"})

        self.assertEqual(settings.qdrant_url, ":memory:")

    def test_retrieval_settings_default_qwen3_dimensions_to_native_width(self) -> None:
        settings = RetrievalSettings(
            qdrant_url=":memory:",
            document_registry_database_url="postgresql://registry.example/postgres",
        )

        self.assertEqual(settings.embedding_model, "Qwen3-Embedding-4B")
        self.assertEqual(settings.embedding_dimensions, 2560)
        self.assertEqual(settings.sparse_model, "qdrant/bm25")

    def test_sparse_embedding_settings_default_to_qdrant_bm25_for_handbook(self) -> None:
        settings = SparseEmbeddingSettings.from_env({})

        self.assertEqual(settings.provider, "qdrant")
        self.assertEqual(settings.model, "qdrant/bm25")
        self.assertEqual(settings.tokenizer, "multilingual")
        self.assertEqual(settings.language, "none")

    def test_build_hybrid_prefetch_uses_server_side_bm25_document_query(
        self,
    ) -> None:
        class _DenseEmbeddingModel:
            def get_query_embedding(self, query: str) -> list[float]:
                self.query = query
                return [0.1] * 8

        class _SparseEmbeddingModel:
            def __init__(self) -> None:
                self.query_calls: list[str] = []

            def build_document(
                self, text: str
            ) -> qdrant_models.Document | qdrant_models.SparseVector:
                raise AssertionError(
                    "document embedding should not be used during retrieval query prefetch"
                )

            def build_query(
                self, text: str
            ) -> qdrant_models.Document | qdrant_models.SparseVector | None:
                self.query_calls.append(text)
                return qdrant_models.Document(
                    text=text,
                    model="qdrant/bm25",
                    options=qdrant_models.Bm25Config(
                        tokenizer=qdrant_models.TokenizerType.MULTILINGUAL,
                        language="none",
                        lowercase=True,
                        ascii_folding=False,
                    ),
                )

        dense_embedding_model = _DenseEmbeddingModel()
        sparse_embedding_model = _SparseEmbeddingModel()
        profile = _make_runtime_profile(
            dense_prefetch_limit=11,
            sparse_prefetch_limit=13,
            embedding_query_instruction="Retrieve handbook passages about the requested office or schedule.",
        )

        prefetch = _build_hybrid_prefetch(
            request=RetrievalRequest(
                query_text="scholarship office hours",
                corpus="regulations",
                collection="student_rules",
                authorized_filter=_authorized_filter(),
                top_k=3,
            ),
            profile=profile,
            embedding_model=dense_embedding_model,
            sparse_embedding_model=sparse_embedding_model,
        )

        self.assertEqual(
            dense_embedding_model.query,
            (
                "Instruct: Retrieve handbook passages about the requested office or schedule.\n"
                "Query: scholarship office hours"
            ),
        )
        self.assertEqual(sparse_embedding_model.query_calls, ["scholarship office hours"])
        self.assertEqual(len(prefetch), 2)
        self.assertEqual(prefetch[0].using, "dense")
        self.assertEqual(prefetch[1].using, "sparse")
        self.assertEqual(prefetch[0].limit, 11)
        self.assertEqual(prefetch[1].limit, 13)
        self.assertIsInstance(prefetch[1].query, qdrant_models.Document)
        self.assertEqual(prefetch[1].query.text, "scholarship office hours")
        self.assertEqual(prefetch[1].query.model, "qdrant/bm25")
        self.assertIsInstance(prefetch[1].query.options, qdrant_models.Bm25Config)
        self.assertEqual(
            prefetch[1].query.options.tokenizer,
            qdrant_models.TokenizerType.MULTILINGUAL,
        )
        self.assertEqual(prefetch[1].query.options.language, "none")
        dense_filter = prefetch[0].filter
        self.assertIsNotNone(dense_filter)
        dense_conditions = dense_filter.must or []
        self.assertTrue(
            any(
                getattr(condition, "key", None) == "status"
                and getattr(getattr(condition, "match", None), "value", None) == "active"
                for condition in dense_conditions
            )
        )
        self.assertTrue(
            any(
                getattr(condition, "key", None) == "is_current"
                and getattr(getattr(condition, "match", None), "value", None) is True
                for condition in dense_conditions
            )
        )
        self.assertTrue(
            any(
                getattr(condition, "key", None) == "revision_track"
                and getattr(getattr(condition, "match", None), "any", None)
                == ["current-effective", "source-faithful"]
                for condition in dense_conditions
            )
        )

    def test_build_rrf_query_uses_qdrant_fusion_query_contract(self) -> None:
        query = _build_rrf_query(
            _make_runtime_profile(
                rrf_k=37,
                rrf_dense_weight=1.6,
                rrf_sparse_weight=0.7,
            )
        )

        self.assertIsInstance(query, qdrant_models.FusionQuery)
        self.assertEqual(query.fusion, qdrant_models.Fusion.RRF)

    def test_backend_caches_dense_query_embedding_within_ttl(self) -> None:
        class _CountingDenseEmbeddingModel:
            def __init__(self) -> None:
                self.calls: list[str] = []

            def get_query_embedding(self, query: str) -> list[float]:
                self.calls.append(query)
                return [0.1] * 8

        registry = InMemoryDocumentRegistry()
        embedding_model = _CountingDenseEmbeddingModel()
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
        backend.qdrant_client.collection_exists = Mock(return_value=True)  # type: ignore[method-assign]
        backend.qdrant_client.query_points = Mock(  # type: ignore[method-assign]
            return_value=qdrant_models.QueryResponse(points=[])
        )

        request = RetrievalRequest(
            query_text="library hours",
            corpus="regulations",
            collection="student_rules",
            authorized_filter=_authorized_filter(),
        )
        backend.retrieve(request)
        backend.retrieve(request)

        self.assertEqual(
            embedding_model.calls,
            [
                "Instruct: Given a campus policy or handbook question, retrieve relevant passages that answer "
                "the query.\nQuery: library hours"
            ],
        )

    def test_build_qdrant_client_uses_self_hosted_native_inference_boundary(self) -> None:
        settings = RetrievalSettings(
            qdrant_url="https://example-qdrant.internal",
            qdrant_api_key="secret",
        )
        fake_client = object()

        with patch(
            "campus_retrieval_core.backend_qdrant.QdrantClient", return_value=fake_client
        ) as client_ctor:
            result = _build_qdrant_client(settings)

        self.assertIs(result, fake_client)
        client_ctor.assert_called_once_with(
            url="https://example-qdrant.internal",
            api_key="secret",
            timeout=settings.qdrant_timeout_seconds,
            cloud_inference=False,
            check_compatibility=False,
            trust_env=False,
        )

    def test_retrieval_settings_reads_qdrant_tls_ca_cert_path(self) -> None:
        settings = RetrievalSettings.from_env(
            {
                "QDRANT_URL": "https://qdrant.internal:6333",
                "QDRANT_API_KEY": "readonly-key",
                "QDRANT_TLS_CA_CERT_PATH": "/srv/docker/campus-agent/staging/qdrant/tls/ca.pem",
            }
        )

        self.assertEqual(
            settings.qdrant_tls_ca_cert_path,
            "/srv/docker/campus-agent/staging/qdrant/tls/ca.pem",
        )

    def test_build_qdrant_client_passes_tls_ca_verify_path(self) -> None:
        settings = RetrievalSettings(
            qdrant_url="https://example-qdrant.internal",
            qdrant_api_key="secret",
            qdrant_tls_ca_cert_path="/srv/docker/campus-agent/staging/qdrant/tls/ca.pem",
        )
        fake_client = object()

        with patch(
            "campus_retrieval_core.backend_qdrant.QdrantClient", return_value=fake_client
        ) as client_ctor:
            result = _build_qdrant_client(settings)

        self.assertIs(result, fake_client)
        client_ctor.assert_called_once_with(
            url="https://example-qdrant.internal",
            api_key="secret",
            timeout=settings.qdrant_timeout_seconds,
            cloud_inference=False,
            check_compatibility=False,
            trust_env=False,
            verify="/srv/docker/campus-agent/staging/qdrant/tls/ca.pem",
        )

    def test_backend_uses_collection_exists_without_alias_listing_precheck(self) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(return_value=True)
        qdrant_client.get_aliases = Mock(
            side_effect=AssertionError("alias listing should not be called")
        )
        qdrant_client.query_points = Mock(return_value=qdrant_models.QueryResponse(points=[]))
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="学生证丢了怎么办",
                corpus="regulations",
                collection="student_rules",
                authorized_filter=_authorized_filter(),
                top_k=5,
            )
        )

        self.assertEqual(result.sources, ())
        qdrant_client.collection_exists.assert_called_once_with("student_rules")
        qdrant_client.query_points.assert_called_once()
        qdrant_client.get_aliases.assert_not_called()

    def test_backend_caches_positive_collection_existence_checks(self) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(return_value=True)
        qdrant_client.query_points = Mock(return_value=qdrant_models.QueryResponse(points=[]))
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        request = RetrievalRequest(
            query_text="学生证丢了怎么办",
            corpus="regulations",
            collection="student_rules",
            authorized_filter=_authorized_filter(),
            top_k=5,
        )

        backend.retrieve(request)
        backend.retrieve(request)

        qdrant_client.collection_exists.assert_called_once_with("student_rules")
        self.assertEqual(qdrant_client.query_points.call_count, 2)

    def test_backend_retries_transient_collection_exists_failures(self) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(
            side_effect=[
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                True,
            ]
        )
        qdrant_client.query_points = Mock(return_value=qdrant_models.QueryResponse(points=[]))
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="学生证丢了怎么办",
                corpus="regulations",
                collection="student_rules",
                authorized_filter=_authorized_filter(),
                top_k=5,
            )
        )

        self.assertEqual(result.sources, ())
        self.assertEqual(qdrant_client.collection_exists.call_count, 3)
        qdrant_client.query_points.assert_called_once()

    def test_backend_retries_transient_query_points_failures(self) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(return_value=True)
        qdrant_client.query_points = Mock(
            side_effect=[
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                qdrant_models.QueryResponse(points=[]),
            ]
        )
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="学生证丢了怎么办",
                corpus="regulations",
                collection="student_rules",
                authorized_filter=_authorized_filter(),
                top_k=5,
            )
        )

        self.assertEqual(result.sources, ())
        self.assertEqual(qdrant_client.query_points.call_count, 3)

    def test_backend_raises_when_transient_query_points_failures_exhaust_retries(self) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(return_value=True)
        qdrant_client.query_points = Mock(
            side_effect=[
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
            ]
        )
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        with self.assertRaises(RetrievalBackendError):
            backend.retrieve(
                RetrievalRequest(
                    query_text="学生证丢了怎么办",
                    corpus="regulations",
                    collection="student_rules",
                    authorized_filter=_authorized_filter(),
                    top_k=5,
                )
            )

        self.assertEqual(qdrant_client.query_points.call_count, 3)

    def test_backend_builds_registry_from_database_url_when_not_injected(self) -> None:
        with patch(
            "campus_retrieval_core.backend_qdrant.build_document_registry_from_env"
        ) as builder:
            builder.return_value = InMemoryDocumentRegistry()

            backend = QdrantRetrievalBackend(
                settings=RetrievalSettings(
                    qdrant_url=":memory:",
                    document_registry_database_url="postgresql://registry.example/postgres",
                    embedding_model="mock-embedding-8d",
                ),
                qdrant_client=QdrantClient(location=":memory:"),
                embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            )

            builder.assert_called_once_with(
                {"DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://registry.example/postgres"}
            )
            self.assertIsNotNone(backend.registry)
