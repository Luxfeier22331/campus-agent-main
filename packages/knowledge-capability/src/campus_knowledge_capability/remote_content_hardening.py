from __future__ import annotations

import re
from dataclasses import dataclass

from campus_contracts import EvidenceBundle, EvidenceSource, RemoteContentSuspicionSummary

_WHITESPACE_RE = re.compile(r"\s+")
_REMOTE_SOURCE_CHANNELS = frozenset({"official_web", "authenticated_notice_portal"})
_SANITIZED_REMOTE_CONTENT_PLACEHOLDER = "[suspicious remote content omitted]"
_REMOTE_CONTENT_LABEL_ORDER = {
    "prompt_override_signal": 0,
    "instructional_imperative": 1,
    "secret_or_credential_request": 2,
    "tool_or_browser_action_request": 3,
    "hidden_or_embedded_text_marker": 4,
}
_PROMPT_OVERRIDE_PATTERNS = (
    re.compile(r"忽略(?:之前|以上|前面).{0,12}(?:指令|要求|内容)"),
    re.compile(r"(?:system prompt|developer message|prompt override)", re.IGNORECASE),
    re.compile(r"(?:你是|作为).{0,12}(?:助手|assistant|agent)"),
)
_INSTRUCTIONAL_IMPERATIVE_PATTERNS = (
    re.compile(r"(?:请|务必|必须).{0,18}(?:回答|回复|输出|总结|遵循|执行)"),
    re.compile(r"(?:直接|现在).{0,12}(?:输出|回答|回复)"),
)
_SECRET_OR_CREDENTIAL_REQUEST_PATTERNS = (
    re.compile(r"(?:密码|口令|验证码|token|api key|secret|凭证)", re.IGNORECASE),
    re.compile(r"(?:提供|交出|泄露).{0,12}(?:密码|口令|token|api key|secret)", re.IGNORECASE),
)
_TOOL_OR_BROWSER_ACTION_REQUEST_PATTERNS = (
    re.compile(r"(?:浏览器|browser).{0,12}(?:打开|访问|点击)", re.IGNORECASE),
    re.compile(r"(?:运行|执行).{0,12}(?:命令|shell|脚本)", re.IGNORECASE),
    re.compile(r"(?:调用|使用).{0,12}(?:工具|tool|函数)", re.IGNORECASE),
    re.compile(r"(?:访问|打开)\s*https?://", re.IGNORECASE),
)
_HIDDEN_OR_EMBEDDED_TEXT_MARKER_PATTERNS = (
    re.compile(r"(?:display\s*:\s*none|visibility\s*:\s*hidden)", re.IGNORECASE),
    re.compile(r"(?:<!--|<script|base64|zero-width|零宽)", re.IGNORECASE),
    re.compile(r"(?:hidden text|embedded text|不可见文本)", re.IGNORECASE),
)


@dataclass(frozen=True, slots=True)
class ProviderSupportSuspicionAssessment:
    labels: tuple[str, ...] = ()

    @property
    def is_suspicious(self) -> bool:
        return bool(self.labels)


def apply_remote_content_suspicion_labels(evidence: EvidenceBundle) -> EvidenceBundle:
    for source in evidence.sources:
        ensure_remote_content_suspicion_labels(source)
    return evidence


def ensure_remote_content_suspicion_labels(source: EvidenceSource) -> tuple[str, ...]:
    normalized_existing = _normalize_suspicion_labels(source.remote_content_suspicion_labels)
    if normalized_existing:
        if normalized_existing != source.remote_content_suspicion_labels:
            object.__setattr__(source, "remote_content_suspicion_labels", normalized_existing)
        return normalized_existing
    if not is_remote_content_source(source):
        return ()
    detected = detect_remote_content_suspicion_labels(
        source.source_title,
        source.detail_label,
        *source.structural_path,
        source.snippet,
    )
    if detected != source.remote_content_suspicion_labels:
        object.__setattr__(source, "remote_content_suspicion_labels", detected)
    return detected


def is_remote_content_source(source: EvidenceSource) -> bool:
    return source.source_channel in _REMOTE_SOURCE_CHANNELS


def detect_remote_content_suspicion_labels(*texts: str) -> tuple[str, ...]:
    joined = _normalize_text(" ".join(text for text in texts if text))
    if not joined:
        return ()
    labels: list[str] = []
    if any(pattern.search(joined) for pattern in _PROMPT_OVERRIDE_PATTERNS):
        labels.append("prompt_override_signal")
    if any(pattern.search(joined) for pattern in _INSTRUCTIONAL_IMPERATIVE_PATTERNS):
        labels.append("instructional_imperative")
    if any(pattern.search(joined) for pattern in _SECRET_OR_CREDENTIAL_REQUEST_PATTERNS):
        labels.append("secret_or_credential_request")
    if any(pattern.search(joined) for pattern in _TOOL_OR_BROWSER_ACTION_REQUEST_PATTERNS):
        labels.append("tool_or_browser_action_request")
    if any(pattern.search(joined) for pattern in _HIDDEN_OR_EMBEDDED_TEXT_MARKER_PATTERNS):
        labels.append("hidden_or_embedded_text_marker")
    return _normalize_suspicion_labels(labels)


def assess_provider_grounding_support_suspicion(
    *,
    claim_text: str,
    support_snippet: str,
) -> ProviderSupportSuspicionAssessment:
    return ProviderSupportSuspicionAssessment(
        labels=detect_remote_content_suspicion_labels(claim_text, support_snippet),
    )


def sanitize_prompt_visible_text(text: str) -> str:
    normalized = _normalize_text(text)
    if not normalized:
        return ""
    if detect_remote_content_suspicion_labels(normalized):
        return _SANITIZED_REMOTE_CONTENT_PLACEHOLDER
    return normalized


def build_remote_content_safe_summary(source: EvidenceSource) -> str:
    ensure_remote_content_suspicion_labels(source)
    candidate_parts = [
        sanitize_prompt_visible_text(source.source_title),
        sanitize_prompt_visible_text(source.detail_label),
        sanitize_prompt_visible_text(source.snippet)[:120],
    ]
    summary = " | ".join(part for part in candidate_parts if part)
    return summary[:160]


def should_block_remote_content_generation(evidence: EvidenceBundle) -> bool:
    apply_remote_content_suspicion_labels(evidence)
    answer_bearing_remote_sources = tuple(
        source
        for source in evidence.sources
        if source.is_answer_bearing and is_remote_content_source(source)
    )
    if not answer_bearing_remote_sources:
        return False
    return all(source.remote_content_suspicion_labels for source in answer_bearing_remote_sources)


def build_remote_content_suspicion_summary(
    evidence: EvidenceBundle,
    *,
    generation_blocked: bool = False,
) -> RemoteContentSuspicionSummary | None:
    apply_remote_content_suspicion_labels(evidence)
    flagged_sources = tuple(
        source for source in evidence.sources if source.remote_content_suspicion_labels
    )
    if not flagged_sources and not generation_blocked:
        return None
    flag_labels = _normalize_suspicion_labels(
        label for source in flagged_sources for label in source.remote_content_suspicion_labels
    )
    return RemoteContentSuspicionSummary(
        flagged_source_count=len(flagged_sources),
        flag_labels=flag_labels,
        generation_blocked=generation_blocked,
    )


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def _normalize_suspicion_labels(labels: object) -> tuple[str, ...]:
    if not isinstance(labels, tuple | list):
        labels = tuple(labels) if labels else ()
    unique_labels = {str(label) for label in labels if isinstance(label, str) and label.strip()}
    return tuple(
        sorted(
            unique_labels,
            key=lambda label: _REMOTE_CONTENT_LABEL_ORDER.get(label, 99),
        )
    )


__all__ = [
    "ProviderSupportSuspicionAssessment",
    "apply_remote_content_suspicion_labels",
    "assess_provider_grounding_support_suspicion",
    "build_remote_content_safe_summary",
    "build_remote_content_suspicion_summary",
    "detect_remote_content_suspicion_labels",
    "ensure_remote_content_suspicion_labels",
    "is_remote_content_source",
    "sanitize_prompt_visible_text",
    "should_block_remote_content_generation",
]
