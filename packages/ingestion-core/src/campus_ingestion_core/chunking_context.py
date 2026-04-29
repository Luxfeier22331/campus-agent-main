from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol

_OFFICIAL_WEB_PAGE_FAMILIES = frozenset(
    {
        "article_detail",
        "listing_page",
        "directory_page",
        "generic_content_page",
        "data_table_page",
        "gallery_page",
        "contact_widget_page",
        "sitemap_navigation_page",
        "dynamic_shell_page",
        "structural_shell_page",
    }
)


@dataclass(frozen=True, slots=True)
class ChunkHeaderVariant:
    mode: str
    lines: tuple[str, ...]

    def joined_text(self) -> str:
        return "\n".join(line for line in self.lines if line).strip()


@dataclass(frozen=True, slots=True)
class ChunkTextContextPlan:
    required_variant: ChunkHeaderVariant | None = None
    preferred_variants: tuple[ChunkHeaderVariant, ...] = ()


@dataclass(frozen=True, slots=True)
class ResolvedDisplayBudget:
    max_tokens: int
    target_tokens: int
    min_tokens: int
    overlap_tokens: int
    header_token_count: int = 0


@dataclass(frozen=True, slots=True)
class ChunkTextAssembly:
    text: str
    header_mode: str
    header_token_count: int
    display_token_count: int
    total_token_count: int


class ChunkProfileLike(Protocol):
    max_chunk_size: int
    final_text_aware: bool

    def count_tokens(self, text: str) -> int: ...

    def resolve_display_budget(self, *, header_token_count: int = 0) -> ResolvedDisplayBudget: ...


class UnitWithContext(Protocol):
    anchor: Mapping[str, object]
    metadata: Mapping[str, object]


def build_chunk_text_context(
    *,
    anchor: Mapping[str, object] | None = None,
    metadata: Mapping[str, object] | None = None,
) -> ChunkTextContextPlan:
    resolved_anchor = anchor or {}
    resolved_metadata = metadata or {}
    title_text = _normalize_context_text(resolved_metadata.get("title"))
    policy_doc_no = _normalize_context_text(resolved_metadata.get("policy_doc_no"))
    preface_text = _normalize_context_text(resolved_metadata.get("preface_text"))
    has_document_context = any(value for value in (title_text, policy_doc_no, preface_text))
    if not has_document_context:
        return ChunkTextContextPlan()

    section_path = resolved_anchor.get("section_path")
    normalized_section_path = (
        tuple(str(item).strip() for item in section_path if str(item).strip())
        if isinstance(section_path, list)
        else ()
    )
    normalized_section_path = _dedupe_context_section_path(
        title_text=title_text,
        section_path=normalized_section_path,
    )
    article_text = _normalize_context_text(resolved_anchor.get("article_label"))
    provision_text = _normalize_context_text(resolved_anchor.get("provision_label"))
    table_text = _normalize_context_text(resolved_anchor.get("table_context"))
    detail_label = _resolve_detail_label(
        article_text=article_text,
        provision_text=provision_text,
        table_text=table_text,
    )
    page_family_text = _normalize_context_text(resolved_metadata.get("page_family"))
    serving_intent_text = _normalize_context_text(resolved_metadata.get("serving_intent"))
    is_official_web_promotable_context = (
        page_family_text in _OFFICIAL_WEB_PAGE_FAMILIES
        and serving_intent_text != "audit_only"
        and page_family_text != "listing_page"
    )

    full_parts: list[str] = []
    if title_text:
        full_parts.append(f"标题：{title_text}")
    if normalized_section_path:
        full_parts.append(f"章节：{' > '.join(normalized_section_path)}")
    if detail_label:
        full_parts.append(detail_label)
    full_header = " | ".join(full_parts).strip()

    compact_parts: list[str] = []
    if title_text:
        compact_parts.append(f"标题：{title_text}")
    if normalized_section_path:
        compact_parts.append(f"章节：{normalized_section_path[-1]}")
    if detail_label:
        compact_parts.append(detail_label)
    compact_header = " | ".join(compact_parts).strip()

    compact_identity_parts: list[str] = []
    if title_text:
        compact_identity_parts.append(title_text)
    if normalized_section_path:
        compact_identity_parts.append(normalized_section_path[-1])
    if article_text:
        compact_identity_parts.append(article_text)
    elif provision_text:
        compact_identity_parts.append(provision_text)
    elif table_text:
        compact_identity_parts.append(table_text)
    compact_identity = " / ".join(compact_identity_parts).strip()

    required_header = compact_header or title_text or compact_identity or full_header
    if not required_header:
        return ChunkTextContextPlan()

    doc_no_line = f"文号：{policy_doc_no}" if policy_doc_no else None
    variants: list[ChunkHeaderVariant] = []
    _append_header_variant(
        variants, mode="full_path", base_line=full_header, doc_no_line=doc_no_line
    )
    _append_header_variant(
        variants, mode="compact_path", base_line=compact_header, doc_no_line=doc_no_line
    )
    if not is_official_web_promotable_context:
        _append_header_variant(
            variants, mode="compact_identity", base_line=compact_identity, doc_no_line=doc_no_line
        )
    _append_header_variant(
        variants,
        mode="title_only",
        base_line=title_text or None,
        doc_no_line=doc_no_line,
    )
    required_variant = ChunkHeaderVariant(mode="required", lines=(required_header,))
    _append_existing_variant(variants, required_variant)
    return ChunkTextContextPlan(
        required_variant=required_variant,
        preferred_variants=tuple(variants),
    )


def assemble_chunk_text(
    *,
    display_text: str,
    context_plan: ChunkTextContextPlan,
    chunk_profile: ChunkProfileLike,
) -> ChunkTextAssembly:
    normalized_display_text = display_text.strip()
    if not normalized_display_text:
        return ChunkTextAssembly(
            text="",
            header_mode="none",
            header_token_count=0,
            display_token_count=0,
            total_token_count=0,
        )
    display_token_count = _estimate_token_count(
        normalized_display_text, chunk_profile=chunk_profile
    )
    if context_plan.required_variant is None:
        return ChunkTextAssembly(
            text=normalized_display_text,
            header_mode="none",
            header_token_count=0,
            display_token_count=display_token_count,
            total_token_count=display_token_count,
        )

    fitting_variants: list[tuple[ChunkHeaderVariant, str, int, int]] = []
    for variant in context_plan.preferred_variants:
        candidate_text, header_token_count = _compose_contextual_chunk_text(
            display_text=normalized_display_text,
            variant=variant,
            chunk_profile=chunk_profile,
        )
        total_token_count = _estimate_token_count(candidate_text, chunk_profile=chunk_profile)
        if total_token_count <= chunk_profile.max_chunk_size:
            fitting_variants.append(
                (variant, candidate_text, header_token_count, total_token_count)
            )
    selected_variant = _select_header_variant_for_display(
        fitting_variants=fitting_variants,
        display_token_count=display_token_count,
    )
    if selected_variant is not None:
        variant, candidate_text, header_token_count, total_token_count = selected_variant
        return ChunkTextAssembly(
            text=candidate_text,
            header_mode=variant.mode,
            header_token_count=header_token_count,
            display_token_count=display_token_count,
            total_token_count=total_token_count,
        )

    fallback_text, header_token_count = _compose_contextual_chunk_text(
        display_text=normalized_display_text,
        variant=context_plan.required_variant,
        chunk_profile=chunk_profile,
    )
    total_token_count = _estimate_token_count(fallback_text, chunk_profile=chunk_profile)
    return ChunkTextAssembly(
        text=fallback_text,
        header_mode=context_plan.required_variant.mode,
        header_token_count=header_token_count,
        display_token_count=display_token_count,
        total_token_count=total_token_count,
    )


def resolve_display_budget(
    *,
    unit: UnitWithContext,
    chunk_profile: ChunkProfileLike,
) -> ResolvedDisplayBudget:
    context_plan = build_chunk_text_context(anchor=unit.anchor, metadata=unit.metadata)
    header_token_count = 0
    if chunk_profile.final_text_aware and context_plan.required_variant is not None:
        header_token_count = _estimate_token_count(
            context_plan.required_variant.joined_text(),
            chunk_profile=chunk_profile,
        )
    return chunk_profile.resolve_display_budget(header_token_count=header_token_count)


def _estimate_token_count(text: str, *, chunk_profile: ChunkProfileLike) -> int:
    return chunk_profile.count_tokens(text)


def _select_header_variant_for_display(
    *,
    fitting_variants: list[tuple[ChunkHeaderVariant, str, int, int]],
    display_token_count: int,
) -> tuple[ChunkHeaderVariant, str, int, int] | None:
    if not fitting_variants:
        return None
    if display_token_count >= 120:
        return fitting_variants[0]

    short_display_mode_order = {
        "compact_identity": 0,
        "compact_path": 1,
        "full_path": 2,
        "title_only": 3,
        "required": 4,
    }
    return min(
        fitting_variants,
        key=lambda item: (
            short_display_mode_order.get(item[0].mode, 99),
            item[2],
            item[3],
        ),
    )


def _normalize_context_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _dedupe_context_section_path(
    *, title_text: str | None, section_path: tuple[str, ...]
) -> tuple[str, ...]:
    if not title_text or not section_path:
        return section_path
    if _context_text_equivalent(title_text, section_path[-1]):
        return section_path[:-1]
    return section_path


def _context_text_equivalent(left: str, right: str) -> bool:
    return left.strip().casefold() == right.strip().casefold()


def _resolve_detail_label(
    *,
    article_text: str | None,
    provision_text: str | None,
    table_text: str | None,
) -> str | None:
    if article_text:
        return f"条款：{article_text}"
    if provision_text:
        return f"款项：{provision_text}"
    if table_text:
        return f"表格：{table_text}"
    return None


def _append_header_variant(
    variants: list[ChunkHeaderVariant],
    *,
    mode: str,
    base_line: str | None,
    doc_no_line: str | None = None,
) -> None:
    lines = tuple(
        line.strip() for line in (base_line, doc_no_line) if isinstance(line, str) and line.strip()
    )
    if not lines:
        return
    _append_existing_variant(variants, ChunkHeaderVariant(mode=mode, lines=lines))


def _append_existing_variant(
    variants: list[ChunkHeaderVariant],
    variant: ChunkHeaderVariant,
) -> None:
    variant_text = variant.joined_text()
    if not variant_text:
        return
    if any(existing.joined_text() == variant_text for existing in variants):
        return
    variants.append(variant)


def _compose_contextual_chunk_text(
    *,
    display_text: str,
    variant: ChunkHeaderVariant,
    chunk_profile: ChunkProfileLike,
) -> tuple[str, int]:
    header_text = variant.joined_text()
    if not header_text:
        return display_text, 0
    candidate_text = "\n".join([header_text, display_text]).strip()
    header_token_count = _estimate_token_count(header_text, chunk_profile=chunk_profile)
    return candidate_text, header_token_count


__all__ = [
    "ChunkTextAssembly",
    "ChunkTextContextPlan",
    "ResolvedDisplayBudget",
    "assemble_chunk_text",
    "build_chunk_text_context",
    "resolve_display_budget",
]
