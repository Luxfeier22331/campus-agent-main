from __future__ import annotations

from campus_ingestion_core.regulation_answer_roles import build_answer_role_metadata

from .regulation_chunking_shared import _label_overrides, _RegulationSegment


def _answer_role_metadata(
    *,
    text: str,
    prefix_text: str,
    role_hint: str | None,
) -> dict[str, object]:
    return build_answer_role_metadata(text=text, prefix_text=prefix_text, role_hint=role_hint)


def _build_answer_ready_segment(
    *,
    text: str,
    label: str,
    prefix_text: str,
    role_hint: str | None,
    extra_metadata: dict[str, object] | None = None,
    boundary_rule: str,
) -> _RegulationSegment:
    label_metadata = _label_overrides(label)
    role_metadata = _answer_role_metadata(
        text=text,
        prefix_text=prefix_text,
        role_hint=role_hint,
    )
    metadata = {**label_metadata, **role_metadata, **dict(extra_metadata or {})}
    return _RegulationSegment(
        text=text,
        anchor=label_metadata,
        metadata=metadata,
        split_reason="structure_boundary",
        boundary_rule=boundary_rule,
    )
