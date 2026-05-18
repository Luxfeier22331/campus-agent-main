from __future__ import annotations

from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY
from campus_retrieval_core.models import RetrievalSemanticHint

from tests.retrieval.backend_qdrant_test_support import (
    InMemoryDocumentRegistry,
    QdrantRetrievalBackend,
    RetrievalRequest,
    RetrievalSettings,
    _make_registry_record,
    qdrant_models,
    unittest,
)


class _FakeEmbeddingModel:
    def get_query_embedding(self, query_text: str) -> tuple[float, ...]:
        return (1.0, 0.0, 0.0)


class _NoSparseModel:
    def build_query(self, query_text: str) -> object | None:
        return None


class _DocumentScopedConditionTableScrollQdrantClient:
    def __init__(self, *, record_payload_by_doc_id: dict[str, dict[str, object]]) -> None:
        self.record_payload_by_doc_id = record_payload_by_doc_id
        self.scroll_document_ids: list[str] = []
        self.scroll_limits: list[int] = []
        self.query_points_calls = 0

    def collection_exists(self, collection_name: str, **kwargs: object) -> bool:
        return True

    def scroll(self, **kwargs: object) -> tuple[list[qdrant_models.Record], None]:
        scroll_filter = kwargs["scroll_filter"]
        document_id = _single_document_id_from_qdrant_filter(scroll_filter)
        self.scroll_document_ids.append(document_id)
        self.scroll_limits.append(int(kwargs["limit"]))
        payload = self.record_payload_by_doc_id[document_id]
        return (
            [
                qdrant_models.Record(
                    id=f"condition-record-{document_id}",
                    payload=payload,
                    vector=None,
                )
            ],
            None,
        )

    def query_points(self, **kwargs: object) -> object:
        self.query_points_calls += 1
        raise AssertionError("condition subject row lookup must not use hybrid query_points")


class BackendQdrantTypedRowsTest(unittest.TestCase):
    def test_condition_subject_row_lookup_scrolls_each_target_document_independently(
        self,
    ) -> None:
        primary_record = _make_registry_record(
            document_id="handbook:student-discipline",
            version_id="v1:student-discipline",
            entitlement_groups=(),
        )
        bridge_record = _make_registry_record(
            document_id="handbook:attendance",
            version_id="v1:attendance",
            entitlement_groups=(),
        )
        registry = InMemoryDocumentRegistry((primary_record, bridge_record))
        qdrant_client = _DocumentScopedConditionTableScrollQdrantClient(
            record_payload_by_doc_id={
                primary_record.document_id: _condition_table_payload(
                    document_id=primary_record.document_id,
                    version_id=primary_record.version_id,
                    chunk_id="discipline-threshold-row",
                    source_title="学生违纪处分实施办法",
                    text="一学期累计旷课达16-23节者，给予警告处分。",
                    article_no="第三十三条",
                    answer_role="supporting_detail",
                    content_role="procedure",
                    condition_subject="attendance_absence_threshold",
                ),
                bridge_record.document_id: _condition_table_payload(
                    document_id=bridge_record.document_id,
                    version_id=bridge_record.version_id,
                    chunk_id="attendance-bridge-row",
                    source_title="学生考勤管理办法",
                    text="学生旷课，视情节按学生违纪处分实施办法给予相应处分。",
                    article_no="第十七条",
                    answer_role="supporting_detail",
                    content_role="procedure",
                    condition_subject="attendance_absence_threshold",
                ),
            }
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
                query_text="旷课多少学时会按违纪处理",
                corpus="regulations",
                collection="student_rules",
                target_document_ids=(
                    primary_record.document_id,
                    bridge_record.document_id,
                ),
                semantic_hint=RetrievalSemanticHint(
                    intent_kind="condition_table",
                    answer_kind="condition_table",
                    need_kinds=("condition_table",),
                    coverage_policy="condition_subject_alignment",
                    selection_policy="answer_role_first",
                    expected_answer_roles=(
                        "eligibility_condition",
                        "table_fact",
                        "supporting_detail",
                    ),
                    condition_subject="attendance_absence_threshold",
                ),
                top_k=5,
                timeout_ms=4000,
            )
        )

        self.assertEqual(qdrant_client.query_points_calls, 0)
        self.assertEqual(
            qdrant_client.scroll_document_ids,
            [primary_record.document_id, bridge_record.document_id],
        )
        self.assertTrue(all(limit <= 8 for limit in qdrant_client.scroll_limits))
        self.assertEqual(
            {source.chunk_id for source in result.sources},
            {"discipline-threshold-row", "attendance-bridge-row"},
        )


def _condition_table_payload(
    *,
    document_id: str,
    version_id: str,
    chunk_id: str,
    source_title: str,
    text: str,
    article_no: str,
    answer_role: str,
    content_role: str,
    condition_subject: str,
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
        "detail_label": article_no,
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
            "parent_unit_id": f"{document_id}:{article_no}",
            "condition_subject": condition_subject,
            "condition_group_id": f"{document_id}:{article_no}:{condition_subject}",
            "condition_group_subject": condition_subject,
            "condition_polarity": "neutral",
            "semantic_role": "supporting_detail",
            "polarity": "neutral",
            "claim_type": "condition",
            "article_no": article_no,
        },
    }


def _single_document_id_from_qdrant_filter(scroll_filter) -> str:
    document_conditions = [
        condition
        for condition in scroll_filter.must or ()
        if getattr(condition, "key", None) == "document_id"
    ]
    if len(document_conditions) != 1:
        raise AssertionError("condition subject row lookup must bind exactly one document_id")
    match = document_conditions[0].match
    document_id = getattr(match, "value", None)
    if not isinstance(document_id, str) or not document_id:
        raise AssertionError("condition subject row lookup must use document_id MatchValue")
    return document_id


if __name__ == "__main__":
    unittest.main()
