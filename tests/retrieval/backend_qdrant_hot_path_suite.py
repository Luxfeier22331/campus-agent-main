from __future__ import annotations

from campus_retrieval_core.backend_qdrant_embeddings import get_dense_query_embedding
from campus_retrieval_core.backend_qdrant_evidence import build_evidence_sources
from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY
from campus_retrieval_core.models import RetrievalSemanticHint

from tests.retrieval.backend_qdrant_test_support import (
    InMemoryDocumentRegistry,
    Mock,
    QdrantRetrievalBackend,
    RetrievalRequest,
    RetrievalSettings,
    _make_registry_record,
    _make_runtime_profile,
    patch,
    qdrant_models,
    unittest,
)


class _FakeEmbeddingModel:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def get_query_embedding(self, query_text: str) -> tuple[float, ...]:
        self.calls.append(query_text)
        return (float(len(self.calls)), 0.0, 0.0)


class _NoSparseModel:
    def build_query(self, query_text: str) -> object | None:
        return None


class _FakeQdrantClient:
    def __init__(self) -> None:
        self.captured_timeouts: list[int | None] = []

    def collection_exists(self, collection_name: str, **kwargs: object) -> bool:
        self.captured_timeouts.append(kwargs.get("timeout"))  # type: ignore[arg-type]
        return True

    def query_points(self, **kwargs: object) -> object:
        self.captured_timeouts.append(kwargs.get("timeout"))  # type: ignore[arg-type]

        class Response:
            points: tuple[object, ...] = ()

        return Response()


class _ConditionTableScrollQdrantClient:
    def __init__(self, *, record_payloads: tuple[dict[str, object], ...]) -> None:
        self.record_payloads = record_payloads
        self.scroll_calls: list[dict[str, object]] = []
        self.query_points_calls = 0

    def collection_exists(self, collection_name: str, **kwargs: object) -> bool:
        return True

    def scroll(self, **kwargs: object) -> tuple[list[qdrant_models.Record], None]:
        self.scroll_calls.append(dict(kwargs))
        return (
            [
                qdrant_models.Record(
                    id=f"condition-record-{index}",
                    payload=payload,
                    vector=None,
                )
                for index, payload in enumerate(self.record_payloads, start=1)
            ],
            None,
        )

    def query_points(self, **kwargs: object) -> object:
        self.query_points_calls += 1
        raise AssertionError("condition table member lookup must not use hybrid query_points")


class _CountingRegistry(InMemoryDocumentRegistry):
    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        self.get_calls = 0
        self.current_version_calls = 0

    def get(self, document_id: str, revision_track: str, version_id: str):
        self.get_calls += 1
        return super().get(document_id, revision_track, version_id)

    def current_version(
        self,
        document_id: str,
        preferred_revision_tracks: tuple[str, ...] = (),
    ):
        self.current_version_calls += 1
        return super().current_version(document_id, preferred_revision_tracks)


class BackendQdrantHotPathTest(unittest.TestCase):
    def test_dense_query_cache_is_bounded_and_reuses_cached_embeddings(self) -> None:
        embedding_model = _FakeEmbeddingModel()
        backend = QdrantRetrievalBackend(
            RetrievalSettings(qdrant_url=":memory:"),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=Mock(),
            embedding_model=embedding_model,
            sparse_embedding_model=_NoSparseModel(),
            dense_query_cache_ttl_seconds=60,
            dense_query_cache_max_entries=2,
        )
        profile = _make_runtime_profile()

        get_dense_query_embedding(backend, "first", profile=profile)
        get_dense_query_embedding(backend, "second", profile=profile)
        get_dense_query_embedding(backend, "first", profile=profile)
        get_dense_query_embedding(backend, "third", profile=profile)

        self.assertLessEqual(len(backend._dense_query_cache), 2)
        self.assertEqual(len(embedding_model.calls), 3)
        self.assertFalse(any("second" in key for key in backend._dense_query_cache))

    def test_dense_query_cache_key_includes_embedding_and_profile_identity(self) -> None:
        embedding_model = _FakeEmbeddingModel()
        backend = QdrantRetrievalBackend(
            RetrievalSettings(
                qdrant_url=":memory:",
                embedding_provider="mock",
                embedding_model="mock-embedding-8d",
                embedding_dimensions=3,
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=Mock(),
            embedding_model=embedding_model,
            sparse_embedding_model=_NoSparseModel(),
            dense_query_cache_ttl_seconds=60,
            dense_query_cache_max_entries=8,
        )
        profile = _make_runtime_profile()

        first = get_dense_query_embedding(backend, "校园卡丢了怎么办", profile=profile)
        second = get_dense_query_embedding(backend, "校园卡丢了怎么办", profile=profile)
        backend.settings = RetrievalSettings(
            qdrant_url=":memory:",
            embedding_provider="mock",
            embedding_model="mock-embedding-16d",
            embedding_dimensions=16,
        )
        third = get_dense_query_embedding(backend, "校园卡丢了怎么办", profile=profile)
        changed_profile = _make_runtime_profile(embedding_query_instruction="retrieve notices")
        fourth = get_dense_query_embedding(
            backend,
            "校园卡丢了怎么办",
            profile=changed_profile,
        )

        self.assertEqual(first, second)
        self.assertNotEqual(second, third)
        self.assertNotEqual(third, fourth)
        self.assertEqual(len(embedding_model.calls), 3)

    def test_retrieve_threads_timeout_budget_to_qdrant_reads(self) -> None:
        qdrant_client = _FakeQdrantClient()
        backend = QdrantRetrievalBackend(
            RetrievalSettings(qdrant_url=":memory:"),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=_FakeEmbeddingModel(),
            sparse_embedding_model=_NoSparseModel(),
        )
        profile = _make_runtime_profile()

        with patch(
            "campus_retrieval_core.backend_qdrant.load_runtime_profile",
            return_value=profile,
        ):
            backend.retrieve(
                RetrievalRequest(
                    query_text="library hours",
                    corpus="regulations",
                    collection="student_rules",
                    timeout_ms=2500,
                )
            )

        self.assertTrue(qdrant_client.captured_timeouts)
        bounded_timeouts = [
            timeout for timeout in qdrant_client.captured_timeouts if timeout is not None
        ]
        self.assertTrue(bounded_timeouts)
        self.assertTrue(all(1 <= timeout <= 3 for timeout in bounded_timeouts))

    def test_registry_lookup_metadata_is_memoized_for_repeated_source_records(self) -> None:
        record = _make_registry_record(
            document_id="regulations:student:library",
            version_id="v1:student:library",
            entitlement_groups=(),
        )
        registry = _CountingRegistry((record,))
        backend = QdrantRetrievalBackend(
            RetrievalSettings(qdrant_url=":memory:"),
            registry=registry,
            qdrant_client=Mock(),
            embedding_model=_FakeEmbeddingModel(),
            sparse_embedding_model=_NoSparseModel(),
        )
        payload = {
            "text": "Library hours are 08:00 to 22:00.",
            "document_id": record.document_id,
            "revision_track": record.revision_track,
            "version_id": record.version_id,
            "chunk_id": "chunk-library",
        }

        sources = build_evidence_sources(
            backend,
            (
                qdrant_models.ScoredPoint(
                    id="point-1",
                    version=0,
                    score=0.9,
                    payload=payload,
                    vector=None,
                ),
                qdrant_models.ScoredPoint(
                    id="point-2",
                    version=0,
                    score=0.8,
                    payload={**payload, "chunk_id": "chunk-library-2"},
                    vector=None,
                ),
            ),
        )

        self.assertEqual(len(sources), 2)
        self.assertEqual(registry.get_calls, 1)
        self.assertEqual(registry.current_version_calls, 1)

    def test_condition_table_member_lookup_uses_payload_rows_without_hybrid_query(
        self,
    ) -> None:
        first_record = _make_registry_record(
            document_id="handbook:scholarship-a",
            version_id="v1:scholarship-a",
            entitlement_groups=(),
        )
        second_record = _make_registry_record(
            document_id="handbook:scholarship-b",
            version_id="v1:scholarship-b",
            entitlement_groups=(),
        )
        registry = InMemoryDocumentRegistry((first_record, second_record))
        qdrant_client = _ConditionTableScrollQdrantClient(
            record_payloads=(
                _condition_table_payload(
                    document_id=first_record.document_id,
                    version_id=first_record.version_id,
                    chunk_id="condition-a",
                    source_title="奖学金办法 A",
                    text="申请奖学金应当热爱社会主义祖国，遵守学校规章制度。",
                ),
                _condition_table_payload(
                    document_id=second_record.document_id,
                    version_id=second_record.version_id,
                    chunk_id="condition-b",
                    source_title="奖学金办法 B",
                    text="申请奖学金应当学习成绩优良。",
                ),
            )
        )
        backend = QdrantRetrievalBackend(
            RetrievalSettings(qdrant_url=":memory:"),
            registry=registry,
            qdrant_client=qdrant_client,
            embedding_model=_FakeEmbeddingModel(),
            sparse_embedding_model=_NoSparseModel(),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="申请奖学金需要满足什么条件",
                corpus="regulations",
                collection="student_rules",
                target_document_ids=(first_record.document_id, second_record.document_id),
                semantic_hint=RetrievalSemanticHint(
                    intent_kind="condition_table",
                    answer_kind="condition_table",
                    selection_policy="answer_role_first",
                    expected_answer_roles=("eligibility_condition", "eligibility_intro"),
                ),
                top_k=5,
                timeout_ms=4000,
            )
        )

        self.assertEqual(qdrant_client.query_points_calls, 0)
        self.assertTrue(qdrant_client.scroll_calls)
        scroll_kwargs = qdrant_client.scroll_calls[-1]
        self.assertEqual(scroll_kwargs["limit"], 16)
        self.assertEqual(scroll_kwargs["timeout"], 4)
        self.assertEqual(
            {source.chunk_id for source in result.sources},
            {"condition-a", "condition-b"},
        )
        self.assertTrue(all(source.is_answer_bearing for source in result.sources))
        self.assertIn("学习成绩优良", " ".join(source.snippet for source in result.sources))

    def test_condition_table_member_lookup_orders_core_conditions_before_table_facts(
        self,
    ) -> None:
        record = _make_registry_record(
            document_id="handbook:scholarship-a",
            version_id="v1:scholarship-a",
            entitlement_groups=(),
        )
        registry = InMemoryDocumentRegistry((record,))
        qdrant_client = _ConditionTableScrollQdrantClient(
            record_payloads=(
                _condition_table_payload(
                    document_id=record.document_id,
                    version_id=record.version_id,
                    chunk_id="award-object",
                    source_title="奖学金办法 A",
                    text="本科学生专项奖学金用以奖励在科研、文体等方面有突出表现的学生。",
                    article_no="第九条",
                    answer_role="eligibility_condition",
                ),
                _condition_table_payload(
                    document_id=record.document_id,
                    version_id=record.version_id,
                    chunk_id="award-amount",
                    source_title="奖学金办法 A",
                    text="学校为奖学金获得者颁发荣誉证书和奖金，奖励标准为500元。",
                    article_no="第十七条",
                    answer_role="table_fact",
                    content_role="table_fact",
                ),
                _condition_table_payload(
                    document_id=record.document_id,
                    version_id=record.version_id,
                    chunk_id="core-condition",
                    source_title="奖学金办法 A",
                    text="申请奖学金应当热爱祖国，遵纪守法，学习成绩优良。",
                    article_no="第十条",
                    answer_role="eligibility_condition",
                ),
            )
        )
        backend = QdrantRetrievalBackend(
            RetrievalSettings(qdrant_url=":memory:"),
            registry=registry,
            qdrant_client=qdrant_client,
            embedding_model=_FakeEmbeddingModel(),
            sparse_embedding_model=_NoSparseModel(),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="申请奖学金需要满足什么条件",
                corpus="regulations",
                collection="student_rules",
                target_document_ids=(record.document_id,),
                semantic_hint=RetrievalSemanticHint(
                    intent_kind="condition_table",
                    answer_kind="condition_table",
                    selection_policy="answer_role_first",
                    expected_answer_roles=(
                        "eligibility_condition",
                        "exception_rule",
                        "table_fact",
                    ),
                ),
                top_k=2,
            )
        )

        self.assertEqual(
            [source.chunk_id for source in result.sources],
            ["core-condition", "award-object"],
        )

    def test_condition_table_member_lookup_respects_expected_role_order_for_amount_fact(
        self,
    ) -> None:
        record = _make_registry_record(
            document_id="handbook:professional-scholarship",
            version_id="v1:professional-scholarship",
            entitlement_groups=(),
        )
        registry = InMemoryDocumentRegistry((record,))
        qdrant_client = _ConditionTableScrollQdrantClient(
            record_payloads=(
                _condition_table_payload(
                    document_id=record.document_id,
                    version_id=record.version_id,
                    chunk_id="professional-core-condition",
                    source_title="专业奖学金办法",
                    text="申请专业奖学金应当热爱祖国，遵纪守法，学习成绩优良。",
                    answer_role="eligibility_condition",
                ),
                _condition_table_payload(
                    document_id=record.document_id,
                    version_id=record.version_id,
                    chunk_id="professional-amount-table",
                    source_title="专业奖学金办法",
                    text="专业奖学金一等奖金额为1500元，二等奖金额为1000元。",
                    answer_role="table_fact",
                    content_role="table_fact",
                ),
            )
        )
        backend = QdrantRetrievalBackend(
            RetrievalSettings(qdrant_url=":memory:"),
            registry=registry,
            qdrant_client=qdrant_client,
            embedding_model=_FakeEmbeddingModel(),
            sparse_embedding_model=_NoSparseModel(),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="专业奖学金标准",
                corpus="regulations",
                collection="student_rules",
                target_document_ids=(record.document_id,),
                semantic_hint=RetrievalSemanticHint(
                    intent_kind="eligibility_judgment",
                    answer_kind="condition_table",
                    selection_policy="answer_role_first",
                    expected_answer_roles=("table_fact", "eligibility_condition"),
                    condition_subject="amount_or_quota",
                ),
                top_k=2,
            )
        )

        self.assertEqual(
            [source.chunk_id for source in result.sources],
            ["professional-amount-table", "professional-core-condition"],
        )

    def test_condition_table_member_lookup_respects_expected_role_order_for_rank_exception(
        self,
    ) -> None:
        record = _make_registry_record(
            document_id="handbook:national-scholarship",
            version_id="v1:national-scholarship",
            entitlement_groups=(),
        )
        registry = InMemoryDocumentRegistry((record,))
        qdrant_client = _ConditionTableScrollQdrantClient(
            record_payloads=(
                _condition_table_payload(
                    document_id=record.document_id,
                    version_id=record.version_id,
                    chunk_id="national-rank-condition",
                    source_title="国家奖学金评审办法",
                    text="学习成绩排名与综合考评成绩排名原则上均应位于前10%。",
                    answer_role="eligibility_condition",
                    condition_subject="rank_threshold",
                ),
                _condition_table_payload(
                    document_id=record.document_id,
                    version_id=record.version_id,
                    chunk_id="national-rank-exception",
                    source_title="国家奖学金评审办法",
                    text="学习成绩排名或综合考评成绩排名超出前10%，但均位于前30%的，必须在其他方面表现特别突出。",
                    answer_role="exception_rule",
                    condition_subject="rank_threshold",
                ),
            )
        )
        backend = QdrantRetrievalBackend(
            RetrievalSettings(qdrant_url=":memory:"),
            registry=registry,
            qdrant_client=qdrant_client,
            embedding_model=_FakeEmbeddingModel(),
            sparse_embedding_model=_NoSparseModel(),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="国家奖学金排名要求",
                corpus="regulations",
                collection="student_rules",
                target_document_ids=(record.document_id,),
                semantic_hint=RetrievalSemanticHint(
                    intent_kind="eligibility_judgment",
                    answer_kind="eligibility_judgment",
                    selection_policy="answer_role_first",
                    expected_answer_roles=("exception_rule", "eligibility_condition"),
                    condition_subject="rank_threshold",
                ),
                top_k=2,
            )
        )

        self.assertEqual(
            [source.chunk_id for source in result.sources],
            ["national-rank-exception", "national-rank-condition"],
        )

    def test_condition_table_member_lookup_respects_expected_role_order_for_exclusion(
        self,
    ) -> None:
        record = _make_registry_record(
            document_id="handbook:discipline-relief",
            version_id="v1:discipline-relief",
            entitlement_groups=(),
        )
        registry = InMemoryDocumentRegistry((record,))
        qdrant_client = _ConditionTableScrollQdrantClient(
            record_payloads=(
                _condition_table_payload(
                    document_id=record.document_id,
                    version_id=record.version_id,
                    chunk_id="discipline-relief-condition",
                    source_title="解除处分实施办法",
                    text="申请解除处分应当在考察期内表现良好，并按要求提交书面申请。",
                    answer_role="eligibility_condition",
                    condition_subject="generic_condition",
                ),
                _condition_table_payload(
                    document_id=record.document_id,
                    version_id=record.version_id,
                    chunk_id="discipline-relief-exclusion",
                    source_title="解除处分实施办法",
                    text="考察期内再次受到纪律处分的，不予解除处分。",
                    answer_role="exclusion_rule",
                    condition_subject="discipline_relief_exclusion",
                    polarity="negative",
                    claim_type="cannot_do",
                ),
            )
        )
        backend = QdrantRetrievalBackend(
            RetrievalSettings(qdrant_url=":memory:"),
            registry=registry,
            qdrant_client=qdrant_client,
            embedding_model=_FakeEmbeddingModel(),
            sparse_embedding_model=_NoSparseModel(),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="解除处分限制情形",
                corpus="regulations",
                collection="student_rules",
                target_document_ids=(record.document_id,),
                semantic_hint=RetrievalSemanticHint(
                    intent_kind="condition_table",
                    answer_kind="condition_table",
                    selection_policy="answer_role_first",
                    expected_answer_roles=("exclusion_rule", "eligibility_condition"),
                    condition_subject="discipline_relief_exclusion",
                ),
                top_k=2,
            )
        )

        self.assertEqual(
            [source.chunk_id for source in result.sources],
            ["discipline-relief-exclusion", "discipline-relief-condition"],
        )

    def test_category_member_condition_lookup_uses_answer_role_scroll_path(self) -> None:
        record = _make_registry_record(
            document_id="handbook:professional-scholarship",
            version_id="v1:professional-scholarship",
            entitlement_groups=(),
        )
        registry = InMemoryDocumentRegistry((record,))
        qdrant_client = _ConditionTableScrollQdrantClient(
            record_payloads=(
                _condition_table_payload(
                    document_id=record.document_id,
                    version_id=record.version_id,
                    chunk_id="professional-core-condition",
                    source_title="专业奖学金办法",
                    text="申请专业奖学金应当学习成绩优秀，综合测评排名靠前。",
                ),
            )
        )
        backend = QdrantRetrievalBackend(
            RetrievalSettings(qdrant_url=":memory:"),
            registry=registry,
            qdrant_client=qdrant_client,
            embedding_model=_FakeEmbeddingModel(),
            sparse_embedding_model=_NoSparseModel(),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="申请奖学金需要满足什么条件",
                corpus="regulations",
                collection="student_rules",
                target_document_ids=(record.document_id,),
                semantic_hint=RetrievalSemanticHint(
                    intent_kind="condition_table",
                    answer_kind="condition_table",
                    coverage_policy="category_member_coverage",
                    selection_policy="one_answer_ready_source_per_member",
                    expected_answer_roles=(
                        "eligibility_condition",
                        "exception_rule",
                        "eligibility_intro",
                        "table_fact",
                    ),
                    condition_subject="generic_condition",
                    category_id="scholarship",
                ),
                top_k=3,
            )
        )

        self.assertEqual(qdrant_client.query_points_calls, 0)
        self.assertTrue(qdrant_client.scroll_calls)
        self.assertEqual([source.chunk_id for source in result.sources], ["professional-core-condition"])


def _condition_table_payload(
    *,
    document_id: str,
    version_id: str,
    chunk_id: str,
    source_title: str,
    text: str,
    article_no: str = "第五条",
    answer_role: str = "eligibility_condition",
    content_role: str = "eligibility",
    condition_subject: str = "generic_condition",
    polarity: str = "positive",
    claim_type: str = "condition",
) -> dict[str, object]:
    return {
        "text": text,
        "document_id": document_id,
        "revision_track": "source-faithful",
        "version_id": version_id,
        "chunk_id": chunk_id,
        "corpus": "regulations",
        "collection": "student_rules",
        "status": "active",
        "is_current": True,
        "visibility_level": "public",
        "source_channel": "pdf_ocr",
        "source_title": source_title,
        "detail_label": "第五条",
        "content_kind": "article_body",
        "content_role": content_role,
        "is_answer_bearing": True,
        "article_no": article_no,
        "answer_role": answer_role,
        "anchor": {
            "page_start": 1,
            "page_end": 1,
            "article_no": article_no,
        },
        INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
            "evidence_contract_version": "answer_ready_evidence.v3",
            "answer_role": answer_role,
            "parent_unit_id": f"{document_id}:article-5",
            "condition_subject": condition_subject,
            "condition_group_id": f"{document_id}:article-5:{condition_subject}",
            "condition_polarity": polarity,
            "semantic_role": "eligibility_condition",
            "polarity": polarity,
            "claim_type": claim_type,
            "article_no": "第五条",
        },
    }
