from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from campus_ingestion_core.authenticated_notice_legacy_export import (
    load_authenticated_notice_selection_notice_ids,
)
from campus_ingestion_core.notice_consumption_projection import normalize_notice_ids


@dataclass(frozen=True, slots=True)
class InternalNoticeSelectionProvenance:
    notice_ids: tuple[str, ...]
    selection_source: str
    selection_path: str
    selection_sha256: str
    command_args: dict[str, object]


def build_internal_notice_selection_provenance(
    *,
    explicit_notice_ids: Sequence[str],
    selection_path: str | None,
    extra_command_args: Mapping[str, object] | None = None,
) -> InternalNoticeSelectionProvenance:
    explicit_ids = tuple(str(item).strip() for item in explicit_notice_ids if str(item).strip())
    normalized_selection_path = str(selection_path or "").strip()
    selected_ids: tuple[str, ...] = ()
    selection_sha256 = ""
    if normalized_selection_path:
        path = Path(normalized_selection_path)
        selected_ids = load_authenticated_notice_selection_notice_ids(path)
        selection_sha256 = hashlib.sha256(path.read_bytes()).hexdigest()

    notice_ids = normalize_notice_ids((*explicit_ids, *selected_ids))
    source_parts: list[str] = []
    if explicit_ids:
        source_parts.append("explicit_notice_ids")
    if normalized_selection_path:
        source_parts.append("selection_path")
    selection_source = "+".join(source_parts)
    command_args: dict[str, object] = {
        "notice_ids": list(notice_ids),
        "selection_source": selection_source,
    }
    if normalized_selection_path:
        command_args["selection_path"] = normalized_selection_path
        command_args["selection_sha256"] = selection_sha256
    command_args.update(dict(extra_command_args or {}))
    return InternalNoticeSelectionProvenance(
        notice_ids=notice_ids,
        selection_source=selection_source,
        selection_path=normalized_selection_path,
        selection_sha256=selection_sha256,
        command_args=command_args,
    )


__all__ = [
    "InternalNoticeSelectionProvenance",
    "build_internal_notice_selection_provenance",
]
