from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path


_PROMPTS_DIR = Path(__file__).resolve().parent


@dataclass(frozen=True, slots=True)
class SupervisorPromptSpec:
    prompt_id: str
    owner_package: str
    supported_modes: tuple[str, ...]
    variables_schema_version: str
    output_schema_version: str
    eval_suite: tuple[str, ...]
    template_text: str
    template_sha256: str


def _load_template_text(filename: str) -> str:
    return (_PROMPTS_DIR / filename).read_text(encoding="utf-8")


def _build_spec(
    *,
    prompt_id: str,
    filename: str,
    supported_modes: tuple[str, ...],
    eval_suite: tuple[str, ...],
) -> SupervisorPromptSpec:
    template_text = _load_template_text(filename)
    return SupervisorPromptSpec(
        prompt_id=prompt_id,
        owner_package="campus_supervisor_core",
        supported_modes=supported_modes,
        variables_schema_version="v1",
        output_schema_version="v1",
        eval_suite=eval_suite,
        template_text=template_text,
        template_sha256=hashlib.sha256(template_text.encode("utf-8")).hexdigest(),
    )


_PROMPT_REGISTRY: dict[str, SupervisorPromptSpec] = {
    "supervisor_approval_required_v1": _build_spec(
        prompt_id="supervisor_approval_required_v1",
        filename="supervisor_approval_required_v1.md",
        supported_modes=("approval_required",),
        eval_suite=("supervisor", "supervisor_approval_required_regression"),
    ),
    "supervisor_clarify_v1": _build_spec(
        prompt_id="supervisor_clarify_v1",
        filename="supervisor_clarify_v1.md",
        supported_modes=("clarify",),
        eval_suite=("supervisor", "supervisor_clarify_regression"),
    ),
    "supervisor_reject_v1": _build_spec(
        prompt_id="supervisor_reject_v1",
        filename="supervisor_reject_v1.md",
        supported_modes=("reject",),
        eval_suite=("supervisor", "supervisor_reject_regression"),
    ),
}


def get_supervisor_prompt_spec(prompt_id: str) -> SupervisorPromptSpec:
    try:
        return _PROMPT_REGISTRY[prompt_id]
    except KeyError as exc:
        raise KeyError(f"unknown supervisor prompt_id: {prompt_id}") from exc


def list_supervisor_prompt_specs() -> tuple[SupervisorPromptSpec, ...]:
    return tuple(_PROMPT_REGISTRY[prompt_id] for prompt_id in sorted(_PROMPT_REGISTRY))


__all__ = [
    "SupervisorPromptSpec",
    "get_supervisor_prompt_spec",
    "list_supervisor_prompt_specs",
]
