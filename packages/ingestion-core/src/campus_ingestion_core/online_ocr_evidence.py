from __future__ import annotations

from io import BytesIO
import hashlib
import json
from pathlib import Path
import re
from typing import Any
import zipfile

from campus_ingestion_core.file_asset_routing import MINERU_PROVIDER


def extract_online_ocr_text(result_payload: dict[str, object]) -> str:
    layout_results = result_payload.get("layoutParsingResults")
    if not isinstance(layout_results, list):
        return ""
    texts: list[str] = []
    for item in layout_results:
        if not isinstance(item, dict):
            continue
        markdown = item.get("markdown")
        if not isinstance(markdown, dict):
            continue
        text = markdown.get("text")
        if isinstance(text, str) and text.strip():
            texts.append(text.strip())
    return "\n\n".join(texts)


def extract_provider_plain_text(*, provider: str, provider_response_bytes: bytes) -> str:
    if provider == MINERU_PROVIDER:
        return _extract_mineru_archive_text(provider_response_bytes)
    return extract_paddle_plain_text(provider_response_bytes)


def extract_paddle_plain_text(provider_response_bytes: bytes) -> str:
    texts: list[str] = []
    for line in provider_response_bytes.decode("utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, dict):
            continue
        result_payload = payload.get("result") if isinstance(payload.get("result"), dict) else payload
        if not isinstance(result_payload, dict):
            continue
        text = extract_online_ocr_text(result_payload)
        if text.strip():
            texts.append(text.strip())
    return "\n\n".join(texts)


def build_provider_summary(
    *,
    provider: str,
    model: str,
    text: str,
    provider_response_available: bool,
    error: str | None,
    error_type: str | None,
    provider_metadata: dict[str, object] | None = None,
) -> dict[str, object]:
    summary = _build_text_summary(provider=provider, model=model, text=text)
    usable_output = provider_response_available and error is None and bool(text.strip())
    empty_output = provider_response_available and error is None and not bool(text.strip())
    status = "unavailable"
    if error is not None:
        status = "failed"
    elif usable_output:
        status = "success"
    elif empty_output:
        status = "empty_output"
    summary.update(
        {
            "available": provider_response_available,
            "provider_response_available": provider_response_available,
            "usable_output": usable_output,
            "empty_output": empty_output,
            "status": status,
            "structure_signals": build_structure_signals(text),
        }
    )
    if error is not None:
        summary["error"] = error
    if error_type is not None:
        summary["error_type"] = error_type
    if provider_metadata:
        summary["provider_metadata"] = provider_metadata
    return summary


def build_structure_signals(text: str) -> dict[str, object]:
    normalized = text.strip()
    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    html_tag_count = len(re.findall(r"</?[a-zA-Z][^>]*>", normalized))
    table_row_count = len(re.findall(r"<tr\b", normalized, flags=re.IGNORECASE))
    table_row_count += sum(1 for line in lines if _looks_like_markdown_table_row(line))
    image_reference_count = len(re.findall(r"!\[[^\]]*\]\([^)]+\)", normalized))
    return {
        "nonempty_line_count": len(lines),
        "markdown_heading_count": sum(1 for line in lines if line.lstrip().startswith("#")),
        "table_row_count": table_row_count,
        "html_tag_count": html_tag_count,
        "html_tag_density": round(html_tag_count / max(len(normalized), 1), 4),
        "image_reference_count": image_reference_count,
    }


def build_adjudication(
    *,
    candidate_summary: dict[str, object],
    baseline_summary: dict[str, object],
) -> dict[str, Any]:
    candidate_usable = bool(candidate_summary["usable_output"])
    baseline_usable = bool(baseline_summary["usable_output"])

    if candidate_usable and not baseline_usable:
        return _winner_payload(
            winner="candidate",
            provider=str(candidate_summary["provider"]),
            reason_codes=[_unusable_reason("baseline", baseline_summary)],
            manual_review_required=False,
        )
    if baseline_usable and not candidate_usable:
        return _winner_payload(
            winner="baseline",
            provider=str(baseline_summary["provider"]),
            reason_codes=[_unusable_reason("candidate", candidate_summary)],
            manual_review_required=False,
        )
    if not candidate_usable and not baseline_usable:
        return _winner_payload(
            winner="none",
            provider=None,
            reason_codes=[
                _unusable_reason("candidate", candidate_summary),
                _unusable_reason("baseline", baseline_summary),
            ],
            manual_review_required=True,
        )
    if candidate_summary["plain_text_sha256"] == baseline_summary["plain_text_sha256"]:
        return _winner_payload(
            winner="tie",
            provider=None,
            reason_codes=["equivalent_plain_text"],
            manual_review_required=False,
        )

    reason_codes = ["length_delta_not_decisive"]
    if _has_markup_inflation(noisy_summary=baseline_summary, cleaner_summary=candidate_summary):
        reason_codes.append("baseline_markup_inflation_detected")
    if _has_markup_inflation(noisy_summary=candidate_summary, cleaner_summary=baseline_summary):
        reason_codes.append("candidate_markup_inflation_detected")
    if _has_clear_structure_advantage(preferred_summary=candidate_summary, other_summary=baseline_summary):
        reason_codes.append("candidate_structure_advantage")
        return _winner_payload(
            winner="candidate",
            provider=str(candidate_summary["provider"]),
            reason_codes=reason_codes,
            manual_review_required=False,
        )
    if _has_clear_structure_advantage(preferred_summary=baseline_summary, other_summary=candidate_summary):
        reason_codes.append("baseline_structure_advantage")
        return _winner_payload(
            winner="baseline",
            provider=str(baseline_summary["provider"]),
            reason_codes=reason_codes,
            manual_review_required=False,
        )

    reason_codes.append("no_clear_winner")
    return _winner_payload(
        winner="manual_review",
        provider=None,
        reason_codes=reason_codes,
        manual_review_required=True,
    )


def _extract_mineru_archive_text(archive_bytes: bytes) -> str:
    with zipfile.ZipFile(BytesIO(archive_bytes)) as archive:
        markdown_names = [
            member
            for member in archive.namelist()
            if Path(member).name == "full.md" or member.endswith(".md")
        ]
        if not markdown_names:
            return ""
        return archive.read(markdown_names[0]).decode("utf-8")


def _build_text_summary(*, provider: str, model: str, text: str) -> dict[str, object]:
    normalized_text = text.strip()
    return {
        "provider": provider,
        "model": model,
        "plain_text_length": len(normalized_text),
        "plain_text_sha256": hashlib.sha256(normalized_text.encode("utf-8")).hexdigest(),
        "plain_text_preview": _build_preview_text(normalized_text),
    }


def _build_preview_text(text: str, *, limit: int = 120) -> str:
    normalized = re.sub(r"[#*_`>\-\[\]\(\)]", " ", text)
    collapsed = " ".join(normalized.split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 1].rstrip() + "…"


def _looks_like_markdown_table_row(line: str) -> bool:
    stripped = line.strip()
    return stripped.count("|") >= 2 and stripped.startswith("|") and stripped.endswith("|")


def _unusable_reason(side: str, summary: dict[str, object]) -> str:
    status = str(summary["status"])
    if status == "failed":
        return f"{side}_provider_failure"
    if status == "empty_output":
        return f"{side}_empty_output"
    return f"{side}_unavailable"


def _winner_payload(
    *,
    winner: str,
    provider: str | None,
    reason_codes: list[str],
    manual_review_required: bool,
) -> dict[str, Any]:
    return {
        "winner": winner,
        "winner_provider": provider,
        "reason_codes": reason_codes,
        "manual_review_required": manual_review_required,
    }


def _has_markup_inflation(
    *,
    noisy_summary: dict[str, object],
    cleaner_summary: dict[str, object],
) -> bool:
    noisy_signals = noisy_summary["structure_signals"]
    cleaner_signals = cleaner_summary["structure_signals"]
    if not isinstance(noisy_signals, dict) or not isinstance(cleaner_signals, dict):
        return False
    noisy_tag_count = int(noisy_signals["html_tag_count"])
    cleaner_tag_count = int(cleaner_signals["html_tag_count"])
    noisy_density = float(noisy_signals["html_tag_density"])
    cleaner_density = float(cleaner_signals["html_tag_density"])
    noisy_length = int(noisy_summary["plain_text_length"])
    cleaner_length = int(cleaner_summary["plain_text_length"])
    return (
        noisy_tag_count >= 8
        and noisy_tag_count >= cleaner_tag_count + 8
        and noisy_density >= cleaner_density + 0.03
        and noisy_length > cleaner_length
    )


def _has_clear_structure_advantage(
    *,
    preferred_summary: dict[str, object],
    other_summary: dict[str, object],
) -> bool:
    preferred_signals = preferred_summary["structure_signals"]
    other_signals = other_summary["structure_signals"]
    if not isinstance(preferred_signals, dict) or not isinstance(other_signals, dict):
        return False
    preferred_rows = int(preferred_signals["table_row_count"])
    other_rows = int(other_signals["table_row_count"])
    preferred_lines = int(preferred_signals["nonempty_line_count"])
    other_lines = int(other_signals["nonempty_line_count"])
    preferred_length = int(preferred_summary["plain_text_length"])
    other_length = int(other_summary["plain_text_length"])
    return (
        preferred_rows >= 3
        and preferred_rows >= other_rows + 2
        and preferred_lines >= other_lines
        and preferred_length >= max(other_length, 1)
    )


__all__ = [
    "build_adjudication",
    "build_provider_summary",
    "build_structure_signals",
    "extract_online_ocr_text",
    "extract_paddle_plain_text",
    "extract_provider_plain_text",
]
