from __future__ import annotations

import re
from typing import Protocol

from campus_contracts import PromptTrace


_PROMPT_VERSION_RE = re.compile(r"_(v\d+)$")


class PromptSpecLike(Protocol):
    prompt_id: str
    supported_modes: tuple[str, ...]
    variables_schema_version: str
    output_schema_version: str
    template_sha256: str


class PromptTaskLike(Protocol):
    mode: str
    output_schema_name: str


class PromptPacketLike(Protocol):
    prompt_id: str
    task: PromptTaskLike


class PromptRuntimeValidationError(ValueError):
    def __init__(self, *, prompt_id: str, reason: str) -> None:
        super().__init__(f"{prompt_id}: {reason}")
        self.prompt_id = prompt_id
        self.reason = reason


def validate_prompt_packet_contract(
    *,
    packet: PromptPacketLike,
    spec: PromptSpecLike,
) -> None:
    if packet.prompt_id != spec.prompt_id:
        raise PromptRuntimeValidationError(
            prompt_id=spec.prompt_id,
            reason=f"packet prompt_id mismatch: {packet.prompt_id}",
        )
    if packet.task.mode not in spec.supported_modes:
        raise PromptRuntimeValidationError(
            prompt_id=spec.prompt_id,
            reason=f"unsupported packet mode: {packet.task.mode}",
        )
    if packet.task.output_schema_name != spec.prompt_id:
        raise PromptRuntimeValidationError(
            prompt_id=spec.prompt_id,
            reason=(
                "packet output_schema_name mismatch: "
                f"{packet.task.output_schema_name or '<empty>'}"
            ),
        )


def validate_prompt_trace_contract(
    *,
    prompt_trace: PromptTrace,
    spec: PromptSpecLike,
) -> None:
    if prompt_trace.prompt_id != spec.prompt_id:
        raise PromptRuntimeValidationError(
            prompt_id=spec.prompt_id,
            reason=f"trace prompt_id mismatch: {prompt_trace.prompt_id}",
        )
    expected_prompt_version = _resolve_prompt_version(spec.prompt_id)
    if expected_prompt_version and prompt_trace.prompt_version != expected_prompt_version:
        raise PromptRuntimeValidationError(
            prompt_id=spec.prompt_id,
            reason=f"trace prompt_version mismatch: {prompt_trace.prompt_version}",
        )
    if prompt_trace.variables_schema_version != spec.variables_schema_version:
        raise PromptRuntimeValidationError(
            prompt_id=spec.prompt_id,
            reason=(
                "trace variables_schema_version mismatch: "
                f"{prompt_trace.variables_schema_version}"
            ),
        )
    if prompt_trace.output_schema_version != spec.output_schema_version:
        raise PromptRuntimeValidationError(
            prompt_id=spec.prompt_id,
            reason=(
                "trace output_schema_version mismatch: "
                f"{prompt_trace.output_schema_version}"
            ),
        )
    if prompt_trace.template_sha256 != spec.template_sha256:
        raise PromptRuntimeValidationError(
            prompt_id=spec.prompt_id,
            reason="trace template_sha256 mismatch",
        )


def require_non_empty_output_text(
    *,
    prompt_id: str,
    field_name: str,
    value: object,
) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PromptRuntimeValidationError(
            prompt_id=prompt_id,
            reason=f"output field {field_name} must be a non-empty string",
        )
    return value


def _resolve_prompt_version(prompt_id: str) -> str:
    matched = _PROMPT_VERSION_RE.search(prompt_id)
    if matched is None:
        return ""
    return matched.group(1)


__all__ = [
    "PromptRuntimeValidationError",
    "PromptSpecLike",
    "PromptPacketLike",
    "PromptTaskLike",
    "require_non_empty_output_text",
    "validate_prompt_packet_contract",
    "validate_prompt_trace_contract",
]
