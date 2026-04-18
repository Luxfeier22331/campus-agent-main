from __future__ import annotations

import base64
from dataclasses import dataclass
import os
from string import Formatter

import httpx

from campus_contracts import (
    ClaimSupport,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    PromptTrace,
    RagResultDiagnostics,
    RagResultPayload,
    SupervisorObservability,
    SupervisorResponse,
)
from campus_evals.models import GoldenCase, ObservedTrace
from campus_evals.runtime_observability import current_runtime_event_context
from campus_evals.operator_observability import OperatorRequestCorrelation

_ALLOWED_CORRELATION_TEMPLATE_FIELDS = frozenset(
    {
        "case_id",
        "collection",
        "conversation_id",
        "corpus",
        "request_id",
        "selected_target",
        "status",
        "trace_id",
    }
)


@dataclass(frozen=True, slots=True)
class AppApiEvalClientSettings:
    app_api_base_url: str
    internal_shared_secret: str
    eval_user_email: str
    eval_user_id: str | None = None
    eval_user_name: str | None = None
    eval_principal_type: str = "campus_member"
    trace_link_template: str | None = None
    issue_link_template: str | None = None
    issue_fingerprint_template: str | None = None
    timeout_seconds: float = 15.0

    def __post_init__(self) -> None:
        if not self.app_api_base_url.strip():
            raise ValueError("app_api_base_url is required")
        if not self.internal_shared_secret.strip():
            raise ValueError("internal_shared_secret is required")
        if not self.eval_user_email.strip():
            raise ValueError("eval_user_email is required")
        for field in (
            "trace_link_template",
            "issue_link_template",
            "issue_fingerprint_template",
        ):
            template = _normalize_optional_string(getattr(self, field))
            if template is not None:
                _validate_correlation_template(field=field, template=template)
            object.__setattr__(self, field, template)
        if self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be greater than zero")

    @classmethod
    def from_env(
        cls,
        env: dict[str, str] | None = None,
        *,
        default_timeout_seconds: float = 15.0,
    ) -> "AppApiEvalClientSettings":
        source = env if env is not None else os.environ
        timeout_raw = str(source.get("APP_API_EVAL_HTTP_TIMEOUT_SECONDS") or "").strip()
        timeout_seconds = float(timeout_raw) if timeout_raw else default_timeout_seconds
        return cls(
            app_api_base_url=str(source.get("APP_API_BASE_URL") or "").strip(),
            internal_shared_secret=str(source.get("APP_API_INTERNAL_SHARED_SECRET") or "").strip(),
            eval_user_email=str(source.get("APP_API_EVAL_USER_EMAIL") or "").strip(),
            eval_user_id=_optional_string(source.get("APP_API_EVAL_USER_ID")),
            eval_user_name=_optional_string(source.get("APP_API_EVAL_USER_NAME")),
            eval_principal_type=str(source.get("APP_API_EVAL_PRINCIPAL_TYPE") or "campus_member").strip()
            or "campus_member",
            trace_link_template=_optional_string(source.get("APP_API_EVAL_TRACE_LINK_TEMPLATE")),
            issue_link_template=_optional_string(source.get("APP_API_EVAL_ISSUE_LINK_TEMPLATE")),
            issue_fingerprint_template=_optional_string(
                source.get("APP_API_EVAL_ISSUE_FINGERPRINT_TEMPLATE")
            ),
            timeout_seconds=timeout_seconds,
        )


class AppApiEvalClientError(RuntimeError):
    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        details: object = None,
    ) -> None:
        super().__init__(f"{code}: {message}")
        self.status_code = status_code
        self.code = code
        self.details = details


@dataclass(frozen=True, slots=True)
class AppApiEvalExecution:
    response: SupervisorResponse
    observed_trace: ObservedTrace
    request_correlation: OperatorRequestCorrelation
    conversation_id: str | None = None


class AppApiEvalClient:
    def __init__(
        self,
        *,
        settings: AppApiEvalClientSettings,
        client: httpx.Client | None = None,
    ) -> None:
        self.settings = settings
        self._client = client
        self._conversation_ids: dict[str, str] = {}

    def execute_knowledge_request(
        self,
        *,
        case: GoldenCase,
    ) -> AppApiEvalExecution:
        turns = case.conversation_turns or (case.user_goal,)
        conversation_key = self._resolve_conversation_key(case)
        conversation_id = self._conversation_ids.get(conversation_key)
        headers = self._build_eval_headers_for_case(case)
        execution: AppApiEvalExecution | None = None

        for prompt in turns:
            body: dict[str, object] = {
                "prompt": prompt,
                "requestedCapability": "knowledge",
                "requestedScope": {
                    "corpus": case.scope.corpus,
                    "collection": case.scope.collection,
                },
            }
            if conversation_id is not None:
                body["conversationId"] = conversation_id
            response = self._post_chat_request(body, headers=headers)
            execution = self._decode_execution(
                response=response,
                case_id=case.case_id,
                scope={
                    "corpus": case.scope.corpus,
                    "collection": case.scope.collection,
                },
            )
            conversation_id = execution.conversation_id

        if execution is None:
            raise ValueError(f"case {case.case_id} did not resolve any conversation turns")
        if conversation_key and conversation_id is not None:
            self._conversation_ids[conversation_key] = conversation_id
        return execution

    def _post_chat_request(self, body: dict[str, object], *, headers: dict[str, str]) -> httpx.Response:
        if self._client is not None:
            response = self._client.post(
                "/api/internal/evals/chat/requests",
                json=body,
                headers=headers,
            )
        else:
            with httpx.Client(
                base_url=self.settings.app_api_base_url.rstrip("/"),
                timeout=self.settings.timeout_seconds,
            ) as client:
                response = client.post(
                    "/api/internal/evals/chat/requests",
                    json=body,
                    headers=headers,
                )
        if response.status_code < 400:
            return response
        payload = _decode_json(response)
        error_payload = dict(payload.get("error") or {})
        raise AppApiEvalClientError(
            status_code=response.status_code,
            code=str(error_payload.get("code") or "app_api_eval_request_failed"),
            message=str(error_payload.get("message") or response.text or "request failed"),
            details=error_payload.get("details"),
        )

    def _build_eval_headers_for_case(self, case: GoldenCase) -> dict[str, str]:
        headers = {
            "x-app-internal-auth": self.settings.internal_shared_secret,
            "x-eval-user-email": self.settings.eval_user_email,
            "x-eval-principal-type": self.settings.eval_principal_type,
        }
        if self.settings.eval_user_id is not None:
            headers["x-eval-user-id"] = self.settings.eval_user_id
        if self.settings.eval_user_name is not None:
            headers["x-eval-user-name"] = self.settings.eval_user_name

        actor = case.actor
        if actor.principal_type:
            headers["x-eval-principal-type"] = actor.principal_type
        if actor.major:
            headers["x-eval-major"] = _encode_eval_header_value(actor.major)
        if actor.program:
            headers["x-eval-program"] = _encode_eval_header_value(actor.program)
        if actor.cohort:
            headers["x-eval-cohort"] = _encode_eval_header_value(actor.cohort)
        if actor.roles:
            headers["x-eval-actor-roles"] = ",".join(actor.roles)
        if actor.departments:
            headers["x-eval-departments"] = ",".join(actor.departments)
        return headers

    def _decode_execution(
        self,
        *,
        response: httpx.Response,
        case_id: str,
        scope: dict[str, str],
    ) -> AppApiEvalExecution:
        payload = _decode_json(response)
        answer = dict(payload.get("answer") or {})
        conversation = dict(answer.get("conversation") or {})
        result = dict(answer.get("result") or {})
        supervisor_payload = _optional_record(payload.get("supervisor"))
        request_id = _required_string(
            result.get("requestId") or response.headers.get("x-request-id"),
            "answer.result.requestId",
        )
        trace_id = _required_string(
            result.get("traceId") or response.headers.get("x-trace-id"),
            "answer.result.traceId",
        )
        sampled_at = _required_string(
            conversation.get("updatedAt") or conversation.get("createdAt"),
            "answer.conversation.updatedAt",
        )
        execution_response = (
            _build_supervisor_response_from_internal_eval(supervisor_payload)
            if supervisor_payload is not None
            else _build_supervisor_response(result)
        )
        observed_trace = _build_observed_trace(
            scope=scope,
            response=execution_response,
        )
        conversation_id = _optional_string(conversation.get("id"))
        correlation_template_values = {
            "case_id": case_id,
            "collection": scope["collection"],
            "conversation_id": conversation_id or "",
            "corpus": scope["corpus"],
            "request_id": request_id,
            "selected_target": execution_response.selected_target or "",
            "status": execution_response.status,
            "trace_id": trace_id,
        }
        correlation = OperatorRequestCorrelation(
            case_id=case_id,
            request_id=request_id,
            trace_id=trace_id,
            sampled_at=sampled_at,
            trace_link=_render_correlation_template(
                self.settings.trace_link_template,
                correlation_template_values,
            ),
            issue_link=_render_correlation_template(
                self.settings.issue_link_template,
                correlation_template_values,
            ),
            issue_fingerprint=_render_correlation_template(
                self.settings.issue_fingerprint_template,
                correlation_template_values,
            ),
        )
        return AppApiEvalExecution(
            response=execution_response,
            observed_trace=observed_trace,
            request_correlation=correlation,
            conversation_id=conversation_id,
        )

    def _resolve_conversation_key(self, case: GoldenCase) -> str:
        metadata_key = _optional_string(case.metadata.get("conversation_key"))
        if metadata_key:
            return metadata_key
        runtime_context = current_runtime_event_context()
        run_number = runtime_context.get("run_number")
        if not case.conversation_turns:
            return ""
        run_suffix = f":run-{int(run_number):02d}" if isinstance(run_number, int) else ""
        return f"{case.case_id}{run_suffix}"


def _build_supervisor_response(result: dict[str, object]) -> SupervisorResponse:
    kind = _required_string(result.get("kind"), "answer.result.kind")
    request_id = _required_string(result.get("requestId"), "answer.result.requestId")
    del request_id
    trace_id = _required_string(result.get("traceId"), "answer.result.traceId")
    del trace_id

    if kind == "answer":
        return SupervisorResponse(
            selected_target="rag-specialist",
            status="completed",
            answer_text=_required_string(result.get("text"), "answer.result.text"),
            confidence="low",
            result=None,
        )
    if kind == "clarification":
        follow_up = _required_string(result.get("text"), "answer.result.text")
        return SupervisorResponse(
            selected_target="rag-specialist",
            status="needs_clarification",
            answer_text=follow_up,
            follow_up_question=follow_up,
            confidence="low",
            result=None,
        )
    if kind == "no_answer":
        return SupervisorResponse(
            selected_target="rag-specialist",
            status="no_answer",
            answer_text=_required_string(result.get("text"), "answer.result.text"),
            confidence="low",
            result=None,
        )
    if kind == "error":
        message = _required_string(result.get("message"), "answer.result.message")
        error_code = _required_string(result.get("errorCode"), "answer.result.errorCode")
        return SupervisorResponse(
            selected_target=None,
            status="error",
            answer_text=message,
            confidence="low",
            error=ErrorInfo(
                code=error_code,
                message=message,
                retryable=bool(result.get("retryable")),
            ),
            result=None,
        )
    raise ValueError(f"unsupported app-api result kind: {kind}")


def _validate_correlation_template(*, field: str, template: str) -> None:
    unsupported_fields = sorted(
        {
            name
            for _, name, _, _ in Formatter().parse(template)
            if name and name not in _ALLOWED_CORRELATION_TEMPLATE_FIELDS
        }
    )
    if unsupported_fields:
        joined = ", ".join(unsupported_fields)
        raise ValueError(f"{field} contains unsupported template fields: {joined}")


def _render_correlation_template(
    template: str | None,
    values: dict[str, str],
) -> str | None:
    if template is None:
        return None
    rendered = template.format(**values).strip()
    return rendered or None


def _build_supervisor_response_from_internal_eval(payload: dict[str, object]) -> SupervisorResponse:
    status = _required_string(payload.get("status"), "supervisor.status")
    selected_target = _optional_string(payload.get("selectedTarget"))
    answer_text = _optional_string(payload.get("answerText")) or ""
    follow_up_question = _optional_string(payload.get("followUpQuestion")) or ""
    trace_id = _required_string(payload.get("traceId"), "supervisor.traceId")
    del trace_id
    error_payload = _optional_record(payload.get("error"))

    error = None
    if error_payload is not None:
        error = ErrorInfo(
            code=_required_string(error_payload.get("code"), "supervisor.error.code"),
            message=_required_string(error_payload.get("message"), "supervisor.error.message"),
            retryable=bool(error_payload.get("retryable")),
        )

    return SupervisorResponse(
        selected_target=selected_target,
        status=status,  # type: ignore[arg-type]
        answer_text=answer_text,
        follow_up_question=follow_up_question,
        confidence="low",
        result=_parse_supervisor_result(payload.get("result")),
        error=error,
        observability=_parse_supervisor_observability(payload.get("observability")),
    )


def _parse_supervisor_result(value: object) -> RagResultPayload | None:
    record = _optional_record(value)
    evidence_record = _optional_record(record.get("evidence")) if record is not None else None
    if evidence_record is None:
        return None
    return RagResultPayload(
        evidence=EvidenceBundle(
            query_text=_optional_string(evidence_record.get("query_text")) or "",
            corpus=_required_string(evidence_record.get("corpus"), "supervisor.result.evidence.corpus"),
            collection=_required_string(
                evidence_record.get("collection"),
                "supervisor.result.evidence.collection",
            ),
            sources=tuple(
                _parse_evidence_source(item, field=f"supervisor.result.evidence.sources[{index}]")
                for index, item in enumerate(_optional_list(evidence_record.get("sources")))
            ),
        ),
        diagnostics=_parse_rag_result_diagnostics(record.get("diagnostics")),
    )


def _parse_evidence_source(value: object, *, field: str) -> EvidenceSource:
    record = _optional_record(value)
    if record is None:
        raise ValueError(f"{field} must be an object")
    return EvidenceSource(
        doc_id=_required_string(record.get("doc_id"), f"{field}.doc_id"),
        revision_track=_required_string(record.get("revision_track"), f"{field}.revision_track"),
        version_id=_required_string(record.get("version_id"), f"{field}.version_id"),
        chunk_id=_required_string(record.get("chunk_id"), f"{field}.chunk_id"),
        anchor=_optional_record(record.get("anchor")) or {},
        canonical_url=_required_string(record.get("canonical_url"), f"{field}.canonical_url"),
        latest_url=_required_string(record.get("latest_url"), f"{field}.latest_url"),
        source_channel=_required_string(record.get("source_channel"), f"{field}.source_channel"),
        collection=_required_string(record.get("collection"), f"{field}.collection"),
        is_current=bool(record.get("is_current")),
        snippet=_required_string(record.get("snippet"), f"{field}.snippet"),
        score=float(record.get("score") or 0.0),
        source_title=_optional_string(record.get("source_title")) or "",
        canonical_source_id=_optional_string(record.get("canonical_source_id")) or "",
        canonical_source_title=_optional_string(record.get("canonical_source_title")) or "",
        source_unit_kind=_optional_string(record.get("source_unit_kind")) or "",
        source_unit_key=_optional_string(record.get("source_unit_key")) or "",
    )


def _parse_observed_source(value: object, *, field: str) -> EvidenceSource:
    record = _optional_record(value)
    if record is None:
        raise ValueError(f"{field} must be an object")
    if "revision_track" in record and "version_id" in record and "canonical_url" in record:
        return _parse_evidence_source(record, field=field)

    doc_id = _required_string(
        record.get("doc_id") if "doc_id" in record else record.get("docId"),
        f"{field}.doc_id",
    )
    chunk_id = _optional_string(record.get("chunk_id") if "chunk_id" in record else record.get("chunkId"))
    collection = _required_string(
        record.get("collection") if "collection" in record else record.get("collection"),
        f"{field}.collection",
    )
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=_optional_string(record.get("version_id") if "version_id" in record else record.get("versionId"))
        or "observed-trace",
        chunk_id=chunk_id or f"{doc_id}:observed-trace",
        anchor=_optional_record(record.get("anchor")) or {},
        canonical_url=_optional_string(
            record.get("canonical_url") if "canonical_url" in record else record.get("canonicalUrl")
        )
        or "",
        latest_url=_optional_string(
            record.get("latest_url") if "latest_url" in record else record.get("latestUrl")
        )
        or "",
        source_channel=_optional_string(
            record.get("source_channel") if "source_channel" in record else record.get("sourceChannel")
        )
        or "pdf_ocr",
        collection=collection,
        is_current=bool(record.get("is_current") if "is_current" in record else record.get("isCurrent")),
        snippet=_optional_string(record.get("snippet")) or "",
        score=float(record.get("score") or 0.0),
        source_title=_optional_string(record.get("source_title") if "source_title" in record else record.get("sourceTitle"))
        or "",
        canonical_source_id=_optional_string(
            record.get("canonical_source_id")
            if "canonical_source_id" in record
            else record.get("canonicalSourceId")
        )
        or "",
        canonical_source_title=_optional_string(
            record.get("canonical_source_title")
            if "canonical_source_title" in record
            else record.get("canonicalSourceTitle")
        )
        or "",
        source_unit_kind=_optional_string(
            record.get("source_unit_kind")
            if "source_unit_kind" in record
            else record.get("sourceUnitKind")
        )
        or "",
        source_unit_key=_optional_string(
            record.get("source_unit_key")
            if "source_unit_key" in record
            else record.get("sourceUnitKey")
        )
        or "",
    )


def _parse_supervisor_observability(value: object) -> SupervisorObservability | None:
    record = _optional_record(value)
    if record is None:
        return None
    return SupervisorObservability(
        retrieval_attempted=_optional_bool(
            record.get("retrievalAttempted") if "retrievalAttempted" in record else record.get("retrieval_attempted")
        ),
        candidate_count=_optional_int(
            record.get("candidateCount") if "candidateCount" in record else record.get("candidate_count")
        ),
        retrieved_source_count=_optional_int(
            record.get("retrievedSourceCount")
            if "retrievedSourceCount" in record
            else record.get("retrieved_source_count")
        ),
        retrieved_sources=tuple(
            _parse_observed_source(
                item,
                field=f"supervisor.observability.retrieved_sources[{index}]",
            )
            for index, item in enumerate(
                _optional_list(
                    record.get("retrievedSources")
                    if "retrievedSources" in record
                    else record.get("retrieved_sources")
                )
            )
        ),
        citation_expected=_optional_bool(
            record.get("citationExpected") if "citationExpected" in record else record.get("citation_expected")
        ),
        citation_count=_optional_int(
            record.get("citationCount") if "citationCount" in record else record.get("citation_count")
        ),
        citation_missing=_optional_bool(
            record.get("citationMissing") if "citationMissing" in record else record.get("citation_missing")
        ),
        refusal_class=_optional_string(
            record.get("refusalClass") if "refusalClass" in record else record.get("refusal_class")
        )
        or "",
        semantic_outcome=_optional_string(
            record.get("semanticOutcome") if "semanticOutcome" in record else record.get("semantic_outcome")
        )
        or "",
        scope_class=_optional_string(
            record.get("scopeClass") if "scopeClass" in record else record.get("scope_class")
        )
        or "",
        policy_reason=_optional_string(
            record.get("policyReason") if "policyReason" in record else record.get("policy_reason")
        )
        or "",
        acl_decision=_optional_string(
            record.get("aclDecision") if "aclDecision" in record else record.get("acl_decision")
        )
        or "",
        acl_anomaly_code=_optional_string(
            record.get("aclAnomalyCode") if "aclAnomalyCode" in record else record.get("acl_anomaly_code")
        )
        or "",
        fail_closed=_optional_bool(record.get("failClosed") if "failClosed" in record else record.get("fail_closed")),
        model_provider=_optional_string(
            record.get("modelProvider") if "modelProvider" in record else record.get("model_provider")
        )
        or "",
        model_name=_optional_string(record.get("modelName") if "modelName" in record else record.get("model_name"))
        or "",
        input_tokens=_optional_int(record.get("inputTokens") if "inputTokens" in record else record.get("input_tokens")),
        output_tokens=_optional_int(
            record.get("outputTokens") if "outputTokens" in record else record.get("output_tokens")
        ),
        cached_input_tokens=_optional_int(
            record.get("cachedInputTokens")
            if "cachedInputTokens" in record
            else record.get("cached_input_tokens")
        ),
        estimated_cost_microusd=_optional_int(
            record.get("estimatedCostMicrousd")
            if "estimatedCostMicrousd" in record
            else record.get("estimated_cost_microusd")
        ),
        resolved_scope_corpus=_optional_string(
            record.get("resolvedScopeCorpus")
            if "resolvedScopeCorpus" in record
            else record.get("resolved_scope_corpus")
        ),
        resolved_scope_collection=_optional_string(
            record.get("resolvedScopeCollection")
            if "resolvedScopeCollection" in record
            else record.get("resolved_scope_collection")
        )
        or "",
        prompt_runtime_state=_optional_string(
            record.get("promptRuntimeState")
            if "promptRuntimeState" in record
            else record.get("prompt_runtime_state")
        )
        or "",
        prompt_runtime_detail=_optional_string(
            record.get("promptRuntimeDetail")
            if "promptRuntimeDetail" in record
            else record.get("prompt_runtime_detail")
        )
        or "",
        prompt_trace=_parse_prompt_trace(
            record.get("promptTrace") if "promptTrace" in record else record.get("prompt_trace")
        ),
    )


def _parse_rag_result_diagnostics(value: object) -> RagResultDiagnostics | None:
    record = _optional_record(value)
    if record is None:
        return None
    return RagResultDiagnostics(
        resolved_scope_corpus=_optional_string(
            record.get("resolved_scope_corpus")
            if "resolved_scope_corpus" in record
            else record.get("resolvedScopeCorpus")
        ),
        resolved_scope_collection=_optional_string(
            record.get("resolved_scope_collection")
            if "resolved_scope_collection" in record
            else record.get("resolvedScopeCollection")
        )
        or "",
        resolved_policy_document_id=_optional_string(
            record.get("resolved_policy_document_id")
            if "resolved_policy_document_id" in record
            else record.get("resolvedPolicyDocumentId")
        )
        or "",
        resolved_policy_title=_optional_string(
            record.get("resolved_policy_title")
            if "resolved_policy_title" in record
            else record.get("resolvedPolicyTitle")
        )
        or "",
        rewritten_query=_optional_string(
            record.get("rewritten_query") if "rewritten_query" in record else record.get("rewrittenQuery")
        )
        or "",
        clarification_reason=_optional_string(
            record.get("clarification_reason")
            if "clarification_reason" in record
            else record.get("clarificationReason")
        )
        or "",
        no_answer_reason=_optional_string(
            record.get("no_answer_reason") if "no_answer_reason" in record else record.get("noAnswerReason")
        )
        or "",
        semantic_outcome=_optional_string(
            record.get("semantic_outcome") if "semantic_outcome" in record else record.get("semanticOutcome")
        )
        or "",
        retrieval_adequacy_verdict=_optional_string(
            record.get("retrieval_adequacy_verdict")
            if "retrieval_adequacy_verdict" in record
            else record.get("retrievalAdequacyVerdict")
        )
        or "",
        retrieval_adequacy_reason=_optional_string(
            record.get("retrieval_adequacy_reason")
            if "retrieval_adequacy_reason" in record
            else record.get("retrievalAdequacyReason")
        )
        or "",
        grounding_verdict=_optional_string(
            record.get("grounding_verdict")
            if "grounding_verdict" in record
            else record.get("groundingVerdict")
        )
        or "",
        grounding_downgraded=_optional_bool(
            record.get("grounding_downgraded")
            if "grounding_downgraded" in record
            else record.get("groundingDowngraded")
        )
        or False,
        freshness_fail_closed=_optional_bool(
            record.get("freshness_fail_closed")
            if "freshness_fail_closed" in record
            else record.get("freshnessFailClosed")
        )
        or False,
        scope_class=_optional_string(
            record.get("scope_class") if "scope_class" in record else record.get("scopeClass")
        )
        or "",
        policy_reason=_optional_string(
            record.get("policy_reason") if "policy_reason" in record else record.get("policyReason")
        )
        or "",
        retrieved_title_summary=_string_tuple(
            record.get("retrieved_title_summary")
            if "retrieved_title_summary" in record
            else record.get("retrievedTitleSummary")
        ),
        candidate_title_summary=_string_tuple(
            record.get("candidate_title_summary")
            if "candidate_title_summary" in record
            else record.get("candidateTitleSummary")
        ),
        resolution_mode=_optional_string(
            record.get("resolution_mode") if "resolution_mode" in record else record.get("resolutionMode")
        )
        or "",
        used_verified_identity=_optional_bool(
            record.get("used_verified_identity")
            if "used_verified_identity" in record
            else record.get("usedVerifiedIdentity")
        )
        or False,
        used_soft_preference=_optional_bool(
            record.get("used_soft_preference")
            if "used_soft_preference" in record
            else record.get("usedSoftPreference")
        )
        or False,
        resolved_entity_type=_optional_string(
            record.get("resolved_entity_type")
            if "resolved_entity_type" in record
            else record.get("resolvedEntityType")
        )
        or "",
        resolved_course_id=_optional_string(
            record.get("resolved_course_id") if "resolved_course_id" in record else record.get("resolvedCourseId")
        )
        or "",
        resolved_course_title=_optional_string(
            record.get("resolved_course_title")
            if "resolved_course_title" in record
            else record.get("resolvedCourseTitle")
        )
        or "",
        resolved_course_family_id=_optional_string(
            record.get("resolved_course_family_id")
            if "resolved_course_family_id" in record
            else record.get("resolvedCourseFamilyId")
        )
        or "",
        resolved_course_family_title=_optional_string(
            record.get("resolved_course_family_title")
            if "resolved_course_family_title" in record
            else record.get("resolvedCourseFamilyTitle")
        )
        or "",
        resolved_program_family_id=_optional_string(
            record.get("resolved_program_family_id")
            if "resolved_program_family_id" in record
            else record.get("resolvedProgramFamilyId")
        )
        or "",
        resolved_program_family_title=_optional_string(
            record.get("resolved_program_family_title")
            if "resolved_program_family_title" in record
            else record.get("resolvedProgramFamilyTitle")
        )
        or "",
        session_program_family=_optional_string(
            record.get("session_program_family")
            if "session_program_family" in record
            else record.get("sessionProgramFamily")
        )
        or "",
        session_program=_optional_string(
            record.get("session_program") if "session_program" in record else record.get("sessionProgram")
        )
        or "",
        session_semester=_optional_string(
            record.get("session_semester")
            if "session_semester" in record
            else record.get("sessionSemester")
        )
        or "",
        claim_supports=tuple(
            _parse_claim_support(
                item,
                field=f"supervisor.result.diagnostics.claim_supports[{index}]",
            )
            for index, item in enumerate(
                _optional_list(
                    record.get("claim_supports")
                    if "claim_supports" in record
                    else record.get("claimSupports")
                )
            )
        ),
        unsupported_fields=_string_tuple(
            record.get("unsupported_fields")
            if "unsupported_fields" in record
            else record.get("unsupportedFields")
        ),
        partial_answer=_optional_bool(
            record.get("partial_answer") if "partial_answer" in record else record.get("partialAnswer")
        )
        or False,
        prompt_runtime_state=_optional_string(
            record.get("prompt_runtime_state")
            if "prompt_runtime_state" in record
            else record.get("promptRuntimeState")
        )
        or "",
        prompt_runtime_detail=_optional_string(
            record.get("prompt_runtime_detail")
            if "prompt_runtime_detail" in record
            else record.get("promptRuntimeDetail")
        )
        or "",
        prompt_trace=_parse_prompt_trace(
            record.get("prompt_trace") if "prompt_trace" in record else record.get("promptTrace")
        ),
        retrieved_sources=tuple(
            _parse_observed_source(
                item,
                field=f"supervisor.result.diagnostics.retrieved_sources[{index}]",
            )
            for index, item in enumerate(
                _optional_list(
                    record.get("retrieved_sources")
                    if "retrieved_sources" in record
                    else record.get("retrievedSources")
                )
            )
        ),
    )


def _parse_prompt_trace(value: object) -> PromptTrace | None:
    record = _optional_record(value)
    if record is None:
        return None
    return PromptTrace(
        prompt_id=_optional_string(record.get("prompt_id") if "prompt_id" in record else record.get("promptId"))
        or "",
        prompt_version=_optional_string(
            record.get("prompt_version") if "prompt_version" in record else record.get("promptVersion")
        )
        or "",
        template_sha256=_optional_string(
            record.get("template_sha256") if "template_sha256" in record else record.get("templateSha256")
        )
        or "",
        variables_schema_version=_optional_string(
            record.get("variables_schema_version")
            if "variables_schema_version" in record
            else record.get("variablesSchemaVersion")
        )
        or "",
        output_schema_version=_optional_string(
            record.get("output_schema_version")
            if "output_schema_version" in record
            else record.get("outputSchemaVersion")
        )
        or "",
        model_provider=_optional_string(
            record.get("model_provider") if "model_provider" in record else record.get("modelProvider")
        )
        or "",
        model_name=_optional_string(record.get("model_name") if "model_name" in record else record.get("modelName"))
        or "",
    )


def _parse_claim_support(value: object, *, field: str) -> ClaimSupport:
    record = _optional_record(value)
    if record is None:
        raise ValueError(f"{field} must be an object")
    return ClaimSupport(
        claim_type=_required_string(
            record.get("claim_type") if "claim_type" in record else record.get("claimType"),
            f"{field}.claim_type",
        ),
        claim_text=_required_string(
            record.get("claim_text") if "claim_text" in record else record.get("claimText"),
            f"{field}.claim_text",
        ),
        supported=bool(record.get("supported")),
        support_source_doc_id=_optional_string(
            record.get("support_source_doc_id")
            if "support_source_doc_id" in record
            else record.get("supportSourceDocId")
        )
        or "",
        support_snippet=_optional_string(
            record.get("support_snippet")
            if "support_snippet" in record
            else record.get("supportSnippet")
        )
        or "",
    )


def _build_observed_trace(*, scope: dict[str, str], response: SupervisorResponse) -> ObservedTrace:
    retrieved_sources = ()
    supporting_sources = ()
    if isinstance(response.result, RagResultPayload):
        supporting_sources = tuple(response.result.evidence.sources)
        if response.observability is not None and response.observability.retrieved_sources:
            retrieved_sources = tuple(response.observability.retrieved_sources)
        elif response.result.diagnostics is not None and response.result.diagnostics.retrieved_sources:
            retrieved_sources = tuple(response.result.diagnostics.retrieved_sources)
        elif (
            response.observability is not None
            and response.observability.retrieval_attempted is True
            and supporting_sources
        ):
            retrieved_sources = supporting_sources

    retrieval_called = (
        response.observability.retrieval_attempted
        if response.observability is not None
        else None
    )
    if retrieval_called is None and isinstance(response.result, RagResultPayload):
        retrieval_called = bool(retrieved_sources or supporting_sources)

    return ObservedTrace(
        selected_scope=KnowledgeScope(
            corpus=_required_string(scope.get("corpus"), "scope.corpus"),
            collection=_required_string(scope.get("collection"), "scope.collection"),
        ),
        retrieval_called=retrieval_called,
        clarification_emitted=response.status == "needs_clarification",
        error_path=response.status == "error",
        retrieved_sources=retrieved_sources,
        supporting_sources=supporting_sources,
    )


def _optional_record(value: object) -> dict[str, object] | None:
    if value and isinstance(value, dict):
        return dict(value)
    return None


def _optional_list(value: object) -> list[object]:
    return list(value) if isinstance(value, list) else []


def _string_tuple(value: object) -> tuple[str, ...]:
    return tuple(
        item
        for item in (_optional_string(item) for item in _optional_list(value))
        if item is not None
    )


def _optional_bool(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


def _optional_int(value: object) -> int | None:
    return int(value) if isinstance(value, int) and not isinstance(value, bool) else None


def _required_string(value: object, field: str) -> str:
    normalized = _optional_string(value)
    if normalized is None:
        raise ValueError(f"{field} is required")
    return normalized


def _optional_string(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _normalize_optional_string(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _encode_eval_header_value(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return ""
    try:
        normalized.encode("ascii")
    except UnicodeEncodeError:
        return f"b64:{base64.b64encode(normalized.encode('utf-8')).decode('ascii')}"
    return normalized


def _decode_json(response: httpx.Response) -> dict[str, object]:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return dict(payload or {})
