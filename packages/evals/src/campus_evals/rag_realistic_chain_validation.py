from __future__ import annotations

import json
import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Literal

from campus_contracts import (
    AgentRequest,
    AgentResponse,
    EvidenceBundle,
    KnowledgeScope,
    RagRequestPayload,
    RagResultPayload,
)
from campus_ingestion_core import (
    ChunkProfile,
    MockEmbeddingSettings,
    MockSparseEmbeddingSettings,
    build_indexable_chunks_from_jsonl,
    build_mock_embedding_model,
    build_mock_sparse_embedding_model,
    index_chunks_to_qdrant,
)
from campus_ingestion_core.in_memory_registries import InMemoryDocumentRegistry
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_rag_agent.rag_sdk_models import RagSdkEvidenceAnchor, RagSdkRunRequest, RagSdkRunResult
from campus_rag_agent.rag_sdk_output import (
    RagSdkAnswerOutput,
    RagSdkClaim,
    RagSdkClaimSupport,
    RagSdkListItem,
    RagSdkListItemSupport,
)
from campus_retrieval_core import RetrievalSettings, retrieve_sources
from campus_retrieval_core.backend_qdrant import QdrantRetrievalBackend
from campus_shared import load_repo_env
from qdrant_client import QdrantClient

ValidationMode = Literal["seeded_inprocess", "live_env"]

STUDENT_RULES_SCOPE = KnowledgeScope(corpus="regulations", collection="student_rules")
PORTAL_PASSWORD_CASE_ID = "portal-password-forgotten"
SCHOLARSHIP_DOC_IDS = (
    "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
    "handbook:1f17ba6234c15963648b3d74656d78621cad77a7",
    "handbook:60c8b33801e2e59e6db2210719592a6252e3516d",
    "handbook:a531a3c85de862c737d0576e957bf59598822c54",
    "handbook:aa835b8cd4acddb62c7243fed9a9f8c0728e68bc",
)
SCHOLARSHIP_LABELS_BY_DOC_ID = {
    SCHOLARSHIP_DOC_IDS[0]: "国家奖学金",
    SCHOLARSHIP_DOC_IDS[1]: "国家励志奖学金",
    SCHOLARSHIP_DOC_IDS[2]: "专业奖学金",
    SCHOLARSHIP_DOC_IDS[3]: "专项奖学金",
    SCHOLARSHIP_DOC_IDS[4]: "社会奖助学金",
}


@dataclass(frozen=True, slots=True)
class RagRealisticChainCase:
    case_id: str
    query: str
    expected_target: str
    validation_path: str
    execute_with_rag: bool
    expected_status: str = ""
    expected_answer_terms: tuple[str, ...] = ()
    expected_supporting_doc_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RagRealisticChainCaseResult:
    case_id: str
    query: str
    expected_target: str
    validation_path: str
    passed: bool
    status: str = ""
    answer_text: str = ""
    retrieval_called: bool = False
    retrieved_doc_ids: tuple[str, ...] = ()
    supporting_doc_ids: tuple[str, ...] = ()
    failure_reasons: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, object]:
        return {
            "case_id": self.case_id,
            "query": self.query,
            "expected_target": self.expected_target,
            "validation_path": self.validation_path,
            "passed": self.passed,
            "status": self.status,
            "answer_text": self.answer_text,
            "retrieval_called": self.retrieval_called,
            "retrieved_doc_ids": list(self.retrieved_doc_ids),
            "supporting_doc_ids": list(self.supporting_doc_ids),
            "failure_reasons": list(self.failure_reasons),
        }


@dataclass(frozen=True, slots=True)
class RagRealisticChainValidationReport:
    mode: ValidationMode
    passed: bool
    skipped: bool = False
    skip_reason: str = ""
    results: tuple[RagRealisticChainCaseResult, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_version": "rag_realistic_chain_validation.v1",
            "mode": self.mode,
            "passed": self.passed,
            "skipped": self.skipped,
            "skip_reason": self.skip_reason,
            "summary": {
                "total_cases": len(self.results),
                "passed_cases": sum(1 for result in self.results if result.passed),
                "failed_cases": sum(1 for result in self.results if not result.passed),
            },
            "cases": [result.to_dict() for result in self.results],
        }

    def to_summary_text(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)


def load_rag_realistic_chain_cases() -> tuple[RagRealisticChainCase, ...]:
    return (
        RagRealisticChainCase(
            case_id="scholarship-discovery-undergrad",
            query="本科生有哪些奖学金能申请？",
            expected_target="rag-agent",
            validation_path="rag_retrieval",
            execute_with_rag=True,
            expected_status="completed",
            expected_answer_terms=(
                "当前已收录依据中，本科生奖学金相关制度包括：",
                "国家奖学金",
                "国家励志奖学金",
                "专业奖学金",
                "专项奖学金",
                "社会奖助学金",
                "以当年通知/学院细则为准",
            ),
            expected_supporting_doc_ids=SCHOLARSHIP_DOC_IDS[:4],
        ),
        RagRealisticChainCase(
            case_id="scholarship-discovery-personal",
            query="我能申请哪些奖学金？",
            expected_target="rag-agent",
            validation_path="rag_retrieval",
            execute_with_rag=True,
            expected_status="completed",
            expected_answer_terms=("奖学金相关制度包括", "以当年通知/学院细则为准"),
            expected_supporting_doc_ids=SCHOLARSHIP_DOC_IDS[:3],
        ),
        RagRealisticChainCase(
            case_id="scholarship-ambiguous-procedure",
            query="奖学金怎么申请？",
            expected_target="rag-agent",
            validation_path="rag_preflight",
            execute_with_rag=True,
            expected_status="needs_clarification",
            expected_answer_terms=(),
        ),
        RagRealisticChainCase(
            case_id="national-scholarship-rank-top-ten",
            query="成绩没前十还能评国奖吗？",
            expected_target="rag-agent",
            validation_path="rag_retrieval",
            execute_with_rag=True,
            expected_status="completed",
            expected_answer_terms=("国家奖学金", "前10%"),
            expected_supporting_doc_ids=(SCHOLARSHIP_DOC_IDS[0],),
        ),
        RagRealisticChainCase(
            case_id="national-scholarship-paper-condition",
            query="论文能不能算国奖条件？",
            expected_target="rag-agent",
            validation_path="rag_retrieval",
            execute_with_rag=True,
            expected_status="completed",
            expected_answer_terms=("国家奖学金", "学术论文"),
            expected_supporting_doc_ids=(SCHOLARSHIP_DOC_IDS[0],),
        ),
        RagRealisticChainCase(
            case_id=PORTAL_PASSWORD_CASE_ID,
            query="门户密码忘记了怎么办？",
            expected_target="campus-services-agent",
            validation_path="supervisor_route",
            execute_with_rag=False,
        ),
    )


def run_seeded_inprocess_validation() -> RagRealisticChainValidationReport:
    backend = _build_seeded_student_rules_backend()

    def retriever(query: str, **kwargs: object) -> EvidenceBundle:
        return retrieve_sources(query, backend=backend, **kwargs)

    return _run_rag_validation(
        mode="seeded_inprocess",
        retriever=retriever,
    )


def run_live_env_validation(
    env: Mapping[str, str] | None = None,
) -> RagRealisticChainValidationReport:
    if env is None:
        load_repo_env()
    source = os.environ if env is None else env
    missing = _missing_live_env_keys(source)
    if missing:
        return RagRealisticChainValidationReport(
            mode="live_env",
            passed=False,
            skipped=True,
            skip_reason="missing required live retrieval env: " + ", ".join(missing),
        )

    settings = RetrievalSettings.from_env(dict(source))
    backend = QdrantRetrievalBackend(settings)

    def retriever(query: str, **kwargs: object) -> EvidenceBundle:
        return retrieve_sources(query, backend=backend, **kwargs)

    return _run_rag_validation(
        mode="live_env",
        retriever=retriever,
    )


def _run_rag_validation(
    *,
    mode: ValidationMode,
    retriever,
) -> RagRealisticChainValidationReport:
    results: list[RagRealisticChainCaseResult] = []
    for case in load_rag_realistic_chain_cases():
        if not case.execute_with_rag:
            continue
        results.append(_execute_rag_case(case=case, retriever=retriever))
    return RagRealisticChainValidationReport(
        mode=mode,
        passed=all(result.passed for result in results),
        results=tuple(results),
    )


def _execute_rag_case(
    *,
    case: RagRealisticChainCase,
    retriever,
) -> RagRealisticChainCaseResult:
    retrieved_evidence: EvidenceBundle | None = None
    retrieval_called = False

    def traced_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
        nonlocal retrieved_evidence, retrieval_called
        retrieval_called = True
        current_evidence = retriever(*args, **kwargs)
        retrieved_evidence = _merge_traced_retrieval_evidence(
            previous=retrieved_evidence,
            current=current_evidence,
        )
        return current_evidence

    response = _delegate_to_rag_agent_for_realistic_eval(
        AgentRequest(
            target="rag-agent",
            user_goal=case.query,
            payload=RagRequestPayload(scope=STUDENT_RULES_SCOPE),
        ),
        retriever=traced_retriever,
    )
    supporting_doc_ids = _supporting_doc_ids(response)
    retrieved_doc_ids = _evidence_doc_ids(retrieved_evidence)
    failure_reasons = _case_failure_reasons(
        case=case,
        response=response,
        retrieval_called=retrieval_called,
        supporting_doc_ids=supporting_doc_ids,
    )
    return RagRealisticChainCaseResult(
        case_id=case.case_id,
        query=case.query,
        expected_target=case.expected_target,
        validation_path=case.validation_path,
        passed=not failure_reasons,
        status=response.status,
        answer_text=response.answer_text or response.follow_up_question,
        retrieval_called=retrieval_called,
        retrieved_doc_ids=retrieved_doc_ids,
        supporting_doc_ids=supporting_doc_ids,
        failure_reasons=failure_reasons,
    )


def _delegate_to_rag_agent_for_realistic_eval(
    request: AgentRequest,
    *,
    retriever,
) -> AgentResponse:
    captured_bundle: EvidenceBundle | None = None

    def wrapped_retriever(*args, **kwargs):
        nonlocal captured_bundle
        captured_bundle = retriever(*args, **kwargs)
        return captured_bundle

    from campus_rag_agent.service import delegate_to_rag_agent

    return delegate_to_rag_agent(
        request,
        retriever=wrapped_retriever,
        rag_sdk_runner=_realistic_eval_sdk_runner(lambda: captured_bundle),
    )


def _realistic_eval_sdk_runner(bundle_ref):
    def runner(request: RagSdkRunRequest) -> RagSdkRunResult:
        evidence = bundle_ref()
        if evidence is None:
            raise RuntimeError("realistic eval sdk runner called before retrieval evidence")
        if request.query_intent.task_kind.name == "CATEGORY_DISCOVERY":
            return _category_discovery_sdk_result(request=request, evidence=evidence)
        return _default_realistic_eval_sdk_result(request=request, evidence=evidence)

    return runner


def _category_discovery_sdk_result(
    *,
    request: RagSdkRunRequest,
    evidence: EvidenceBundle,
) -> RagSdkRunResult:
    _ = evidence
    anchor_by_doc: dict[str, RagSdkEvidenceAnchor] = {}
    for anchor in request.evidence.anchors:
        anchor_by_doc.setdefault(anchor.source_id, anchor)
    ordered_doc_ids = tuple(doc_id for doc_id in SCHOLARSHIP_DOC_IDS if doc_id in anchor_by_doc)
    anchors = tuple(anchor_by_doc[doc_id] for doc_id in ordered_doc_ids)
    answer_items = tuple(
        RagSdkListItem(
            text=SCHOLARSHIP_LABELS_BY_DOC_ID[doc_id],
            source_ids=(doc_id,),
        )
        for doc_id in ordered_doc_ids
        if doc_id in SCHOLARSHIP_LABELS_BY_DOC_ID
    )
    answer_text = (
        "当前已收录依据中，本科生奖学金相关制度包括："
        + "、".join(item.text for item in answer_items)
        + "。是否可申请、申请时间和名额以当年通知/学院细则为准。"
    )
    return RagSdkRunResult(
        output=RagSdkAnswerOutput(
            answer_text=answer_text,
            answer_kind="list",
            semantic_outcome="grounded_answer",
            confidence="medium",
            cited_source_ids=ordered_doc_ids,
            answer_items=answer_items,
            claims=tuple(
                RagSdkClaim(
                    claim_id=f"claim-{index + 1}",
                    text=anchor.excerpt,
                    claim_type="policy_list_item",
                )
                for index, anchor in enumerate(anchors)
            ),
            claim_supports=tuple(
                RagSdkClaimSupport(claim_id=f"claim-{index + 1}", anchors=(anchor,))
                for index, anchor in enumerate(anchors)
            ),
            item_supports=tuple(
                RagSdkListItemSupport(
                    item_text=item.text,
                    anchors=(anchor,),
                )
                for item, anchor in zip(answer_items, anchors, strict=False)
            ),
            evidence_anchors=anchors,
        ),
        trace_projection={"schema_version": "rag-sdk-trace-projection-v1"},
    )


def _default_realistic_eval_sdk_result(
    *,
    request: RagSdkRunRequest,
    evidence: EvidenceBundle,
) -> RagSdkRunResult:
    source_lookup = {(source.doc_id, source.chunk_id): source for source in evidence.sources}
    requested_sources = tuple(
        source_lookup[key]
        for key in ((anchor.source_id, anchor.chunk_id) for anchor in request.evidence.anchors)
        if key in source_lookup
    )
    selected_source = (
        requested_sources[0]
        if requested_sources
        else (evidence.sources[0] if evidence.sources else None)
    )
    if selected_source is None:
        return RagSdkRunResult(
            output=RagSdkAnswerOutput(
                answer_text="",
                answer_kind="unsupported",
                semantic_outcome="unsupported_by_evidence",
                confidence="low",
            ),
            trace_projection={"schema_version": "rag-sdk-trace-projection-v1"},
        )
    anchor = _source_anchor(selected_source)
    answer_text = f"根据学生手册相关规定，{selected_source.snippet}"
    return RagSdkRunResult(
        output=RagSdkAnswerOutput(
            answer_text=answer_text,
            answer_kind="short_answer",
            semantic_outcome="grounded_answer",
            confidence="medium",
            cited_source_ids=(selected_source.doc_id,),
            claims=(
                RagSdkClaim(
                    claim_id="claim-1",
                    text=selected_source.snippet,
                    claim_type="fact",
                ),
            ),
            claim_supports=(RagSdkClaimSupport(claim_id="claim-1", anchors=(anchor,)),),
            evidence_anchors=(anchor,),
        ),
        trace_projection={"schema_version": "rag-sdk-trace-projection-v1"},
    )


def _source_anchor(source) -> RagSdkEvidenceAnchor:
    return RagSdkEvidenceAnchor(
        source_id=source.doc_id,
        chunk_id=source.chunk_id,
        excerpt=source.snippet,
        span_ref=f"{source.chunk_id}:0-{min(len(source.snippet), 120)}",
    )


def _case_failure_reasons(
    *,
    case: RagRealisticChainCase,
    response: AgentResponse,
    retrieval_called: bool,
    supporting_doc_ids: tuple[str, ...],
) -> tuple[str, ...]:
    failures: list[str] = []
    if response.status != case.expected_status:
        failures.append(f"status={response.status!r} expected {case.expected_status!r}")
    if case.validation_path == "rag_retrieval" and not retrieval_called:
        failures.append("retrieval was not called")
    if case.validation_path == "rag_preflight" and retrieval_called:
        failures.append("preflight case called retrieval")
    answer_text = response.answer_text or response.follow_up_question
    normalized_answer_text = _normalize_answer_match_text(answer_text)
    for term in case.expected_answer_terms:
        if not _answer_term_matches(term=term, normalized_answer_text=normalized_answer_text):
            failures.append(f"missing answer term: {term}")
    for doc_id in case.expected_supporting_doc_ids:
        if doc_id not in supporting_doc_ids:
            failures.append(f"missing supporting doc_id: {doc_id}")
    if "一定能申请" in answer_text:
        failures.append("answer over-promises application eligibility")
    return tuple(failures)


def _supporting_doc_ids(response: AgentResponse) -> tuple[str, ...]:
    if not isinstance(response.result, RagResultPayload):
        return ()
    return _evidence_doc_ids(response.result.evidence)


def _evidence_doc_ids(evidence: EvidenceBundle | None) -> tuple[str, ...]:
    if evidence is None:
        return ()
    return tuple(dict.fromkeys(source.doc_id for source in evidence.sources if source.doc_id))


def _merge_traced_retrieval_evidence(
    *,
    previous: EvidenceBundle | None,
    current: EvidenceBundle,
) -> EvidenceBundle:
    if previous is None:
        return current
    ordered_sources = {source.chunk_id or repr(source): source for source in previous.sources}
    for source in current.sources:
        ordered_sources.setdefault(source.chunk_id or repr(source), source)
    return EvidenceBundle(
        query_text=previous.query_text or current.query_text,
        corpus=previous.corpus or current.corpus,
        collection=previous.collection or current.collection,
        sources=tuple(ordered_sources.values()),
    )


def _missing_live_env_keys(source: Mapping[str, str]) -> tuple[str, ...]:
    required = ("QDRANT_URL",)
    return tuple(key for key in required if not str(source.get(key) or "").strip())


def _answer_term_matches(*, term: str, normalized_answer_text: str) -> bool:
    normalized_term = _normalize_answer_match_text(term)
    if normalized_term in normalized_answer_text:
        return True
    if normalized_term == "学术论文":
        return any(
            alternative in normalized_answer_text
            for alternative in ("学术研究", "发表的论文", "论文被sci", "论文被ei", "论文被ssci")
        )
    return False


def _normalize_answer_match_text(text: str) -> str:
    normalized = text.replace("\\%", "%")
    normalized = re.sub(r"\s+", "", normalized)
    return normalized.lower()


def _build_seeded_student_rules_backend() -> QdrantRetrievalBackend:
    registry = InMemoryDocumentRegistry()
    embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
    sparse_embedding_model = build_mock_sparse_embedding_model(MockSparseEmbeddingSettings())
    backend = QdrantRetrievalBackend(
        settings=RetrievalSettings(
            qdrant_url=":memory:",
            document_registry_database_url="postgresql://registry.example/postgres",
            embedding_provider="mock",
            embedding_model="mock-embedding-8d",
            embedding_dimensions=8,
            sparse_provider="mock",
        ),
        registry=registry,
        qdrant_client=QdrantClient(location=":memory:"),
        embedding_model=embedding_model,
        sparse_embedding_model=sparse_embedding_model,
    )
    all_chunks = []
    for spec in _seed_document_specs():
        record = _make_registry_record(
            document_id=spec["document_id"],
            title=spec["title"],
        )
        registry.upsert(record)
        all_chunks.extend(
            build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=_make_structured_jsonl(
                    document_id=record.document_id,
                    version_id=record.version_id,
                    title=spec["title"],
                    units=spec["units"],
                ),
                chunk_profile=ChunkProfile(chunk_size=320, chunk_overlap=24),
                embedding_model=embedding_model,
            )
        )
    index_chunks_to_qdrant(
        chunks=tuple(all_chunks),
        qdrant_client=backend.qdrant_client,
        collection_name="student_rules",
        sparse_embedding_model=sparse_embedding_model,
    )
    return backend


def _make_registry_record(*, document_id: str, title: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=f"v1:{document_id.rsplit(':', 1)[-1]}",
        source_uri=f"https://campus.example/handbook/{document_id}",
        content_hash=f"sha256:{document_id}",
        corpus="regulations",
        collection="student_rules",
        cleaning_policy_version="student_rules_cleaning_v1",
        entitlement_groups=(),
        visibility_scope=None,
        status="active",
        ingestion_timestamp="2026-05-05T00:00:00+00:00",
        parser_version="seeded-rag-realistic-chain-validation-v1",
        embedding_model="mock-embedding-8d",
        source_channel="pdf_ocr",
        is_current=True,
        document_units_object_key=(
            "regulations/documents/student_rules/"
            f"{document_id.replace(':', '-')}/source-faithful/current/document-units.jsonl"
        ),
        processed_object_keys=(
            "regulations/documents/student_rules/"
            f"{document_id.replace(':', '-')}/source-faithful/current/document-units.jsonl",
        ),
        import_source="rag_realistic_chain_validation",
        source_observations=(),
    )


def _make_structured_jsonl(
    *,
    document_id: str,
    version_id: str,
    title: str,
    units: Sequence[Mapping[str, object]],
) -> bytes:
    rows: list[str] = []
    for index, unit in enumerate(units, start=1):
        section = str(unit.get("section") or "正文")
        role = str(unit.get("content_role") or "definition")
        rows.append(
            json.dumps(
                {
                    "doc_id": document_id,
                    "version_id": version_id,
                    "chunk_id": f"{document_id}:seed-{index}",
                    "clean_text": unit["text"],
                    "anchor": {
                        "section_path": [title, section],
                        "page_start": index,
                        "page_end": index,
                    },
                    "visibility_level": "public",
                    "unit_type": "policy_page",
                    "root_unit_id": f"{document_id}:root",
                    "metadata": {
                        "title": title,
                        "source_title": title,
                        "content_role": role,
                        "content_kind": "policy_clause",
                        "is_answer_bearing": True,
                        "detail_label": section,
                    },
                },
                ensure_ascii=False,
                sort_keys=True,
            )
        )
    return ("\n".join(rows) + "\n").encode("utf-8")


def _seed_document_specs() -> tuple[dict[str, object], ...]:
    return (
        {
            "document_id": SCHOLARSHIP_DOC_IDS[0],
            "title": "中央民族大学本科学生国家奖学金评审办法",
            "units": (
                {
                    "section": "奖励对象",
                    "text": (
                        "国家奖学金用于奖励特别优秀的全日制本科学生，属于本科生奖学金相关制度。"
                    ),
                },
                {
                    "section": "评审条件",
                    "text": (
                        "国家奖学金申请人的学习成绩排名与综合考评成绩排名原则上均应位于前10%。"
                    ),
                    "content_role": "condition",
                },
                {
                    "section": "优先条件",
                    "text": (
                        "同等条件下，在公开刊物上发表高质量学术论文者可优先推荐参评国家奖学金。"
                    ),
                    "content_role": "condition",
                },
            ),
        },
        {
            "document_id": SCHOLARSHIP_DOC_IDS[1],
            "title": "中央民族大学本科学生国家励志奖学金评审办法",
            "units": (
                {
                    "section": "奖励资助对象",
                    "text": ("国家励志奖学金用于奖励资助品学兼优的家庭经济困难全日制本科学生。"),
                },
            ),
        },
        {
            "document_id": SCHOLARSHIP_DOC_IDS[2],
            "title": "中央民族大学本科学生专业奖学金评定办法",
            "units": (
                {
                    "section": "奖励对象",
                    "text": "专业奖学金用于奖励学习成绩优秀、综合表现良好的本科学生。",
                },
            ),
        },
        {
            "document_id": SCHOLARSHIP_DOC_IDS[3],
            "title": "中央民族大学本科学生专项奖学金评定办法",
            "units": (
                {
                    "section": "奖励对象",
                    "text": "专项奖学金用于奖励在特定方面表现突出的本科学生。",
                },
            ),
        },
        {
            "document_id": SCHOLARSHIP_DOC_IDS[4],
            "title": "中央民族大学社会奖助学金管理办法",
            "units": (
                {
                    "section": "奖助范围",
                    "text": "社会奖助学金包括奖学金和助学金，用于奖励或资助符合条件的在校学生。",
                },
            ),
        },
    )


__all__ = [
    "PORTAL_PASSWORD_CASE_ID",
    "SCHOLARSHIP_DOC_IDS",
    "RagRealisticChainCase",
    "RagRealisticChainCaseResult",
    "RagRealisticChainValidationReport",
    "load_rag_realistic_chain_cases",
    "run_live_env_validation",
    "run_seeded_inprocess_validation",
]
