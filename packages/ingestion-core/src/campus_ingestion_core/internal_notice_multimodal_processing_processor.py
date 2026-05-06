from __future__ import annotations

import json
import os
from base64 import b64encode
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass

import httpx

from campus_ingestion_core.internal_notice_multimodal_processing_models import (
    InternalNoticeMultimodalDecision,
    InternalNoticeMultimodalProcessingRequest,
)

DEFAULT_INTERNAL_NOTICE_MULTIMODAL_BASE_URL = "https://api.openai.com/v1"
DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS = 900
DEFAULT_INTERNAL_NOTICE_MULTIMODAL_RUNTIME = "chat_completions"
INTERNAL_NOTICE_MULTIMODAL_RUNTIME_CHAT_COMPLETIONS = "chat_completions"
INTERNAL_NOTICE_MULTIMODAL_RUNTIME_AGENTS_SDK = "agents_sdk"
_AGENTS_SDK_MAX_TURNS = 1
_AGENTS_SDK_INSTRUCTIONS = """
You process restricted campus notice visual attachments.
Return only the structured decision object requested by the schema.
Do not infer policy text that is not visibly grounded in the images.
If the visual content can help answer notice-level campus questions, choose
retain_for_notice_query.
If it is decorative or not useful for campus QA, choose no_adoption.
If the image is unreadable or needs another lane, choose needs_additional_processing.
Write Chinese summary and extracted_text only for text or facts visible in the image.
""".strip()


@dataclass(frozen=True, slots=True)
class _AgentsSdkDecisionOutput:
    action: str
    summary: str
    extracted_text: str
    reasons: list[str]
    confidence: str


class ChatCompletionsInternalNoticeMultimodalProcessor:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str = DEFAULT_INTERNAL_NOTICE_MULTIMODAL_BASE_URL,
        max_output_tokens: int = DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS,
        http_client: httpx.Client | None = None,
    ) -> None:
        if not api_key.strip():
            raise ValueError("api_key must not be empty")
        if not model.strip():
            raise ValueError("model must not be empty")
        if not base_url.strip():
            raise ValueError("base_url must not be empty")
        if max_output_tokens <= 0:
            raise ValueError("max_output_tokens must be greater than zero")
        self._api_key = api_key.strip()
        self._model = model.strip()
        self._max_output_tokens = max_output_tokens
        self._http_client = http_client or httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=3.0),
            trust_env=False,
        )

    @classmethod
    def from_env(
        cls,
        env: Mapping[str, str] | None = None,
    ) -> ChatCompletionsInternalNoticeMultimodalProcessor:
        settings = _settings_from_env(env)
        return cls(
            api_key=settings["api_key"],
            model=settings["model"],
            base_url=settings["base_url"],
            max_output_tokens=settings["max_output_tokens"],
        )

    def process(
        self,
        request: InternalNoticeMultimodalProcessingRequest,
    ) -> InternalNoticeMultimodalDecision:
        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "system",
                    "content": _AGENTS_SDK_INSTRUCTIONS,
                },
                {
                    "role": "user",
                    "content": _build_chat_user_content(request),
                },
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "internal_notice_multimodal_processing",
                    "schema": _decision_schema(),
                    "strict": True,
                },
            },
            "max_completion_tokens": self._max_output_tokens,
        }
        response = self._http_client.post(
            "/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()
        response_json = response.json()
        if not isinstance(response_json, dict):
            raise ValueError("internal notice multimodal response must be a JSON object")
        raw_payload = _extract_chat_completions_payload(response_json)
        return _coerce_decision(raw_payload)


class AgentsSdkInternalNoticeMultimodalProcessor:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str = DEFAULT_INTERNAL_NOTICE_MULTIMODAL_BASE_URL,
        max_output_tokens: int = DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS,
        instructions: str = _AGENTS_SDK_INSTRUCTIONS,
        runner: Callable[[dict[str, object]], object] | None = None,
    ) -> None:
        if not api_key.strip():
            raise ValueError("api_key must not be empty")
        if not model.strip():
            raise ValueError("model must not be empty")
        if not base_url.strip():
            raise ValueError("base_url must not be empty")
        if max_output_tokens <= 0:
            raise ValueError("max_output_tokens must be greater than zero")
        self._api_key = api_key.strip()
        self._model = model.strip()
        self._base_url = base_url.rstrip("/")
        self._max_output_tokens = max_output_tokens
        self._instructions = instructions.strip() or _AGENTS_SDK_INSTRUCTIONS
        self._runner = runner or self._run_with_agents_sdk

    @classmethod
    def from_env(
        cls,
        env: Mapping[str, str] | None = None,
    ) -> AgentsSdkInternalNoticeMultimodalProcessor:
        settings = _settings_from_env(env)
        return cls(
            api_key=settings["api_key"],
            model=settings["model"],
            base_url=settings["base_url"],
            max_output_tokens=settings["max_output_tokens"],
        )

    def process(
        self,
        request: InternalNoticeMultimodalProcessingRequest,
    ) -> InternalNoticeMultimodalDecision:
        raw_result = self._runner(
            {
                "model": self._model,
                "instructions": self._instructions,
                "max_output_tokens": self._max_output_tokens,
                "input": _build_agents_sdk_input(request),
            }
        )
        if isinstance(raw_result, _AgentsSdkDecisionOutput):
            payload = asdict(raw_result)
        elif hasattr(raw_result, "model_dump"):
            payload = raw_result.model_dump()
        elif isinstance(raw_result, Mapping):
            payload = dict(raw_result)
        elif is_dataclass_instance(raw_result):
            payload = asdict(raw_result)
        else:
            raise ValueError("agents sdk multimodal result must be a structured object")
        return _coerce_decision(payload)

    def _run_with_agents_sdk(self, request: dict[str, object]) -> object:
        from agents import Agent, ModelSettings, RunConfig, Runner
        from agents.models.openai_provider import OpenAIProvider

        agent = Agent(
            name="internal_notice_multimodal_processing",
            instructions=str(request["instructions"]),
            model=str(request["model"]),
            model_settings=ModelSettings(
                parallel_tool_calls=False,
                max_tokens=int(request["max_output_tokens"]),
            ),
            output_type=_AgentsSdkDecisionOutput,
        )
        result = Runner.run_sync(
            agent,
            request["input"],
            max_turns=_AGENTS_SDK_MAX_TURNS,
            run_config=RunConfig(
                model_provider=OpenAIProvider(
                    api_key=self._api_key,
                    base_url=self._base_url,
                    use_responses=True,
                ),
                tracing_disabled=True,
                trace_include_sensitive_data=False,
            ),
        )
        return getattr(result, "final_output", None)


def build_internal_notice_multimodal_processor_from_env(
    env: Mapping[str, str] | None = None,
):
    source = env if env is not None else os.environ
    runtime = (
        source.get("INTERNAL_NOTICE_MULTIMODAL_RUNTIME")
        or DEFAULT_INTERNAL_NOTICE_MULTIMODAL_RUNTIME
    ).strip()
    if runtime == INTERNAL_NOTICE_MULTIMODAL_RUNTIME_CHAT_COMPLETIONS:
        return ChatCompletionsInternalNoticeMultimodalProcessor.from_env(source)
    if runtime == INTERNAL_NOTICE_MULTIMODAL_RUNTIME_AGENTS_SDK:
        return AgentsSdkInternalNoticeMultimodalProcessor.from_env(source)
    raise ValueError(f"unsupported multimodal runtime: {runtime or '<empty>'}")


def _settings_from_env(env: Mapping[str, str] | None) -> dict[str, object]:
    source = env if env is not None else os.environ
    api_key = (
        source.get("INTERNAL_NOTICE_MULTIMODAL_API_KEY")
        or source.get("PROMPT_RUNTIME_API_KEY")
        or source.get("LLM_API_KEY")
        or ""
    ).strip()
    model = (
        source.get("INTERNAL_NOTICE_MULTIMODAL_MODEL")
        or source.get("PROMPT_RUNTIME_MODEL")
        or ""
    ).strip()
    base_url = (
        source.get("INTERNAL_NOTICE_MULTIMODAL_BASE_URL")
        or source.get("PROMPT_RUNTIME_BASE_URL")
        or source.get("LLM_BASE_URL")
        or DEFAULT_INTERNAL_NOTICE_MULTIMODAL_BASE_URL
    ).strip()
    max_output_tokens = int(
        (
            source.get("INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS")
            or source.get("PROMPT_RUNTIME_MAX_OUTPUT_TOKENS")
            or str(DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS)
        ).strip()
    )
    if not api_key:
        raise ValueError(
            "INTERNAL_NOTICE_MULTIMODAL_API_KEY or PROMPT_RUNTIME_API_KEY or "
            "LLM_API_KEY is required"
        )
    if not model:
        raise ValueError("INTERNAL_NOTICE_MULTIMODAL_MODEL or PROMPT_RUNTIME_MODEL is required")
    return {
        "api_key": api_key,
        "model": model,
        "base_url": base_url,
        "max_output_tokens": max_output_tokens,
    }


def _build_chat_user_content(
    request: InternalNoticeMultimodalProcessingRequest,
) -> list[dict[str, object]]:
    content: list[dict[str, object]] = [
        {
            "type": "text",
            "text": _request_context_text(request),
        }
    ]
    for attachment in request.attachments:
        if not attachment.mime_type.lower().startswith("image/"):
            continue
        content.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": _data_url(attachment.mime_type, attachment.data),
                    "detail": "high",
                },
            }
        )
    return content


def _build_agents_sdk_input(
    request: InternalNoticeMultimodalProcessingRequest,
) -> list[dict[str, object]]:
    content: list[dict[str, object]] = [
        {
            "type": "input_text",
            "text": _request_context_text(request),
        }
    ]
    for attachment in request.attachments:
        if not attachment.mime_type.lower().startswith("image/"):
            continue
        content.append(
            {
                "type": "input_image",
                "image_url": _data_url(attachment.mime_type, attachment.data),
                "detail": "high",
            }
        )
    return [{"role": "user", "content": content}]


def _request_context_text(request: InternalNoticeMultimodalProcessingRequest) -> str:
    return (
        f"Notice id: {request.source_notice_id}\n"
        f"Unit id: {request.unit_id}\n"
        f"Notice title: {request.notice_title}\n"
        f"Primary role: {request.primary_role}\n"
        f"Prior reasons: {', '.join(request.reasons) or '<none>'}\n"
        "Assess the attached visual assets for notice-level campus QA use. "
        "Write Chinese summary and extracted_text when visible."
    )


def _decision_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["action", "summary", "extracted_text", "reasons", "confidence"],
        "properties": {
            "action": {
                "type": "string",
                "enum": [
                    "retain_for_notice_query",
                    "no_adoption",
                    "needs_additional_processing",
                ],
            },
            "summary": {"type": "string"},
            "extracted_text": {"type": "string"},
            "reasons": {"type": "array", "items": {"type": "string"}},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        },
    }


def _extract_chat_completions_payload(response_json: dict[str, object]) -> dict[str, object]:
    choices = response_json.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("chat completions response missing choices")
    choice = choices[0]
    if not isinstance(choice, dict):
        raise ValueError("chat completions choice must be an object")
    message = choice.get("message")
    if not isinstance(message, dict):
        raise ValueError("chat completions choice missing message")
    parsed = message.get("parsed")
    if isinstance(parsed, dict):
        return parsed
    content = message.get("content")
    if isinstance(content, str):
        payload = json.loads(content)
        if isinstance(payload, dict):
            return payload
    raise ValueError("chat completions message content must be a JSON object")


def _coerce_decision(payload: Mapping[str, object]) -> InternalNoticeMultimodalDecision:
    action = str(payload.get("action") or "").strip()
    if action not in {
        "retain_for_notice_query",
        "no_adoption",
        "needs_additional_processing",
    }:
        raise ValueError(f"unsupported multimodal action: {action or '<empty>'}")
    confidence = str(payload.get("confidence") or "").strip() or "low"
    if confidence not in {"high", "medium", "low"}:
        confidence = "low"
    return InternalNoticeMultimodalDecision(
        action=action,  # type: ignore[arg-type]
        summary=str(payload.get("summary") or "").strip(),
        extracted_text=str(payload.get("extracted_text") or "").strip(),
        reasons=tuple(
            str(item).strip() for item in (payload.get("reasons") or ()) if str(item).strip()
        ),
        confidence=confidence,  # type: ignore[arg-type]
    )


def _data_url(mime_type: str, payload: bytes) -> str:
    return f"data:{mime_type};base64,{b64encode(payload).decode('ascii')}"


def is_dataclass_instance(value: object) -> bool:
    return hasattr(value, "__dataclass_fields__") and not isinstance(value, type)


__all__ = [
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_BASE_URL",
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS",
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_RUNTIME",
    "INTERNAL_NOTICE_MULTIMODAL_RUNTIME_AGENTS_SDK",
    "INTERNAL_NOTICE_MULTIMODAL_RUNTIME_CHAT_COMPLETIONS",
    "AgentsSdkInternalNoticeMultimodalProcessor",
    "ChatCompletionsInternalNoticeMultimodalProcessor",
    "build_internal_notice_multimodal_processor_from_env",
]
