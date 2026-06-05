from __future__ import annotations

from campus_contracts import PromptTrace

from .constants import is_sha256_hex, resolve_prompt_version
from .contracts import PromptPacketLike, PromptSpecLike
from .errors import PromptRuntimeValidationError


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
                f"packet output_schema_name mismatch: {packet.task.output_schema_name or '<empty>'}"
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
    expected_prompt_version = resolve_prompt_version(spec.prompt_id)
    if expected_prompt_version and prompt_trace.prompt_version != expected_prompt_version:
        raise PromptRuntimeValidationError(
            prompt_id=spec.prompt_id,
            reason=f"trace prompt_version mismatch: {prompt_trace.prompt_version}",
        )
    if not prompt_trace.prompt_version:
        raise PromptRuntimeValidationError(
            prompt_id=spec.prompt_id,
            reason="trace prompt_version must be non-empty",
        )
    if prompt_trace.variables_schema_version != spec.variables_schema_version:
        raise PromptRuntimeValidationError(
            prompt_id=spec.prompt_id,
            reason=(
                f"trace variables_schema_version mismatch: {prompt_trace.variables_schema_version}"
            ),
        )
    if prompt_trace.output_schema_version != spec.output_schema_version:
        raise PromptRuntimeValidationError(
            prompt_id=spec.prompt_id,
            reason=(f"trace output_schema_version mismatch: {prompt_trace.output_schema_version}"),
        )
    if prompt_trace.template_sha256 != spec.template_sha256:
        raise PromptRuntimeValidationError(
            prompt_id=spec.prompt_id,
            reason="trace template_sha256 mismatch",
        )
    if not is_sha256_hex(prompt_trace.template_sha256):
        raise PromptRuntimeValidationError(
            prompt_id=spec.prompt_id,
            reason="trace template_sha256 must be a 64-character lowercase hex digest",
        )
    if not prompt_trace.model_provider.strip():
        raise PromptRuntimeValidationError(
            prompt_id=spec.prompt_id,
            reason="trace model_provider must be non-empty",
        )
    if not prompt_trace.model_name.strip():
        raise PromptRuntimeValidationError(
            prompt_id=spec.prompt_id,
            reason="trace model_name must be non-empty",
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


def build_prompt_trace(
    *,
    spec: PromptSpecLike,
    model_provider: str,
    model_name: str,
) -> PromptTrace:
    return PromptTrace(
        prompt_id=spec.prompt_id,
        prompt_version=resolve_prompt_version(spec.prompt_id),
        template_sha256=spec.template_sha256,
        variables_schema_version=spec.variables_schema_version,
        output_schema_version=spec.output_schema_version,
        model_provider=model_provider,
        model_name=model_name,
    )
