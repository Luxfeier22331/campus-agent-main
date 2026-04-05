from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path


_PROMPTS_DIR = Path(__file__).resolve().parent


@dataclass(frozen=True, slots=True)
class RagPromptSpec:
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
) -> RagPromptSpec:
    template_text = _load_template_text(filename)
    return RagPromptSpec(
        prompt_id=prompt_id,
        owner_package="campus_rag_specialist",
        supported_modes=supported_modes,
        variables_schema_version="v1",
        output_schema_version="v1",
        eval_suite=eval_suite,
        template_text=template_text,
        template_sha256=hashlib.sha256(template_text.encode("utf-8")).hexdigest(),
    )


_PROMPT_REGISTRY: dict[str, RagPromptSpec] = {
    "rag_answer_v1": _build_spec(
        prompt_id="rag_answer_v1",
        filename="rag_answer_v1.md",
        supported_modes=("answer",),
        eval_suite=("rag_answer_regression",),
    ),
    "rag_clarify_v1": _build_spec(
        prompt_id="rag_clarify_v1",
        filename="rag_clarify_v1.md",
        supported_modes=("clarify",),
        eval_suite=("rag_clarify_regression",),
    ),
    "rag_no_answer_v1": _build_spec(
        prompt_id="rag_no_answer_v1",
        filename="rag_no_answer_v1.md",
        supported_modes=("no_answer",),
        eval_suite=("rag_no_answer_regression",),
    ),
    "rag_unsupported_v1": _build_spec(
        prompt_id="rag_unsupported_v1",
        filename="rag_unsupported_v1.md",
        supported_modes=("no_answer",),
        eval_suite=("rag_no_answer_regression", "rag_unsupported_regression"),
    ),
}


def get_rag_prompt_spec(prompt_id: str) -> RagPromptSpec:
    try:
        return _PROMPT_REGISTRY[prompt_id]
    except KeyError as exc:
        raise KeyError(f"unknown rag prompt_id: {prompt_id}") from exc


def list_rag_prompt_specs() -> tuple[RagPromptSpec, ...]:
    return tuple(_PROMPT_REGISTRY[prompt_id] for prompt_id in sorted(_PROMPT_REGISTRY))


__all__ = [
    "RagPromptSpec",
    "get_rag_prompt_spec",
    "list_rag_prompt_specs",
]
