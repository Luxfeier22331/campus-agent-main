from __future__ import annotations

from dataclasses import dataclass
import re

from campus_contracts import ClaimSupport, EvidenceBundle, EvidenceSource
from campus_shared import (
    NormalizedProviderGroundingSupport,
    normalize_provider_grounding_supports,
)


_WHITESPACE_RE = re.compile(r"\s+")
_CITATION_RE = re.compile(r"\[[^\]]+\]")
_MATCHING_PUNCTUATION_RE = re.compile(r"[“”\"'《》【】（）()，,；;：:。！？!?.、·\[\]]")
_CLAUSE_SPLIT_RE = re.compile(r"[。；;！!？?\n]+")
_QUOTED_TITLE_RE = re.compile(r"《([^》]{2,40})》")
_TIME_CLAIM_RE = re.compile(
    r"((?:\d{1,4}|[一二三四五六七八九十两零〇]+)(?:个)?(?:工作日|日|天|周|星期|个月|月|年|小时|分钟))"
)
_QUANTITY_CLAIM_RE = re.compile(
    r"((?:\d+(?:\.\d+)?|[一二三四五六七八九十两零〇]+)(?:\s*)?(?:学分|学时|周学时|门|次|项|分|绩点))"
)
_SEMESTER_OR_TERM_RE = re.compile(
    r"((?:第(?:\d+|[一二三四五六七八九十两零〇]+)学期|第(?:\d+|[一二三四五六七八九十两零〇]+)学年|"
    r"(?:大一|大二|大三|大四|研一|研二|研三)(?:上|下)?|(?:春季|秋季|夏季|冬季)学期))"
)
_MATERIAL_DIRECT_RE = re.compile(
    r"(身份证原件|身份证复印件|学生证原件|学生证复印件|书面申请|申请表|证明材料|申请材料|相关材料|证明|原件|复印件)"
)
_MATERIAL_ACTION_RE = re.compile(
    r"(?:提交|填写|准备|提供|携带)"
    r"([\u4e00-\u9fffA-Za-z0-9（）()]{1,16}"
    r"(?:申请表|书面申请|申请|原件|复印件|材料|证明|证件|身份证|学生证))"
)
_PROCEDURE_CLAIM_PATTERNS = (
    re.compile(r"(学院审核|部门审核|审核|审批|备案|盖章|挂失|报到|选课|缴费|注册)"),
)
_ELIGIBILITY_CLAIM_PATTERNS = (
    re.compile(
        r"(?:仅限|限|要求|需满足|须满足|必须为|仅面向)"
        r"([\u4e00-\u9fffA-Za-z0-9、，,和及以及/（）()]{1,32}"
        r"(?:学生|专业|班|人员|身份|资格|条件))"
    ),
    re.compile(
        r"([\u4e00-\u9fffA-Za-z0-9、，,和及以及/（）()]{1,32}"
        r"(?:学生|专业|班|人员|身份|资格|条件))"
        r"(?:方可|才能|才可|可以)办理"
    ),
)
_OFFERING_UNIT_NAME_RE = re.compile(
    r"([\u4e00-\u9fffA-Za-z0-9（）()]{1,20}(?:学院|系|部|中心|教研室|研究院))"
)
_OFFERING_UNIT_PREFIX_CUES = ("由", "是", "开设单位", "开课单位", "开课学院", "负责单位")
_OFFERING_UNIT_SUFFIX_CUES = ("开设", "开课", "开的", "负责")
_AUDIENCE_MAJOR_GROUP_RE = re.compile(
    r"((?:[\u4e00-\u9fffA-Za-z0-9]{1,16}专业(?:、|，|,|/|和|及|以及)?)+)"
)
_AUDIENCE_POPULATION_RE = re.compile(
    r"((?:所有|全体)?[\u4e00-\u9fffA-Za-z0-9]{0,24}"
    r"(?:本预科学生|本科生|研究生|学生|民族班|实验班|基地班))"
)
_AUDIENCE_CUE_TOKENS = (
    "要上",
    "应修",
    "需要修读",
    "需要上",
    "需修",
    "为必修",
    "应当修读",
    "必须修读",
    "应认真完成",
    "面向",
    "适用于",
    "适用对象为",
    "针对",
)
_FRESHNESS_SENSITIVE_STATUS_PATTERNS = (
    re.compile(
        r"((?:当前|目前|最新|最近|今日|今天|本周|近期|截至目前|截至今日)"
        r"[\u4e00-\u9fffA-Za-z0-9（）()]{0,20}"
        r"(?:开放|关闭|更新|发布|有效|可用|上线|报名|通知|安排))"
    ),
)
_AUTHORIZATION_SENSITIVE_CLAIM_PATTERNS = (
    re.compile(
        r"((?:仅限|只对|仅对|需登录|需要登录|须登录|认证后|授权后|校内身份|校内用户)"
        r"[\u4e00-\u9fffA-Za-z0-9（）()]{0,24}"
        r"(?:访问|查看|读取|办理|可见|开放)?)"
    ),
)
_LOW_SIGNAL_REQUIREMENT_PHRASES = frozenset(
    {
        "需要",
        "须",
        "应",
        "必须",
        "提交",
        "填写",
        "携带",
        "提供",
        "准备",
        "办理",
        "审核",
    }
)
_AUDIENCE_SPLIT_RE = re.compile(r"(?:、|，|,|/|以及|及|和)")


@dataclass(frozen=True, slots=True)
class ExtractedClaim:
    claim_type: str
    claim_text: str
    unsupported_summary_field: str


@dataclass(frozen=True, slots=True)
class SupportCandidate:
    support_source_doc_id: str
    support_snippet: str
    haystack: str


@dataclass(frozen=True, slots=True)
class GroundingValidationResult:
    verdict: str
    unsupported_fields: tuple[str, ...] = ()
    claim_supports: tuple[ClaimSupport, ...] = ()


def validate_prompt_answer_grounding(
    *,
    answer_text: str,
    evidence: EvidenceBundle,
    provider_grounding_supports: object | tuple[NormalizedProviderGroundingSupport, ...] | None = None,
) -> GroundingValidationResult:
    support_candidates = _build_support_candidates(
        evidence,
        provider_grounding_supports=provider_grounding_supports,
    )
    extracted_claims = _extract_claims(answer_text)
    claim_supports = tuple(
        _build_claim_support(claim, support_candidates=support_candidates)
        for claim in extracted_claims
    )

    unsupported_fields: list[str] = []
    if not support_candidates:
        unsupported_fields.append("citation_missing")
    unsupported_fields.extend(
        claim.unsupported_summary_field
        for claim, claim_support in zip(extracted_claims, claim_supports, strict=False)
        if not claim_support.supported
    )
    deduped_unsupported_fields = tuple(dict.fromkeys(unsupported_fields))
    verdict = "grounded" if not deduped_unsupported_fields else "unsupported"
    return GroundingValidationResult(
        verdict=verdict,
        unsupported_fields=deduped_unsupported_fields,
        claim_supports=claim_supports,
    )


def _build_support_candidates(
    evidence: EvidenceBundle,
    *,
    provider_grounding_supports: object | tuple[NormalizedProviderGroundingSupport, ...] | None,
) -> tuple[SupportCandidate, ...]:
    candidates: list[SupportCandidate] = []
    for source in evidence.sources:
        candidates.extend(_build_source_support_candidates(source))
    for support in _normalize_optional_provider_supports(provider_grounding_supports):
        snippet = support.support_snippet.strip() or support.claim_text.strip()
        haystack = _normalize_matching_text(f"{support.claim_text} {snippet}")
        if not haystack:
            continue
        candidates.append(
            SupportCandidate(
                support_source_doc_id=support.support_source_doc_id,
                support_snippet=snippet,
                haystack=haystack,
            )
        )
    return tuple(_dedupe_support_candidates(candidates))


def _build_source_support_candidates(source: EvidenceSource) -> tuple[SupportCandidate, ...]:
    snippets = [
        source.source_title.strip(),
        source.detail_label.strip(),
        *(item.strip() for item in source.structural_path if item.strip()),
        source.snippet.strip(),
    ]
    candidates: list[SupportCandidate] = []
    for snippet in snippets:
        haystack = _normalize_matching_text(snippet)
        if not haystack:
            continue
        candidates.append(
            SupportCandidate(
                support_source_doc_id=source.doc_id,
                support_snippet=snippet,
                haystack=haystack,
            )
        )
    combined_text = " ".join(snippet for snippet in snippets if snippet)
    combined_haystack = _normalize_matching_text(combined_text)
    if combined_haystack:
        candidates.append(
            SupportCandidate(
                support_source_doc_id=source.doc_id,
                support_snippet=source.snippet.strip() or source.source_title.strip(),
                haystack=combined_haystack,
            )
        )
    return tuple(_dedupe_support_candidates(candidates))


def _dedupe_support_candidates(
    candidates: list[SupportCandidate],
) -> tuple[SupportCandidate, ...]:
    deduped: list[SupportCandidate] = []
    seen: set[tuple[str, str, str]] = set()
    for candidate in candidates:
        key = (
            candidate.support_source_doc_id,
            candidate.support_snippet,
            candidate.haystack,
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return tuple(deduped)


def _normalize_optional_provider_supports(
    payload: object | tuple[NormalizedProviderGroundingSupport, ...] | None,
) -> tuple[NormalizedProviderGroundingSupport, ...]:
    if payload is None:
        return ()
    if isinstance(payload, tuple) and all(
        isinstance(item, NormalizedProviderGroundingSupport) for item in payload
    ):
        return payload
    return normalize_provider_grounding_supports(payload)


def _extract_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    extractors = (
        _extract_title_claims,
        _extract_time_claims,
        _extract_quantity_claims,
        _extract_semester_or_term_claims,
        _extract_offering_unit_claims,
        _extract_audience_claims,
        _extract_requirement_claims,
        _extract_freshness_sensitive_status_claims,
        _extract_authorization_sensitive_claims,
    )
    for extractor in extractors:
        claims.extend(extractor(answer_text))

    deduped: list[ExtractedClaim] = []
    seen: set[tuple[str, str]] = set()
    for claim in claims:
        normalized_claim = _normalize_matching_text(claim.claim_text)
        if not normalized_claim:
            continue
        key = (claim.claim_type, normalized_claim)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(claim)
    return tuple(deduped)


def _extract_title_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    return tuple(
        ExtractedClaim(
            claim_type="title_or_entity_identity",
            claim_text=match.group(1).strip(),
            unsupported_summary_field="title_claims",
        )
        for match in _QUOTED_TITLE_RE.finditer(answer_text)
        if match.group(1).strip()
    )


def _extract_time_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    sanitized = _sanitize_answer_text(answer_text)
    return tuple(
        ExtractedClaim(
            claim_type="time_or_deadline",
            claim_text=match.group(1).strip(),
            unsupported_summary_field="time_claims",
        )
        for match in _TIME_CLAIM_RE.finditer(sanitized)
        if match.group(1).strip()
    )


def _extract_quantity_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    sanitized = _sanitize_answer_text(answer_text)
    return tuple(
        ExtractedClaim(
            claim_type="quantity_or_credit_or_score_requirement",
            claim_text=match.group(1).strip(),
            unsupported_summary_field="quantity_or_credit_or_score_requirement_claims",
        )
        for match in _QUANTITY_CLAIM_RE.finditer(sanitized)
        if match.group(1).strip()
    )


def _extract_semester_or_term_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    sanitized = _sanitize_answer_text(answer_text)
    return tuple(
        ExtractedClaim(
            claim_type="semester_or_grade_or_term_placement",
            claim_text=match.group(1).strip(),
            unsupported_summary_field="semester_or_grade_or_term_placement_claims",
        )
        for match in _SEMESTER_OR_TERM_RE.finditer(sanitized)
        if match.group(1).strip()
    )


def _extract_offering_unit_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    sanitized = _sanitize_answer_text(answer_text)
    for clause in _CLAUSE_SPLIT_RE.split(sanitized):
        normalized_clause = _normalize_text(clause)
        if not normalized_clause:
            continue
        for match in _OFFERING_UNIT_NAME_RE.finditer(normalized_clause):
            claim_text = _normalize_offering_unit_claim(match.group(1))
            if not claim_text:
                continue
            prefix = normalized_clause[max(0, match.start(1) - 12) : match.start(1)]
            suffix = normalized_clause[match.end(1) : match.end(1) + 12]
            if not (
                any(cue in prefix for cue in _OFFERING_UNIT_PREFIX_CUES)
                or any(cue in suffix for cue in _OFFERING_UNIT_SUFFIX_CUES)
            ):
                continue
            claims.append(
                ExtractedClaim(
                    claim_type="offering_unit_or_owning_school",
                    claim_text=claim_text,
                    unsupported_summary_field="offering_unit_claims",
                )
            )
    return tuple(claims)


def _extract_audience_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    sanitized = _sanitize_answer_text(answer_text)
    for clause in _CLAUSE_SPLIT_RE.split(sanitized):
        normalized_clause = _normalize_text(clause)
        if not normalized_clause:
            continue
        if not any(token in normalized_clause for token in _AUDIENCE_CUE_TOKENS):
            continue
        for match in _AUDIENCE_MAJOR_GROUP_RE.finditer(normalized_clause):
            raw_group = match.group(1).strip("，,；;：:。 ")
            if not raw_group.endswith("专业"):
                continue
            for claim_text in _expand_audience_claim(raw_group):
                claims.append(
                    ExtractedClaim(
                        claim_type="audience_or_major_or_program_or_class_family",
                        claim_text=claim_text,
                        unsupported_summary_field="audience_claims",
                    )
                )
        for match in _AUDIENCE_POPULATION_RE.finditer(normalized_clause):
            claim_text = match.group(1).strip("，,；;：:。 ")
            if not claim_text:
                continue
            claims.append(
                ExtractedClaim(
                    claim_type="audience_or_major_or_program_or_class_family",
                    claim_text=claim_text,
                    unsupported_summary_field="audience_claims",
                )
            )
    return tuple(claims)


def _extract_requirement_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    sanitized = _sanitize_answer_text(answer_text)
    for clause in _CLAUSE_SPLIT_RE.split(sanitized):
        normalized_clause = _normalize_text(clause)
        if not normalized_clause:
            continue
        claims.extend(_extract_material_requirement_claims(normalized_clause))
        claims.extend(_extract_procedure_step_claims(normalized_clause))
        claims.extend(_extract_eligibility_requirement_claims(normalized_clause))
    return tuple(claims)


def _extract_material_requirement_claims(clause: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    for match in _MATERIAL_DIRECT_RE.finditer(clause):
        claim_text = _normalize_material_claim(match.group(1))
        if not claim_text:
            continue
        claims.append(
            ExtractedClaim(
                claim_type="material_requirement",
                claim_text=claim_text,
                unsupported_summary_field="requirement_claims",
            )
        )
    for match in _MATERIAL_ACTION_RE.finditer(clause):
        claim_text = _normalize_material_claim(match.group(1))
        if not claim_text:
            continue
        claims.append(
            ExtractedClaim(
                claim_type="material_requirement",
                claim_text=claim_text,
                unsupported_summary_field="requirement_claims",
            )
        )
    return tuple(claims)


def _extract_procedure_step_claims(clause: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    if not any(
        token in clause
        for token in (
            "办理",
            "审核",
            "审批",
            "备案",
            "盖章",
            "挂失",
            "报到",
            "选课",
            "缴费",
            "注册",
        )
    ):
        return ()
    for pattern in _PROCEDURE_CLAIM_PATTERNS:
        for match in pattern.finditer(clause):
            claim_text = _normalize_procedure_claim(match.group(1))
            if not claim_text or claim_text in _LOW_SIGNAL_REQUIREMENT_PHRASES:
                continue
            claims.append(
                ExtractedClaim(
                    claim_type="procedure_step",
                    claim_text=claim_text,
                    unsupported_summary_field="requirement_claims",
                )
            )
    return tuple(claims)


def _extract_eligibility_requirement_claims(clause: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    for pattern in _ELIGIBILITY_CLAIM_PATTERNS:
        for match in pattern.finditer(clause):
            claim_text = match.group(1).strip("，,；;：:。 ")
            if not claim_text:
                continue
            claims.append(
                ExtractedClaim(
                    claim_type="eligibility_requirement",
                    claim_text=claim_text,
                    unsupported_summary_field="requirement_claims",
                )
            )
    return tuple(claims)


def _extract_freshness_sensitive_status_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    sanitized = _sanitize_answer_text(answer_text)
    for pattern in _FRESHNESS_SENSITIVE_STATUS_PATTERNS:
        for match in pattern.finditer(sanitized):
            claim_text = match.group(1).strip("，,；;：:。 ")
            if not claim_text:
                continue
            claims.append(
                ExtractedClaim(
                    claim_type="freshness_sensitive_status",
                    claim_text=claim_text,
                    unsupported_summary_field="freshness_sensitive_status_claims",
                )
            )
    return tuple(claims)


def _extract_authorization_sensitive_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    sanitized = _sanitize_answer_text(answer_text)
    for pattern in _AUTHORIZATION_SENSITIVE_CLAIM_PATTERNS:
        for match in pattern.finditer(sanitized):
            claim_text = match.group(1).strip("，,；;：:。 ")
            if not claim_text:
                continue
            claims.append(
                ExtractedClaim(
                    claim_type="authorization_sensitive_claim",
                    claim_text=claim_text,
                    unsupported_summary_field="authorization_sensitive_claims",
                )
            )
    return tuple(claims)


def _build_claim_support(
    claim: ExtractedClaim,
    *,
    support_candidates: tuple[SupportCandidate, ...],
) -> ClaimSupport:
    candidate = _find_support_candidate(claim.claim_text, support_candidates=support_candidates)
    if candidate is None:
        return ClaimSupport(
            claim_type=claim.claim_type,
            claim_text=claim.claim_text,
            supported=False,
        )
    return ClaimSupport(
        claim_type=claim.claim_type,
        claim_text=claim.claim_text,
        supported=True,
        support_source_doc_id=candidate.support_source_doc_id,
        support_snippet=candidate.support_snippet,
    )


def _find_support_candidate(
    claim_text: str,
    *,
    support_candidates: tuple[SupportCandidate, ...],
) -> SupportCandidate | None:
    normalized_claim = _normalize_matching_text(claim_text)
    if not normalized_claim:
        return None
    for candidate in support_candidates:
        if normalized_claim in candidate.haystack:
            return candidate
    return None


def _normalize_material_claim(claim: str) -> str:
    normalized = claim.strip("，,；;：:。 ")
    normalized = re.sub(r"^(?:并|再|后|先|及时)", "", normalized)
    normalized = re.sub(r"^(?:提交|填写|携带|提供|准备)", "", normalized)
    return normalized.strip("，,；;：:。 ")


def _normalize_procedure_claim(claim: str) -> str:
    normalized = claim.strip("，,；;：:。 ")
    normalized = re.sub(r"^(?:并|再|后|先|及时)", "", normalized)
    normalized = re.sub(r"^(?:办理|进行|完成|到|向|经|由)", "", normalized)
    normalized = normalized.strip("，,；;：:。 ")
    if normalized == "办理挂失":
        return "挂失"
    return normalized


def _normalize_offering_unit_claim(claim: str) -> str:
    normalized = claim.strip("，,；;：:。 ")
    normalized = re.sub(r"^.*(?:由|是)", "", normalized)
    normalized = re.sub(r"^(?:这门课|本课|该课|课程)", "", normalized)
    return normalized.strip("，,；;：:。 ")


def _expand_audience_claim(raw_claim: str) -> tuple[str, ...]:
    normalized = raw_claim.strip("，,；;：:。 ")
    normalized = re.sub(r"等(?=(?:专业|本预科学生|本科生|研究生|学生|民族班|实验班|基地班)$)", "", normalized)
    if not normalized:
        return ()

    suffix = _resolve_audience_suffix(normalized)
    parts = [
        part.strip("，,；;：:。 ")
        for part in _AUDIENCE_SPLIT_RE.split(normalized)
        if part.strip("，,；;：:。 ")
    ]
    if len(parts) <= 1:
        return (normalized,)

    expanded: list[str] = []
    for part in parts:
        cleaned = re.sub(r"^(?:面向|适用于|适用对象为|针对)", "", part).strip("，,；;：:。 ")
        cleaned = re.sub(
            r"等(?=(?:专业|本预科学生|本科生|研究生|学生|民族班|实验班|基地班)$)",
            "",
            cleaned,
        )
        if suffix and not cleaned.endswith(suffix):
            cleaned = f"{cleaned}{suffix}"
        if cleaned:
            expanded.append(cleaned)
    return tuple(dict.fromkeys(expanded))


def _resolve_audience_suffix(claim: str) -> str:
    for suffix in ("本预科学生", "本科生", "研究生", "学生", "民族班", "实验班", "基地班", "专业"):
        if claim.endswith(suffix):
            return suffix
    return ""


def _sanitize_answer_text(answer_text: str) -> str:
    return _normalize_text(_CITATION_RE.sub(" ", answer_text))


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def _normalize_matching_text(text: str) -> str:
    normalized = _normalize_text(text)
    normalized = _MATCHING_PUNCTUATION_RE.sub("", normalized)
    return normalized.lower()


__all__ = [
    "GroundingValidationResult",
    "validate_prompt_answer_grounding",
]
