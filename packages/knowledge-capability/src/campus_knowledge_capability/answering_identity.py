from __future__ import annotations

from campus_contracts import EvidenceBundle, EvidenceSource

from .answer_presentation_contract import AnswerPresentationDraft, PresentationKind
from .answer_shape import AnswerShape
from .answer_shared import _answer_prefix, _lead_source_title
from .answer_text_cleanup import finalize_answer_text
from .answering_result import DirectAnswerResult


def _compose_document_identity_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> DirectAnswerResult:
    title = _lead_source_title(tuple(source for source, _ in selected_rows))
    if not title:
        return DirectAnswerResult(answer_text="")
    answer_text = finalize_answer_text(f"{_answer_prefix(evidence)}，相关依据为《{title}》。")
    return DirectAnswerResult(
        answer_text=answer_text,
        presentation=AnswerPresentationDraft(
            kind=PresentationKind.DOCUMENT_IDENTITY,
            answer_shape=AnswerShape.TITLE_LOOKUP,
            fragments=(answer_text,),
            identity_tokens=(title,),
        ),
    )
