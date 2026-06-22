from __future__ import annotations

import os
from dataclasses import dataclass

import httpx
from campus_contracts import ExecutionResponse

from campus_evals.models import GoldenCase, ObservedTrace
from campus_evals.operator_observability import OperatorRequestCorrelation
from campus_evals.runtime_observability import current_runtime_event_context

from .app_api_chat_runtime_decoding import (
    _build_execution_response,
    _build_execution_response_from_internal_eval,
    _build_observed_trace,
)
from .app_api_chat_runtime_support import (
    _decode_json,
    _encode_eval_header_value,
    _normalize_optional_string,
    _optional_record,
    _optional_string,
    _render_correlation_template,
    _required_string,
    _validate_correlation_template,
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
    ) -> AppApiEvalClientSettings:
        source = env if env is not None else os.environ
        timeout_raw = str(source.get("APP_API_EVAL_HTTP_TIMEOUT_SECONDS") or "").strip()
        timeout_seconds = float(timeout_raw) if timeout_raw else default_timeout_seconds
        return cls(
            app_api_base_url=str(source.get("APP_API_BASE_URL") or "").strip(),
            internal_shared_secret=str(source.get("APP_API_INTERNAL_SHARED_SECRET") or "").strip(),
            eval_user_email=str(source.get("APP_API_EVAL_USER_EMAIL") or "").strip(),
            eval_user_id=_optional_string(source.get("APP_API_EVAL_USER_ID")),
            eval_user_name=_optional_string(source.get("APP_API_EVAL_USER_NAME")),
            eval_principal_type=str(
                source.get("APP_API_EVAL_PRINCIPAL_TYPE") or "campus_member"
            ).strip()
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
    response: ExecutionResponse
    observed_trace: ObservedTrace | None
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
            version_query_body = self._build_version_query_body(case)
            if version_query_body is not None:
                body["versionQuery"] = version_query_body
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

    def execute_chat_request(
        self,
        *,
        case_id: str,
        prompt: str,
        requested_capability: str | None = None,
        requested_scope: dict[str, str] | None = None,
        body: dict[str, object] | None = None,
        conversation_key: str | None = None,
    ) -> AppApiEvalExecution:
        normalized_case_id = case_id.strip()
        if not normalized_case_id:
            raise ValueError("case_id is required")
        normalized_prompt = prompt.strip()
        if not normalized_prompt:
            raise ValueError("prompt is required")

        request_body = dict(body or {})
        request_body.setdefault("prompt", normalized_prompt)
        if requested_capability:
            request_body.setdefault("requestedCapability", requested_capability)
        if requested_scope is not None:
            request_body.setdefault("requestedScope", dict(requested_scope))

        resolved_scope = {
            "corpus": str((requested_scope or {}).get("corpus") or ""),
            "collection": str((requested_scope or {}).get("collection") or ""),
        }
        resolved_conversation_key = conversation_key or normalized_case_id
        conversation_id = self._conversation_ids.get(resolved_conversation_key)
        if conversation_id is not None and "conversationId" not in request_body:
            request_body["conversationId"] = conversation_id

        response = self._post_chat_request(request_body, headers=self._build_base_eval_headers())
        execution = self._decode_execution(
            response=response,
            case_id=normalized_case_id,
            scope=resolved_scope,
        )
        if execution.conversation_id is not None:
            self._conversation_ids[resolved_conversation_key] = execution.conversation_id
        return execution

    def _build_version_query_body(self, case: GoldenCase) -> dict[str, object] | None:
        version_query = case.version_query
        if version_query.mode == "current":
            return None

        body: dict[str, object] = {"mode": version_query.mode}
        if version_query.as_of:
            body["asOf"] = version_query.as_of
        if version_query.version_id:
            body["versionId"] = version_query.version_id
        if version_query.compare_to_version_id:
            body["compareToVersionId"] = version_query.compare_to_version_id
        return body

    def _post_chat_request(
        self, body: dict[str, object], *, headers: dict[str, str]
    ) -> httpx.Response:
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
        headers = self._build_base_eval_headers()

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

    def _build_base_eval_headers(self) -> dict[str, str]:
        headers = {
            "x-app-internal-auth": self.settings.internal_shared_secret,
            "x-eval-user-email": self.settings.eval_user_email,
            "x-eval-principal-type": self.settings.eval_principal_type,
        }
        if self.settings.eval_user_id is not None:
            headers["x-eval-user-id"] = self.settings.eval_user_id
        if self.settings.eval_user_name is not None:
            headers["x-eval-user-name"] = self.settings.eval_user_name
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
            _build_execution_response_from_internal_eval(supervisor_payload)
            if supervisor_payload is not None
            else _build_execution_response(result)
        )
        observed_trace = (
            _build_observed_trace(
                scope=scope,
                response=execution_response,
            )
            if scope.get("corpus") and scope.get("collection")
            else None
        )
        conversation_id = _optional_string(conversation.get("id"))
        correlation_template_values = {
            "case_id": case_id,
            "collection": scope.get("collection") or "",
            "conversation_id": conversation_id or "",
            "corpus": scope.get("corpus") or "",
            "request_id": request_id,
            "selected_capability": execution_response.selected_capability or "",
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
