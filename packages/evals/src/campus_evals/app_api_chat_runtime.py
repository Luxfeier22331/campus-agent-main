from __future__ import annotations

from dataclasses import dataclass
import os

import httpx

from campus_contracts import (
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagResultPayload,
    SupervisorObservability,
    SupervisorResponse,
)
from campus_evals.models import GoldenCase, ObservedTrace
from campus_evals.runtime_observability import current_runtime_event_context
from campus_evals.operator_observability import OperatorRequestCorrelation


@dataclass(frozen=True, slots=True)
class AppApiEvalClientSettings:
    app_api_base_url: str
    internal_shared_secret: str
    eval_user_email: str
    eval_user_id: str | None = None
    eval_user_name: str | None = None
    eval_principal_type: str = "public_user"
    timeout_seconds: float = 15.0

    def __post_init__(self) -> None:
        if not self.app_api_base_url.strip():
            raise ValueError("app_api_base_url is required")
        if not self.internal_shared_secret.strip():
            raise ValueError("internal_shared_secret is required")
        if not self.eval_user_email.strip():
            raise ValueError("eval_user_email is required")
        if self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be greater than zero")

    @classmethod
    def from_env(
        cls,
        env: dict[str, str] | None = None,
    ) -> "AppApiEvalClientSettings":
        source = env if env is not None else os.environ
        timeout_raw = str(source.get("APP_API_EVAL_HTTP_TIMEOUT_SECONDS") or "").strip()
        timeout_seconds = float(timeout_raw) if timeout_raw else 15.0
        return cls(
            app_api_base_url=str(source.get("APP_API_BASE_URL") or "").strip(),
            internal_shared_secret=str(source.get("APP_API_INTERNAL_SHARED_SECRET") or "").strip(),
            eval_user_email=str(source.get("APP_API_EVAL_USER_EMAIL") or "").strip(),
            eval_user_id=_optional_string(source.get("APP_API_EVAL_USER_ID")),
            eval_user_name=_optional_string(source.get("APP_API_EVAL_USER_NAME")),
            eval_principal_type=str(source.get("APP_API_EVAL_PRINCIPAL_TYPE") or "public_user").strip() or "public_user",
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
            response = self._post_chat_request(body)
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

    def _post_chat_request(self, body: dict[str, object]) -> httpx.Response:
        headers = {
            "x-app-internal-auth": self.settings.internal_shared_secret,
            "x-eval-user-email": self.settings.eval_user_email,
            "x-eval-principal-type": self.settings.eval_principal_type,
        }
        if self.settings.eval_user_id is not None:
            headers["x-eval-user-id"] = self.settings.eval_user_id
        if self.settings.eval_user_name is not None:
            headers["x-eval-user-name"] = self.settings.eval_user_name

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
        correlation = OperatorRequestCorrelation(
            case_id=case_id,
            request_id=request_id,
            trace_id=trace_id,
            sampled_at=sampled_at,
        )
        return AppApiEvalExecution(
            response=execution_response,
            observed_trace=observed_trace,
            request_correlation=correlation,
            conversation_id=_optional_string(conversation.get("id")),
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
        )
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
    )


def _build_observed_trace(*, scope: dict[str, str], response: SupervisorResponse) -> ObservedTrace:
    retrieved_sources = ()
    supporting_sources = ()
    if isinstance(response.result, RagResultPayload):
        supporting_sources = tuple(response.result.evidence.sources)
        if response.observability is None or response.observability.retrieval_attempted is not False:
            retrieved_sources = supporting_sources

    retrieval_called = (
        response.observability.retrieval_attempted
        if response.observability is not None
        else None
    )
    if retrieval_called is None and isinstance(response.result, RagResultPayload):
        retrieval_called = len(response.result.evidence.sources) > 0

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


def _decode_json(response: httpx.Response) -> dict[str, object]:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return dict(payload or {})
