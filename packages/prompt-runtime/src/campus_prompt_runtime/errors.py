from __future__ import annotations


class PromptRuntimeValidationError(ValueError):
    def __init__(self, *, prompt_id: str, reason: str) -> None:
        super().__init__(f"{prompt_id}: {reason}")
        self.prompt_id = prompt_id
        self.reason = reason


def classify_prompt_runtime_failure(
    error: PromptRuntimeValidationError,
) -> tuple[str, str]:
    reason = error.reason.strip()
    if reason.startswith("provider_refusal:"):
        return "provider_refusal", ""
    if reason.startswith("provider_incomplete:"):
        detail = reason.split(":", 1)[1].strip() or "unknown"
        if detail == "content_filter":
            return "content_filter", "content_filter"
        return "provider_incomplete", detail
    if reason.startswith("provider_runtime_state_"):
        detail = reason.removeprefix("provider_runtime_state_").strip() or "unknown"
        if detail == "content_filter":
            return "content_filter", "content_filter"
        return "provider_runtime_state", detail
    if reason.startswith("provider_request_failed:"):
        return "provider_request_failed", ""
    if reason.startswith("structured_output_parse_failed:"):
        return "structured_output_parse_failed", ""
    return "prompt_contract_failed", ""
