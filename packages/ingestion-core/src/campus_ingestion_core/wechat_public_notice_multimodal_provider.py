from __future__ import annotations

import base64
import json
import os
from collections.abc import Mapping
from typing import Any

import httpx

from campus_ingestion_core.wechat_public_notice_multimodal_constants import (
    DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_BASE_URL,
    DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS,
    WeChatPublicNoticeMultimodalConfidence,
)
from campus_ingestion_core.wechat_public_notice_multimodal_models import (
    WeChatPublicNoticeMultimodalProviderRequest,
    WeChatPublicNoticeMultimodalProviderResult,
)


class ChatCompletionsWeChatPublicNoticeMultimodalProvider:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        provider: str = "openai-chat-completions",
        base_url: str = DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_BASE_URL,
        max_output_tokens: int = DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS,
        http_client: httpx.Client | None = None,
    ) -> None:
        if not api_key.strip():
            raise ValueError("wechat public notice multimodal api_key must not be empty")
        if not model.strip():
            raise ValueError("wechat public notice multimodal model must not be empty")
        if max_output_tokens <= 0:
            raise ValueError("wechat public notice multimodal max_output_tokens must be > 0")
        self._api_key = api_key.strip()
        self._model = model.strip()
        self._provider = provider.strip() or "openai-chat-completions"
        self._max_output_tokens = max_output_tokens
        self._http_client = http_client or httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(connect=10.0, read=90.0, write=10.0, pool=5.0),
            trust_env=False,
        )

    @classmethod
    def from_env(
        cls,
        env: Mapping[str, str] | None = None,
    ) -> ChatCompletionsWeChatPublicNoticeMultimodalProvider:
        source = env if env is not None else os.environ
        api_key = (source.get("WECHAT_PUBLIC_NOTICE_MULTIMODAL_API_KEY") or "").strip()
        model = (source.get("WECHAT_PUBLIC_NOTICE_MULTIMODAL_MODEL") or "").strip()
        provider = (
            source.get("WECHAT_PUBLIC_NOTICE_MULTIMODAL_PROVIDER") or "openai-chat-completions"
        ).strip()
        base_url = (
            source.get("WECHAT_PUBLIC_NOTICE_MULTIMODAL_BASE_URL")
            or DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_BASE_URL
        ).strip()
        max_output_tokens = int(
            (
                source.get("WECHAT_PUBLIC_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS")
                or str(DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS)
            ).strip()
        )
        if not api_key:
            raise ValueError("WECHAT_PUBLIC_NOTICE_MULTIMODAL_API_KEY is required")
        if not model:
            raise ValueError("WECHAT_PUBLIC_NOTICE_MULTIMODAL_MODEL is required")
        return cls(
            api_key=api_key,
            model=model,
            provider=provider,
            base_url=base_url,
            max_output_tokens=max_output_tokens,
        )

    def process(
        self,
        request: WeChatPublicNoticeMultimodalProviderRequest,
    ) -> WeChatPublicNoticeMultimodalProviderResult:
        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Read the campus notice image carefully. Extract only visible text and "
                        "table-like facts. Do not invent unreadable text. Return strict JSON with "
                        "a short summary, extracted_text preserving visible wording, whether the "
                        "image has meaningful textual facts, a confidence label, and layout blocks."
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
                    "name": "wechat_public_notice_inline_image_ocr",
                    "schema": _wechat_multimodal_schema(),
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
        parsed = _extract_chat_completions_payload(response_json)
        confidence = _coerce_confidence(parsed.get("confidence"))
        layout_elements = _coerce_layout_elements(parsed.get("layout_elements"))
        return WeChatPublicNoticeMultimodalProviderResult(
            provider=self._provider,
            model=self._model,
            confidence=confidence,
            has_meaningful_text=bool(parsed.get("has_meaningful_text")),
            summary=str(parsed.get("summary") or "").strip(),
            extracted_text=str(parsed.get("extracted_text") or "").strip(),
            layout_elements=layout_elements,
            raw_response=response_json if isinstance(response_json, dict) else parsed,
        )


def _build_chat_user_content(
    request: WeChatPublicNoticeMultimodalProviderRequest,
) -> list[dict[str, object]]:
    prompt = "\n".join(
        (
            f"notice_title: {request.notice_title}",
            f"publish_time: {request.publish_time}",
            f"article_source_url: {request.article_source_url}",
            f"media_ref_id: {request.media_ref_id}",
            "Extract user-relevant textual facts from this campus notice image.",
        )
    )
    return [
        {"type": "text", "text": prompt},
        {
            "type": "image_url",
            "image_url": {
                "url": "data:image/png;base64,"
                + base64.b64encode(request.image_bytes).decode("ascii")
            },
        },
    ]


def _wechat_multimodal_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "confidence": {
                "type": "string",
                "enum": ["high", "medium", "low"],
            },
            "has_meaningful_text": {"type": "boolean"},
            "summary": {"type": "string"},
            "extracted_text": {"type": "string"},
            "layout_elements": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "kind": {"type": "string"},
                        "text": {"type": "string"},
                    },
                    "required": ["kind", "text"],
                },
            },
        },
        "required": [
            "confidence",
            "has_meaningful_text",
            "summary",
            "extracted_text",
            "layout_elements",
        ],
    }


def _extract_chat_completions_payload(response_json: Mapping[str, Any]) -> dict[str, Any]:
    choices = response_json.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("chat completions response missing choices")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ValueError("chat completions response missing message")
    content = message.get("content")
    if isinstance(content, str):
        raw_text = content.strip()
        if not raw_text:
            raise ValueError("chat completions content is empty")
        parsed = json.loads(raw_text)
        if not isinstance(parsed, dict):
            raise ValueError("chat completions parsed content must be an object")
        return dict(parsed)
    if isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                parsed = json.loads(text)
                if not isinstance(parsed, dict):
                    raise ValueError("chat completions parsed content must be an object")
                return dict(parsed)
    raise ValueError("chat completions response missing JSON content")


def _coerce_confidence(value: object) -> WeChatPublicNoticeMultimodalConfidence:
    text = str(value or "").strip()
    if text not in {"high", "medium", "low"}:
        raise ValueError(f"unsupported confidence: {text}")
    return text  # type: ignore[return-value]


def _coerce_layout_elements(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list):
        return ()
    elements: list[Mapping[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").strip()
        text = str(item.get("text") or "").strip()
        if not kind and not text:
            continue
        elements.append({"kind": kind, "text": text})
    return tuple(elements)
