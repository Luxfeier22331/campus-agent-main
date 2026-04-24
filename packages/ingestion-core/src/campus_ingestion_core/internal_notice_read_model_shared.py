from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now

DEFAULT_INTERNAL_NOTICE_READ_MODEL_SCHEMA = "ingestion_projection"
DEFAULT_INTERNAL_NOTICE_READ_MODEL_TABLE = (
    f"{DEFAULT_INTERNAL_NOTICE_READ_MODEL_SCHEMA}.internal_notice_read_model"
)
DEFAULT_INTERNAL_NOTICE_READ_MODEL_ENV_KEY = "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL"
DEFAULT_INTERNAL_NOTICE_READ_MODEL_OPERATOR_ENV_KEY = (
    "INTERNAL_NOTICE_READ_MODEL_OPERATOR_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_READ_MODEL_MANAGEMENT_ENV_KEY = (
    "INTERNAL_NOTICE_READ_MODEL_MANAGEMENT_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS = 800
DEFAULT_INTERNAL_NOTICE_SEARCH_TEXT_MAX_CHARS = 2_000


@dataclass(frozen=True, slots=True)
class InternalNoticeReadModelEntry:
    source_family: str
    source_corpus: str
    source_collection: str
    source_notice_id: str
    unit_id: str
    primary_role: str
    target_surface: str
    consumption_status: str
    queryable: bool
    title: str
    published_at: str = ""
    source_url: str = ""
    canonical_url: str = ""
    canonical_document_id: str = ""
    canonical_markdown_object_key: str = ""
    attachment_refs: tuple[str, ...] = ()
    provenance_refs: tuple[str, ...] = ()
    body_excerpt: str = ""
    search_text: str = ""
    projection_updated_at: str = ""
    updated_at: str = field(default_factory=utc_now)

    @classmethod
    def from_dict(cls, payload: dict[str, object]) -> InternalNoticeReadModelEntry:
        raw = dict(payload)
        raw["queryable"] = bool(raw.get("queryable"))
        raw["attachment_refs"] = _coerce_text_tuple(raw.get("attachment_refs"))
        raw["provenance_refs"] = _coerce_text_tuple(raw.get("provenance_refs"))
        return cls(**raw)


class InternalNoticeReadModelStore(Protocol):
    def upsert_many(self, records: Sequence[InternalNoticeReadModelEntry]) -> None: ...

    def replace_scope(
        self,
        source_corpus: str,
        source_collection: str,
        records: Sequence[InternalNoticeReadModelEntry],
    ) -> None: ...

    def replace_notices(
        self,
        source_corpus: str,
        source_collection: str,
        notice_ids: Sequence[str],
        records: Sequence[InternalNoticeReadModelEntry],
    ) -> None: ...

    def list_by_scope(
        self,
        source_corpus: str,
        source_collection: str,
        *,
        notice_ids: Sequence[str] = (),
    ) -> tuple[InternalNoticeReadModelEntry, ...]: ...

    def search(
        self,
        *,
        source_families: Sequence[str],
        query_text: str,
        max_results: int,
    ) -> tuple[InternalNoticeReadModelEntry, ...]: ...

    def get_by_notice_id(
        self,
        *,
        notice_id: str,
        source_family: str = "",
    ) -> InternalNoticeReadModelEntry | None: ...


def normalize_notice_ids(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(sorted({str(value).strip() for value in values if str(value).strip()}))


def _coerce_text_tuple(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        values = (value,)
    else:
        values = tuple(value) if isinstance(value, Sequence) else ()
    return tuple(str(item).strip() for item in values if str(item).strip())
