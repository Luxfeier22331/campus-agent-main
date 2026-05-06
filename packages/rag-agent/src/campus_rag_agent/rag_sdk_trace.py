from __future__ import annotations

from collections.abc import Mapping, Sequence

RAG_SDK_TRACE_PROJECTION_SCHEMA_VERSION = "rag-sdk-trace-projection-v1"

_UNSAFE_KEY_TOKENS = (
    "rawprompt",
    "rawtranscript",
    "rawresponse",
    "rawprovider",
    "providerrawresponse",
    "sdkrunstate",
    "traceurl",
)
_UNSAFE_VALUE_TOKENS = (
    "platform.openai.com/traces",
    "rawprompt",
    "rawtranscript",
    "rawresponse",
    "sdkrunstate",
)


def build_rag_sdk_trace_projection(
    *,
    rollout_mode: str,
    runtime: str,
    tool_names: Sequence[str],
    model_response_ref: str = "",
    latency_ms: int = 0,
    failure_class: str = "",
) -> dict[str, object]:
    projection: dict[str, object] = {
        "schema_version": RAG_SDK_TRACE_PROJECTION_SCHEMA_VERSION,
        "rollout_mode": rollout_mode,
        "runtime": runtime,
        "tool_names": sorted(str(name) for name in tool_names if str(name).strip()),
        "model_response_ref": model_response_ref,
        "latency_ms": max(0, int(latency_ms)),
        "failure_class": failure_class,
    }
    reject_unsafe_rag_sdk_projection(projection)
    return projection


def reject_unsafe_rag_sdk_projection(value: object, *, path: str = "projection") -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            raw_key = str(key)
            if _unsafe_key(raw_key):
                raise ValueError(f"{path} contains unsafe RAG SDK projection key: {raw_key}")
            reject_unsafe_rag_sdk_projection(item, path=f"{path}.{raw_key}")
        return
    if isinstance(value, tuple | list):
        for index, item in enumerate(value):
            reject_unsafe_rag_sdk_projection(item, path=f"{path}[{index}]")
        return
    if isinstance(value, str) and _unsafe_value(value):
        raise ValueError(f"{path} contains unsafe RAG SDK projection value")


def _unsafe_key(value: str) -> bool:
    normalized = _normalize(value)
    return any(token in normalized for token in _UNSAFE_KEY_TOKENS)


def _unsafe_value(value: str) -> bool:
    normalized = value.strip().lower()
    return any(token in normalized for token in _UNSAFE_VALUE_TOKENS)


def _normalize(value: str) -> str:
    return "".join(char for char in value.strip().lower() if char.isalnum())


__all__ = [
    "RAG_SDK_TRACE_PROJECTION_SCHEMA_VERSION",
    "build_rag_sdk_trace_projection",
    "reject_unsafe_rag_sdk_projection",
]
