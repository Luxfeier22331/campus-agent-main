from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

import httpx
from campus_shared import PromptRuntimeProviderConfig, build_prompt_runtime_http_client

from campus_supervisor_agent_worker.tool_function_schema import generate_provider_function_schemas


class ProviderFunctionToolAdmissionError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ProviderFunctionToolRequest:
    user_goal: str
    tools: tuple[dict[str, Any], ...]
    input_items: tuple[dict[str, object], ...] = ()
    tool_choice: object = "required"
    parallel_tool_calls: bool = False


@dataclass(frozen=True, slots=True)
class ProviderFunctionCall:
    name: str
    arguments: dict[str, object]
    call_id: str
    response_id: str = ""
    response_output_items: tuple[dict[str, object], ...] = ()


@dataclass(frozen=True, slots=True)
class ProviderToolLoopResult:
    tool_call: ProviderFunctionCall
    tool_output: str
    final_answer_text: str
    model_response_ref: str


ProviderFunctionToolProvider = Callable[[ProviderFunctionToolRequest], Mapping[str, object]]


class ResponsesFunctionToolProvider:
    def __init__(
        self,
        *,
        provider_config: PromptRuntimeProviderConfig,
        model_name: str,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._provider_config = provider_config
        self._model_name = model_name.strip()
        self._http_client = http_client or build_prompt_runtime_http_client(provider_config)
        self._owns_http_client = http_client is None
        if not self._model_name:
            raise ProviderFunctionToolAdmissionError("provider function model_name is required")

    def __call__(self, request: ProviderFunctionToolRequest) -> Mapping[str, object]:
        payload: dict[str, object] = {
            "model": self._model_name,
            "stream": False,
            "input": list(request.input_items) if request.input_items else _initial_input_items(request.user_goal),
            "tools": list(request.tools),
            "tool_choice": request.tool_choice,
            "parallel_tool_calls": request.parallel_tool_calls,
        }
        if self._provider_config.reasoning_effort is not None:
            payload["reasoning"] = {"effort": self._provider_config.reasoning_effort}
        if self._provider_config.max_output_tokens is not None:
            payload["max_output_tokens"] = self._provider_config.max_output_tokens
        try:
            response = self._http_client.post(
                "/responses",
                json=payload,
                headers={"Authorization": f"Bearer {self._provider_config.api_key}"},
                timeout=self._provider_config.http_settings.to_httpx_timeout(),
            )
            response.raise_for_status()
            response_json = response.json()
        except Exception as exc:
            raise ProviderFunctionToolAdmissionError(
                f"provider function call request failed: {exc}"
            ) from exc
        if not isinstance(response_json, dict):
            raise ProviderFunctionToolAdmissionError(
                "provider function call response must be an object"
            )
        if response_json.get("error"):
            raise ProviderFunctionToolAdmissionError(
                f"provider function call response error: {response_json['error']!r}"
            )
        return response_json

    def close(self) -> None:
        if self._owns_http_client:
            self._http_client.close()


def plan_required_provider_function_call(
    *,
    user_goal: str,
    allowed_tools: tuple[str, ...],
    provider: ProviderFunctionToolProvider,
) -> ProviderFunctionCall:
    request = ProviderFunctionToolRequest(
        user_goal=user_goal,
        tools=_provider_schemas_for_allowed_tools(allowed_tools),
        tool_choice="required",
        parallel_tool_calls=False,
    )
    raw_response = provider(request)
    call = _extract_single_function_call(raw_response)
    if call.name not in set(allowed_tools):
        raise ProviderFunctionToolAdmissionError(
            f"provider returned disallowed tool call: {call.name}"
        )
    return call


def run_required_provider_tool_loop(
    *,
    user_goal: str,
    allowed_tools: tuple[str, ...],
    provider: ProviderFunctionToolProvider,
    execute_tool: Callable[[str, dict[str, object]], Mapping[str, object] | str],
) -> ProviderToolLoopResult:
    tool_schemas = _provider_schemas_for_allowed_tools(allowed_tools)
    first_request = ProviderFunctionToolRequest(
        user_goal=user_goal,
        tools=tool_schemas,
        tool_choice="required",
        parallel_tool_calls=False,
    )
    first_response = provider(first_request)
    tool_call = _extract_single_function_call(first_response)
    if tool_call.name not in set(allowed_tools):
        raise ProviderFunctionToolAdmissionError(
            f"provider returned disallowed tool call: {tool_call.name}"
        )
    tool_result = execute_tool(tool_call.name, tool_call.arguments)
    tool_output = _tool_output_string(tool_result)
    second_input = (
        *tool_call.response_output_items,
        {
            "type": "function_call_output",
            "call_id": tool_call.call_id,
            "output": tool_output,
        },
    )
    second_request = ProviderFunctionToolRequest(
        user_goal=user_goal,
        tools=tool_schemas,
        input_items=second_input,
        tool_choice="none",
        parallel_tool_calls=False,
    )
    final_response = provider(second_request)
    return ProviderToolLoopResult(
        tool_call=tool_call,
        tool_output=tool_output,
        final_answer_text=_extract_message_text(final_response),
        model_response_ref=tool_call.response_id,
    )


def _provider_schemas_for_allowed_tools(
    allowed_tools: tuple[str, ...],
) -> tuple[dict[str, Any], ...]:
    if not allowed_tools:
        raise ProviderFunctionToolAdmissionError("provider function call requires allowed tools")
    by_name = {schema["name"]: schema for schema in generate_provider_function_schemas()}
    selected: list[dict[str, Any]] = []
    for tool_name in allowed_tools:
        schema = by_name.get(tool_name)
        if schema is None:
            raise ProviderFunctionToolAdmissionError(
                f"missing provider function schema for {tool_name}"
            )
        selected.append(schema)
    return tuple(selected)


def _extract_single_function_call(response: Mapping[str, object]) -> ProviderFunctionCall:
    output = response.get("output")
    if not isinstance(output, list):
        raise ProviderFunctionToolAdmissionError("provider response output must be a list")
    calls = [_parse_function_call(item) for item in output if _is_function_call_item(item)]
    if not calls:
        raise ProviderFunctionToolAdmissionError(
            "provider response must include required function call"
        )
    if len(calls) > 1:
        raise ProviderFunctionToolAdmissionError(
            "provider response must include exactly one function call"
        )
    call = calls[0]
    return ProviderFunctionCall(
        name=call.name,
        arguments=call.arguments,
        call_id=call.call_id,
        response_id=_response_id(response),
        response_output_items=tuple(dict(item) for item in output if isinstance(item, dict)),
    )


def _is_function_call_item(item: object) -> bool:
    return isinstance(item, dict) and item.get("type") == "function_call"


def _parse_function_call(item: object) -> ProviderFunctionCall:
    if not isinstance(item, dict):
        raise ProviderFunctionToolAdmissionError("provider function call item must be an object")
    name = _required_string(item.get("name"), "provider function call name")
    call_id = _required_string(item.get("call_id"), "provider function call call_id")
    return ProviderFunctionCall(
        name=name,
        arguments=_parse_arguments(item.get("arguments")),
        call_id=call_id,
    )


def _extract_message_text(response: Mapping[str, object]) -> str:
    output = response.get("output")
    if not isinstance(output, list):
        raise ProviderFunctionToolAdmissionError("provider final response output must be a list")
    fragments: list[str] = []
    for item in output:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for content_item in content:
            if not isinstance(content_item, dict):
                continue
            if content_item.get("type") == "output_text":
                text = str(content_item.get("text") or "").strip()
                if text:
                    fragments.append(text)
            if content_item.get("type") == "text":
                text = str(content_item.get("text") or "").strip()
                if text:
                    fragments.append(text)
    if not fragments:
        raise ProviderFunctionToolAdmissionError("provider final response must include output text")
    return "\n".join(fragments)


def _parse_arguments(value: object) -> dict[str, object]:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ProviderFunctionToolAdmissionError(
                "provider function call arguments must be valid JSON"
            ) from exc
    else:
        parsed = value
    if not isinstance(parsed, dict):
        raise ProviderFunctionToolAdmissionError(
            "provider function call arguments must be a JSON object"
        )
    return dict(parsed)


def _required_string(value: object, field_name: str) -> str:
    normalized = "" if value is None else str(value).strip()
    if not normalized:
        raise ProviderFunctionToolAdmissionError(f"{field_name} is required")
    return normalized


def _initial_input_items(user_goal: str) -> list[dict[str, object]]:
    return [
        {
            "role": "user",
            "type": "message",
            "content": user_goal,
        }
    ]


def _tool_output_string(value: Mapping[str, object] | str) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(dict(value), ensure_ascii=False, sort_keys=True)


def _response_id(response: Mapping[str, object]) -> str:
    return str(response.get("id") or "").strip()


__all__ = [
    "ProviderFunctionCall",
    "ProviderFunctionToolAdmissionError",
    "ProviderFunctionToolProvider",
    "ProviderFunctionToolRequest",
    "ProviderToolLoopResult",
    "ResponsesFunctionToolProvider",
    "plan_required_provider_function_call",
    "run_required_provider_tool_loop",
]
