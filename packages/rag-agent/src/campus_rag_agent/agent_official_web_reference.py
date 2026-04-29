from __future__ import annotations

from .agent_official_web_reference_news import (
    _build_official_web_generic_fragments,
    _build_official_web_news_fragments,
    _simplify_official_web_news_sentence,
    _summarize_official_web_news_title,
)
from .agent_official_web_reference_people import (
    _build_official_web_roster_fragments,
    _build_official_web_scholar_reference_fragments,
    _extract_leading_person_name,
    _extract_official_web_roster_entry,
    _extract_official_web_scholar_domains,
    _extract_official_web_scholar_name,
    _official_web_section_path,
    _simplify_official_web_school_role,
)
from .agent_official_web_reference_school import (
    _build_official_web_alumni_reference_fragments,
    _build_official_web_foundation_reference_fragments,
    _build_official_web_graduate_reference_fragments,
    _build_official_web_postdoctoral_reference_fragments,
    _build_official_web_school_overview_fragments,
    _build_official_web_school_reference_fragments,
    _build_official_web_undergraduate_reference_fragments,
    _simplify_school_intro_sentence,
    _simplify_school_origin_sentence,
)
from .agent_official_web_reference_sentences import (
    _first_matching_official_web_sentence,
    _flatten_official_web_sentences,
    _looks_like_official_web_heading,
    _looks_like_official_web_prompt_sentence,
    _split_official_web_sentences,
)

__all__ = [
    "_build_official_web_alumni_reference_fragments",
    "_build_official_web_foundation_reference_fragments",
    "_build_official_web_generic_fragments",
    "_build_official_web_graduate_reference_fragments",
    "_build_official_web_news_fragments",
    "_build_official_web_postdoctoral_reference_fragments",
    "_build_official_web_roster_fragments",
    "_build_official_web_scholar_reference_fragments",
    "_build_official_web_school_overview_fragments",
    "_build_official_web_school_reference_fragments",
    "_build_official_web_undergraduate_reference_fragments",
    "_extract_leading_person_name",
    "_extract_official_web_roster_entry",
    "_extract_official_web_scholar_domains",
    "_extract_official_web_scholar_name",
    "_first_matching_official_web_sentence",
    "_flatten_official_web_sentences",
    "_looks_like_official_web_heading",
    "_looks_like_official_web_prompt_sentence",
    "_official_web_section_path",
    "_simplify_official_web_news_sentence",
    "_simplify_official_web_school_role",
    "_simplify_school_intro_sentence",
    "_simplify_school_origin_sentence",
    "_split_official_web_sentences",
    "_summarize_official_web_news_title",
]
