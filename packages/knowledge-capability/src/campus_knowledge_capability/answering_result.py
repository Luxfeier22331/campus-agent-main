from __future__ import annotations

from dataclasses import dataclass

from .answer_presentation_contract import AnswerPresentationDraft


@dataclass(frozen=True, slots=True)
class DirectAnswerResult:
    answer_text: str
    presentation: AnswerPresentationDraft | None = None
    presentation_path: str = ""
    diagnostic_reason: str = ""
