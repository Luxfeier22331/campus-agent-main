from __future__ import annotations

import json
from threading import Lock
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from .config import PromptRuntimeProviderConfig
from .constants import is_sha256_hex
from .contracts import PromptMessageLike, PromptStackLike, StructuredOutputModel
from .errors import PromptRuntimeValidationError
from .http_client import build_prompt_runtime_http_client
from .models import StructuredOutputExecutionResult
from .normalization import normalize_provider_grounding_supports

StructuredOutputResultT = TypeVar("StructuredOutputResultT", bound=BaseModel)


class ResponsesStructuredOutputExecutor:
    def __init__(
        self,
        provider_config: PromptRuntimeProviderConfig,
        *,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._provider_config = provider_config
        self._http_client = http_client
        self._owns_http_client = http_client is None
        self._http_client_lock = Lock()

    def execute(
        self,
        stack: PromptStackLike,
        *,
        response_model: type[StructuredOutputModel],
        safety_identifier: str | None = None,
    ) -> StructuredOutputModel:
        return self.execute_with_metadata(
            stack,
            response_model=response_model,
            safety_identifier=safety_identifier,
        ).output

    def execute_with_metadata(
        self,
        stack: PromptStackLike,
        *,
        response_model: type[StructuredOutputModel],
        safety_identifier: str | None = None,
    ) -> StructuredOutputExecutionResult[StructuredOutputModel]:
        if stack.model_provider != self._provider_config.provider:
            raise PromptRuntimeValidationError(
                prompt_id=stack.prompt_id,
                reason=(f"stack model_provider mismatch: {stack.model_provider or '<empty>'}"),
            )
        if not stack.model_name.strip():
            raise PromptRuntimeValidationError(
                prompt_id=stack.prompt_id,
                reason="stack model_name must be non-empty",
            )
        try:
            payload = _build_responses_structured_payload(
                model=stack.model_name,
                messages=stack.messages,
                response_model=response_model,
                reasoning_effort=self._provider_config.reasoning_effort,
                max_output_tokens=self._provider_config.max_output_tokens,
                safety_identifier=(
                    normalize_optional_safety_identifier(safety_identifier)
                    if self._provider_config.supports_safety_identifier
                    else None
                ),
            )
        except ValueError as exc:
            raise PromptRuntimeValidationError(
                prompt_id=stack.prompt_id,
                reason=str(exc),
            ) from exc
        try:
            response_json = _decode_json_response(
                self._get_http_client().post(
                    "/responses",
                    json=payload,
                    headers=_build_headers(self._provider_config.api_key),
                    timeout=self._provider_config.http_settings.to_httpx_timeout(),
                )
            )
        except PromptRuntimeValidationError:
            raise
        except Exception as exc:
            raise PromptRuntimeValidationError(
                prompt_id=stack.prompt_id,
                reason=f"provider_request_failed: {exc}",
            ) from exc
        _raise_for_non_successful_runtime_state(response_json, prompt_id=stack.prompt_id)
        refusal_text = _extract_refusal_text(response_json)
        if refusal_text is not None:
            raise PromptRuntimeValidationError(
                prompt_id=stack.prompt_id,
                reason=f"provider_refusal: {refusal_text}",
            )
        try:
            parsed_output = _extract_structured_output_model(
                response_json,
                response_model=response_model,
            )
        except (ValidationError, ValueError) as exc:
            raise PromptRuntimeValidationError(
                prompt_id=stack.prompt_id,
                reason=f"structured_output_parse_failed: {exc}",
            ) from exc
        return StructuredOutputExecutionResult(
            output=parsed_output,
            provider_grounding_supports=normalize_provider_grounding_supports(response_json),
        )

    def _get_http_client(self) -> httpx.Client:
        if self._http_client is not None:
            return self._http_client
        with self._http_client_lock:
            if self._http_client is None:
                self._http_client = build_prompt_runtime_http_client(self._provider_config)
            return self._http_client

    def close(self) -> None:
        if not self._owns_http_client or self._http_client is None:
            return
        self._http_client.close()


def _build_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _decode_json_response(response: httpx.Response) -> dict[str, object]:
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise ValueError(f"{response.status_code} {response.text}") from exc
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("provider response must be a JSON object")
    error = payload.get("error")
    if error:
        raise ValueError(json.dumps(error, ensure_ascii=False))
    return payload


def _build_responses_structured_payload(
    *,
    model: str,
    messages: tuple[PromptMessageLike, ...],
    response_model: type[BaseModel],
    reasoning_effort: str | None,
    max_output_tokens: int | None,
    safety_identifier: str | None,
) -> dict[str, object]:
    schema = _close_json_schema_objects(response_model.model_json_schema())
    payload: dict[str, object] = {
        "model": model,
        "stream": False,
        "input": [
            {
                "role": message.role,
                "type": "message",
                "content": message.content,
            }
            for message in messages
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": response_model.__name__,
                "schema": schema,
                "strict": True,
            }
        },
    }
    if reasoning_effort is not None:
        payload["reasoning"] = {"effort": reasoning_effort}
    if max_output_tokens is not None:
        payload["max_output_tokens"] = max_output_tokens
    if safety_identifier is not None:
        payload["safety_identifier"] = safety_identifier
    return payload


def normalize_optional_safety_identifier(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if not is_sha256_hex(normalized):
        raise ValueError("safety_identifier must be a 64-character lowercase hex string")
    return normalized


def _close_json_schema_objects(schema: object) -> object:
    if isinstance(schema, dict):
        normalized = {key: _close_json_schema_objects(value) for key, value in schema.items()}
        if normalized.get("type") == "object" and "additionalProperties" not in normalized:
            normalized["additionalProperties"] = False
        return normalized
    if isinstance(schema, list):
        return [_close_json_schema_objects(item) for item in schema]
    return schema


def _raise_for_non_successful_runtime_state(
    payload: dict[str, object],
    *,
    prompt_id: str,
) -> None:
    status = str(payload.get("status", "")).strip()
    incomplete_details = payload.get("incomplete_details")
    if status == "incomplete" or incomplete_details not in (None, {}):
        detail_reason = _extract_incomplete_reason(incomplete_details)
        raise PromptRuntimeValidationError(
            prompt_id=prompt_id,
            reason=f"provider_incomplete: {detail_reason}",
        )
    if status and status != "completed":
        raise PromptRuntimeValidationError(
            prompt_id=prompt_id,
            reason=f"provider_runtime_state_{status}",
        )


def _extract_incomplete_reason(incomplete_details: object) -> str:
    if isinstance(incomplete_details, dict):
        reason = incomplete_details.get("reason")
        if isinstance(reason, str) and reason.strip():
            return reason.strip()
    return "unknown"


def _extract_refusal_text(payload: dict[str, object]) -> str | None:
    refusal = payload.get("refusal")
    if isinstance(refusal, str) and refusal.strip():
        return refusal.strip()
    for output_item in payload.get("output", []):
        if not isinstance(output_item, dict):
            continue
        for content_item in output_item.get("content", []):
            if not isinstance(content_item, dict):
                continue
            if content_item.get("type") != "refusal":
                continue
            refusal_text = content_item.get("refusal")
            if isinstance(refusal_text, str) and refusal_text.strip():
                return refusal_text.strip()
            text = content_item.get("text")
            if isinstance(text, str) and text.strip():
                return text.strip()
            return "refusal"
    return None


def _extract_structured_output_model[StructuredOutputResultT: BaseModel](
    payload: dict[str, object],
    *,
    response_model: type[StructuredOutputResultT],
) -> StructuredOutputResultT:
    output_parsed = payload.get("output_parsed")
    if output_parsed is not None:
        try:
            return response_model.model_validate(output_parsed)
        except ValidationError:
            pass
    for output_item in payload.get("output", []):
        if not isinstance(output_item, dict):
            continue
        for content_item in output_item.get("content", []):
            if not isinstance(content_item, dict):
                continue
            parsed_value = content_item.get("parsed")
            if parsed_value is None:
                continue
            return response_model.model_validate(parsed_value)
    return response_model.model_validate_json(_extract_output_text(payload))


def _extract_output_text(payload: dict[str, object]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text
    texts: list[str] = []
    for output_item in payload.get("output", []):
        if not isinstance(output_item, dict):
            continue
        for content_item in output_item.get("content", []):
            if not isinstance(content_item, dict):
                continue
            text = content_item.get("text")
            if isinstance(text, str) and text:
                texts.append(text)
    if texts:
        return "\n".join(texts)
    raise ValueError("responses payload did not contain structured output text")
