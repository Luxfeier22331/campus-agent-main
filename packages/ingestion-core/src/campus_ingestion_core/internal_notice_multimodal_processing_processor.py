from __future__ import annotations

import json
import os
from base64 import b64encode
from collections.abc import Mapping

import httpx

from campus_ingestion_core.internal_notice_multimodal_processing_models import (
    InternalNoticeMultimodalDecision,
    InternalNoticeMultimodalProcessingRequest,
)

DEFAULT_INTERNAL_NOTICE_MULTIMODAL_BASE_URL = "https://api.openai.com/v1"
DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS = 900


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
        return cls(
            api_key=api_key,
            model=model,
            base_url=base_url,
            max_output_tokens=max_output_tokens,
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
                    "content": (
                        "You process restricted campus notice visual attachments. "
                        "Return only structured JSON. Do not infer policy text that is not visible. "
                        "If the visual content can help answer notice-level questions, choose "
                        "retain_for_notice_query. If it is decorative or not useful for campus QA, "
                        "choose no_adoption. If the image is unreadable or needs another lane, choose "
                        "needs_additional_processing."
                    ),
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


def _build_chat_user_content(
    request: InternalNoticeMultimodalProcessingRequest,
) -> list[dict[str, object]]:
    content: list[dict[str, object]] = [
        {
            "type": "text",
            "text": (
                f"Notice id: {request.source_notice_id}\n"
                f"Unit id: {request.unit_id}\n"
                f"Notice title: {request.notice_title}\n"
                f"Primary role: {request.primary_role}\n"
                f"Prior reasons: {', '.join(request.reasons) or '<none>'}\n"
                "Assess the attached visual assets for notice-level campus QA use. "
                "Write Chinese summary and extracted_text when visible."
            ),
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


__all__ = [
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_BASE_URL",
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS",
    "ChatCompletionsInternalNoticeMultimodalProcessor",
]
