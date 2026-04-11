from __future__ import annotations

from dataclasses import dataclass
import re

from campus_contracts import EvidenceBundle


_WHITESPACE_RE = re.compile(r"\s+")
_CITATION_RE = re.compile(r"\[[^\]]+\]")
_QUOTED_TITLE_RE = re.compile(r"《([^》]{2,40})》")
_TIME_CLAIM_RE = re.compile(
    r"((?:\d{1,4}|[一二三四五六七八九十两]+)(?:个)?(?:工作日|日|天|周|星期|个月|月|年|小时|分钟|学分|门|次|项))"
)
_CLAUSE_SPLIT_RE = re.compile(r"[。；;！!？?\n]+")
_REQUIREMENT_CUE_TOKENS = (
    "需要",
    "需",
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
    "挂失",
)
_REQUIREMENT_CLAIM_PATTERNS = (
    re.compile(
        r"(?:提交|填写|准备|提供|携带)"
        r"([\u4e00-\u9fffA-Za-z0-9（）()]{1,12}"
        r"(?:申请表|申请|原件|复印件|材料|证明|证件|身份证|学生证))"
    ),
    re.compile(
        r"(?:到|经|由|向)?"
        r"([\u4e00-\u9fffA-Za-z0-9（）()]{1,10}"
        r"(?:审核|审批|备案|盖章|手续))"
    ),
    re.compile(r"(?:办理|及时)?([\u4e00-\u9fffA-Za-z0-9（）()]{1,8}挂失)"),
)
_OFFERING_UNIT_CLAIM_PATTERNS = (
    re.compile(
        r"(?:由|是)?"
        r"([\u4e00-\u9fffA-Za-z0-9（）()]{1,20}(?:学院|系|部|中心|教研室|研究院))"
        r"(?:负责)?(?:开设|开课|开的)"
    ),
    re.compile(
        r"(?:开设单位|开课单位|开课学院|负责单位)[：:\s]*"
        r"([\u4e00-\u9fffA-Za-z0-9（）()]{1,20}(?:学院|系|部|中心|教研室|研究院))"
    ),
)
_AUDIENCE_CLAIM_PATTERNS = (
    re.compile(
        r"([\u4e00-\u9fffA-Za-z0-9、，,和及以及/（）()]{1,40}专业)"
        r"(?:要上|应修|需要修读|需要上|需修|为必修|应当修读|必须修读)"
    ),
    re.compile(
        r"((?:所有|全体)?[\u4e00-\u9fffA-Za-z0-9、，,和及以及/（）()]{0,24}"
        r"(?:本预科学生|本科生|研究生|学生))"
        r"(?:要上|应修|需要修读|需要上|需修|为必修|应当修读|应认真完成)"
    ),
    re.compile(
        r"(?:面向|适用于|适用对象为|针对)"
        r"([\u4e00-\u9fffA-Za-z0-9、，,和及以及/（）()]{1,40}"
        r"(?:专业|本预科学生|本科生|研究生|学生))"
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
class GroundingValidationResult:
    verdict: str
    unsupported_fields: tuple[str, ...] = ()


def validate_prompt_answer_grounding(
    *,
    answer_text: str,
    evidence: EvidenceBundle,
) -> GroundingValidationResult:
    support_text = _build_support_text(evidence)
    if not support_text:
        return GroundingValidationResult(
            verdict="unsupported",
            unsupported_fields=("citation_missing",),
        )

    unsupported_fields: list[str] = []
    claim_extractors = (
        ("title_claims", _extract_title_claims),
        ("time_claims", _extract_time_claims),
        ("requirement_claims", _extract_requirement_claims),
        ("offering_unit_claims", _extract_offering_unit_claims),
        ("audience_claims", _extract_audience_claims),
    )
    for field_name, extractor in claim_extractors:
        claims = extractor(answer_text)
        if claims and any(not _claim_supported(claim, support_text) for claim in claims):
            unsupported_fields.append(field_name)

    if unsupported_fields:
        return GroundingValidationResult(
            verdict="unsupported",
            unsupported_fields=tuple(dict.fromkeys(unsupported_fields)),
        )
    return GroundingValidationResult(verdict="grounded")


def _build_support_text(evidence: EvidenceBundle) -> str:
    parts: list[str] = []
    for source in evidence.sources:
        parts.extend(item for item in source.structural_path if item.strip())
        parts.extend(
            (
                source.source_title,
                source.detail_label,
                source.snippet,
            )
        )
    return _normalize_text(" ".join(part for part in parts if part.strip())).lower()


def _extract_title_claims(answer_text: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(match.group(1).strip() for match in _QUOTED_TITLE_RE.finditer(answer_text)))


def _extract_time_claims(answer_text: str) -> tuple[str, ...]:
    sanitized = _sanitize_answer_text(answer_text)
    return tuple(dict.fromkeys(match.group(1).strip() for match in _TIME_CLAIM_RE.finditer(sanitized)))


def _extract_requirement_claims(answer_text: str) -> tuple[str, ...]:
    claims: list[str] = []
    sanitized = _sanitize_answer_text(answer_text)
    for clause in _CLAUSE_SPLIT_RE.split(sanitized):
        normalized_clause = _normalize_text(clause)
        if not normalized_clause:
            continue
        if not any(token in normalized_clause for token in _REQUIREMENT_CUE_TOKENS):
            continue
        for pattern in _REQUIREMENT_CLAIM_PATTERNS:
            for match in pattern.finditer(normalized_clause):
                claim = _normalize_requirement_claim(match.group(1))
                if claim in _LOW_SIGNAL_REQUIREMENT_PHRASES:
                    continue
                claims.append(claim)
    return tuple(dict.fromkeys(claims))


def _extract_offering_unit_claims(answer_text: str) -> tuple[str, ...]:
    claims: list[str] = []
    sanitized = _sanitize_answer_text(answer_text)
    for clause in _CLAUSE_SPLIT_RE.split(sanitized):
        normalized_clause = _normalize_text(clause)
        if not normalized_clause:
            continue
        for pattern in _OFFERING_UNIT_CLAIM_PATTERNS:
            for match in pattern.finditer(normalized_clause):
                claim = match.group(1).strip("，,；;：:。 ")
                if claim:
                    claims.append(claim)
    return tuple(dict.fromkeys(claims))


def _extract_audience_claims(answer_text: str) -> tuple[str, ...]:
    claims: list[str] = []
    sanitized = _sanitize_answer_text(answer_text)
    for clause in _CLAUSE_SPLIT_RE.split(sanitized):
        normalized_clause = _normalize_text(clause)
        if not normalized_clause:
            continue
        for pattern in _AUDIENCE_CLAIM_PATTERNS:
            for match in pattern.finditer(normalized_clause):
                claims.extend(_expand_audience_claim(match.group(1)))
    return tuple(dict.fromkeys(claims))


def _normalize_requirement_claim(claim: str) -> str:
    normalized = claim.strip("，,；;：:。 ")
    normalized = re.sub(r"^(?:并|再|后|先|及时)", "", normalized)
    normalized = re.sub(r"^(?:办理|提交|填写|携带|提供|准备|到|经|由|向)", "", normalized)
    normalized = normalized.strip("，,；;：:。 ")
    if normalized.endswith("挂失"):
        return "挂失"
    if normalized == "办理挂失":
        return "挂失"
    if normalized.endswith("并到学院审核"):
        return "学院审核"
    return normalized


def _expand_audience_claim(raw_claim: str) -> tuple[str, ...]:
    normalized = raw_claim.strip("，,；;：:。 ")
    normalized = re.sub(r"等(?=(?:专业|本预科学生|本科生|研究生|学生)$)", "", normalized)
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
        cleaned = re.sub(r"等(?=(?:专业|本预科学生|本科生|研究生|学生)$)", "", cleaned)
        if suffix and not cleaned.endswith(suffix):
            cleaned = f"{cleaned}{suffix}"
        if cleaned:
            expanded.append(cleaned)
    return tuple(dict.fromkeys(expanded))


def _resolve_audience_suffix(claim: str) -> str:
    for suffix in ("本预科学生", "本科生", "研究生", "学生", "专业"):
        if claim.endswith(suffix):
            return suffix
    return ""


def _sanitize_answer_text(answer_text: str) -> str:
    return _normalize_text(_CITATION_RE.sub(" ", answer_text))


def _claim_supported(claim: str, support_text: str) -> bool:
    normalized_claim = _normalize_text(claim).lower()
    if not normalized_claim:
        return True
    return normalized_claim in support_text


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


__all__ = [
    "GroundingValidationResult",
    "validate_prompt_answer_grounding",
]
