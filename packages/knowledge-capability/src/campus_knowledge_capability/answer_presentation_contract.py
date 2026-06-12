from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from .answer_shape import AnswerShape
from .answer_shared import _normalize_snippet


class PresentationKind(StrEnum):
    DOCUMENT_IDENTITY = "document_identity"
    BRIEF_REFERENCE = "brief_reference"
    SHORT_FACTUAL_SUMMARY = "short_factual_summary"
    GENERAL_SUMMARY = "general_summary"


@dataclass(frozen=True, slots=True)
class AnswerPresentationDraft:
    kind: PresentationKind
    answer_shape: AnswerShape
    fragments: tuple[str, ...] = field(default_factory=tuple)
    identity_tokens: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class AnswerPresentationValidationResult:
    verdict: str
    failure_reason: str = ""


@dataclass(frozen=True, slots=True)
class _PresentationRule:
    allowed_shapes: tuple[AnswerShape, ...]
    max_fragments: int
    max_sentences: int
    requires_identity_token: bool = False


_PRESENTATION_RULES: dict[PresentationKind, _PresentationRule] = {
    PresentationKind.DOCUMENT_IDENTITY: _PresentationRule(
        allowed_shapes=(AnswerShape.TITLE_LOOKUP,),
        max_fragments=2,
        max_sentences=1,
        requires_identity_token=True,
    ),
    PresentationKind.BRIEF_REFERENCE: _PresentationRule(
        allowed_shapes=(AnswerShape.TITLE_LOOKUP, AnswerShape.FACT_LOOKUP),
        max_fragments=2,
        max_sentences=2,
    ),
    PresentationKind.SHORT_FACTUAL_SUMMARY: _PresentationRule(
        allowed_shapes=(AnswerShape.FACT_LOOKUP,),
        max_fragments=2,
        max_sentences=2,
    ),
    PresentationKind.GENERAL_SUMMARY: _PresentationRule(
        allowed_shapes=(AnswerShape.GENERAL_SUMMARY,),
        max_fragments=2,
        max_sentences=1,
    ),
}


def validate_answer_presentation_draft(
    draft: AnswerPresentationDraft,
) -> AnswerPresentationValidationResult:
    rule = _PRESENTATION_RULES[draft.kind]
    fragments = _normalize_fragments(draft.fragments)
    if draft.answer_shape not in rule.allowed_shapes:
        return _invalid("presentation_answer_shape_mismatch")
    if not fragments:
        return _invalid("presentation_fragments_missing")
    if len(fragments) > rule.max_fragments:
        return _invalid("presentation_fragment_budget_exceeded")
    if _sentence_count(fragments) > rule.max_sentences:
        return _invalid("presentation_sentence_budget_exceeded")
    if rule.requires_identity_token and not _contains_identity_token(
        fragments=fragments,
        identity_tokens=draft.identity_tokens,
    ):
        return _invalid("identity_token_missing")
    return AnswerPresentationValidationResult(verdict="valid")


def _normalize_fragments(fragments: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(
        fragment for fragment in (_normalize_snippet(item) for item in fragments) if fragment
    )


def _sentence_count(fragments: tuple[str, ...]) -> int:
    text = "".join(fragments)
    terminators = sum(text.count(mark) for mark in ("。", "！", "？", "!", "?"))
    return terminators if terminators else (1 if text else 0)


def _contains_identity_token(
    *,
    fragments: tuple[str, ...],
    identity_tokens: tuple[str, ...],
) -> bool:
    text = _normalize_snippet(" ".join(fragments))
    return any(_normalize_snippet(token) in text for token in identity_tokens if token.strip())


def _invalid(reason: str) -> AnswerPresentationValidationResult:
    return AnswerPresentationValidationResult(verdict="invalid", failure_reason=reason)


__all__ = [
    "AnswerPresentationDraft",
    "AnswerPresentationValidationResult",
    "PresentationKind",
    "validate_answer_presentation_draft",
]
