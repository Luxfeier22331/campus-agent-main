from __future__ import annotations

import typing as t

from pydantic import BaseModel

StructuredOutputModel = t.TypeVar("StructuredOutputModel", bound=BaseModel)


class _ResponsesStructuredPreflightModel(BaseModel):
    status: str


def _build_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _build_responses_payload(
    *,
    model: str,
    prompt,
    temperature: float | None,
    reasoning_effort: str | None,
    text_verbosity: str | None,
    max_output_tokens: int | None,
) -> dict[str, t.Any]:
    payload: dict[str, t.Any] = {
        "model": model,
        "stream": False,
        "input": _prompt_to_responses_input(prompt),
    }
    if temperature is not None:
        payload["temperature"] = temperature
    if reasoning_effort is not None:
        payload["reasoning"] = {"effort": reasoning_effort}
    if text_verbosity is not None:
        payload["text"] = {"format": {"type": "text"}, "verbosity": text_verbosity}
    if max_output_tokens is not None:
        payload["max_output_tokens"] = max_output_tokens
    return payload


def _build_chat_completions_payload(
    *,
    model: str,
    prompt,
    temperature: float | None,
    reasoning_effort: str | None,
    text_verbosity: str | None,
    max_output_tokens: int | None,
) -> dict[str, t.Any]:
    payload: dict[str, t.Any] = {
        "model": model,
        "messages": _prompt_to_chat_completions_messages(prompt),
    }
    if temperature is not None:
        payload["temperature"] = temperature
    if reasoning_effort is not None:
        payload["reasoning_effort"] = reasoning_effort
    if text_verbosity is not None:
        payload["verbosity"] = text_verbosity
    if max_output_tokens is not None:
        payload["max_completion_tokens"] = max_output_tokens
    return payload


def _build_responses_structured_payload(
    *,
    model: str,
    prompt: str,
    response_model: type[BaseModel],
    reasoning_effort: str | None,
    max_output_tokens: int | None,
) -> dict[str, t.Any]:
    schema = _close_json_schema_objects(response_model.model_json_schema())
    payload: dict[str, t.Any] = {
        "model": model,
        "stream": False,
        "input": [
            {
                "role": "user",
                "type": "message",
                "content": prompt,
            }
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
    return payload


def _build_chat_completions_structured_payload(
    *,
    model: str,
    prompt: str,
    response_model: type[BaseModel],
    reasoning_effort: str | None,
    text_verbosity: str | None,
    max_output_tokens: int | None,
) -> dict[str, t.Any]:
    schema = _close_json_schema_objects(response_model.model_json_schema())
    payload: dict[str, t.Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": response_model.__name__,
                "schema": schema,
                "strict": True,
            },
        },
    }
    if reasoning_effort is not None:
        payload["reasoning_effort"] = reasoning_effort
    if text_verbosity is not None:
        payload["verbosity"] = text_verbosity
    if max_output_tokens is not None:
        payload["max_completion_tokens"] = max_output_tokens
    return payload


def _close_json_schema_objects(schema: t.Any) -> t.Any:
    if isinstance(schema, dict):
        normalized = {key: _close_json_schema_objects(value) for key, value in schema.items()}
        if normalized.get("type") == "object" and "additionalProperties" not in normalized:
            normalized["additionalProperties"] = False
        return normalized
    if isinstance(schema, list):
        return [_close_json_schema_objects(item) for item in schema]
    return schema


def _build_embeddings_payload(
    *,
    model: str,
    texts: list[str],
    dimensions: int | None,
) -> dict[str, t.Any]:
    payload: dict[str, t.Any] = {
        "model": model,
        "input": texts,
    }
    if dimensions is not None:
        payload["dimensions"] = dimensions
    return payload


def _prompt_to_responses_input(prompt) -> list[dict[str, t.Any]]:
    if isinstance(prompt, str):
        return [
            {
                "role": "user",
                "type": "message",
                "content": prompt,
            }
        ]
    messages = prompt.to_messages()
    items: list[dict[str, t.Any]] = []
    for message in messages:
        role = _message_role(message)
        items.append(
            {
                "role": role,
                "type": "message",
                "content": _message_content_to_text(getattr(message, "content", "")),
            }
        )
    return items


def _prompt_to_chat_completions_messages(prompt) -> list[dict[str, t.Any]]:
    if isinstance(prompt, str):
        return [{"role": "user", "content": prompt}]
    messages = prompt.to_messages()
    return [
        {
            "role": _message_role(message),
            "content": _message_content_to_text(getattr(message, "content", "")),
        }
        for message in messages
    ]


def _message_role(message) -> str:
    message_type = getattr(message, "type", "human")
    if message_type == "human":
        return "user"
    if message_type == "ai":
        return "assistant"
    if message_type == "system":
        return "system"
    return "user"


def _message_content_to_text(content: t.Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(part for part in parts if part)
    return str(content)


def _extract_output_text(payload: dict[str, t.Any]) -> str:
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
    raise ValueError(_describe_missing_responses_output(payload, expected="output text"))


def _extract_chat_completions_message_text(payload: dict[str, t.Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list):
        raise ValueError(
            _describe_missing_chat_completions_output(payload, expected="assistant message content")
        )
    texts: list[str] = []
    for choice in choices:
        if not isinstance(choice, dict):
            continue
        message = choice.get("message")
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        text = _message_content_to_text(content)
        if text.strip():
            texts.append(text)
    if texts:
        return "\n".join(texts)
    raise ValueError(
        _describe_missing_chat_completions_output(payload, expected="assistant message content")
    )


def _extract_structured_output_model[ResponseModelT: BaseModel](
    payload: dict[str, t.Any],
    *,
    response_model: type[ResponseModelT],
) -> ResponseModelT:
    output_parsed = payload.get("output_parsed")
    if output_parsed is not None:
        try:
            return response_model.model_validate(output_parsed)
        except Exception:
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


def _extract_chat_completions_structured_output_model[ResponseModelT: BaseModel](
    payload: dict[str, t.Any],
    *,
    response_model: type[ResponseModelT],
) -> ResponseModelT:
    choices = payload.get("choices")
    if not isinstance(choices, list):
        raise ValueError(
            _describe_missing_chat_completions_output(
                payload, expected="structured assistant message content"
            )
        )
    for choice in choices:
        if not isinstance(choice, dict):
            continue
        message = choice.get("message")
        if not isinstance(message, dict):
            continue
        parsed_value = message.get("parsed")
        if parsed_value is not None:
            return response_model.model_validate(parsed_value)
    return response_model.model_validate_json(_extract_chat_completions_message_text(payload))


def _extract_embeddings(payload: dict[str, t.Any]) -> list[list[float]]:
    raw_data = payload.get("data")
    if not isinstance(raw_data, list):
        raise ValueError("embeddings payload missing data array")
    items: list[tuple[int, list[float]]] = []
    for item in raw_data:
        if not isinstance(item, dict):
            continue
        index = item.get("index")
        embedding = item.get("embedding")
        if isinstance(index, int) and isinstance(embedding, list):
            items.append((index, [float(value) for value in embedding]))
    if not items:
        raise ValueError("embeddings payload did not contain embedding vectors")
    return [embedding for _, embedding in sorted(items, key=lambda pair: pair[0])]


def _describe_missing_responses_output(
    payload: dict[str, t.Any],
    *,
    expected: str,
) -> str:
    response_status = payload.get("status")
    response_id = payload.get("id")
    raw_output = payload.get("output")
    output_items = len(raw_output) if isinstance(raw_output, list) else "non_list"
    usage = payload.get("usage")
    output_tokens: int | None = None
    if isinstance(usage, dict):
        raw_output_tokens = usage.get("output_tokens")
        if isinstance(raw_output_tokens, int):
            output_tokens = raw_output_tokens
    return (
        "responses contract violation: "
        f"status={response_status!r}, response_id={response_id!r}, "
        f"output_items={output_items}, output_tokens={output_tokens!r}; "
        f"payload did not contain {expected}"
    )


def _describe_missing_chat_completions_output(
    payload: dict[str, t.Any],
    *,
    expected: str,
) -> str:
    response_id = payload.get("id")
    raw_choices = payload.get("choices")
    choice_count = len(raw_choices) if isinstance(raw_choices, list) else "non_list"
    usage = payload.get("usage")
    completion_tokens: int | None = None
    if isinstance(usage, dict):
        raw_completion_tokens = usage.get("completion_tokens")
        if isinstance(raw_completion_tokens, int):
            completion_tokens = raw_completion_tokens
    return (
        "chat completions contract violation: "
        f"response_id={response_id!r}, choice_count={choice_count}, "
        f"completion_tokens={completion_tokens!r}; "
        f"payload did not contain {expected}"
    )


__all__ = [
    "StructuredOutputModel",
    "_ResponsesStructuredPreflightModel",
    "_build_chat_completions_payload",
    "_build_chat_completions_structured_payload",
    "_build_embeddings_payload",
    "_build_headers",
    "_build_responses_payload",
    "_build_responses_structured_payload",
    "_extract_chat_completions_message_text",
    "_extract_chat_completions_structured_output_model",
    "_extract_embeddings",
    "_extract_output_text",
    "_extract_structured_output_model",
]
