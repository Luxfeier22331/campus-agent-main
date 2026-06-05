from __future__ import annotations


def resolve_mineru_api_root(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    suffixes = (
        "/api/v4/file-urls/batch",
        "/api/v4/extract-results/batch",
        "/api/v4/extract/task",
        "/api/v4",
        "/api",
    )
    lower_normalized = normalized.lower()
    for suffix in suffixes:
        if lower_normalized.endswith(suffix):
            return normalized[: -len(suffix)] + "/api/v4"
    return f"{normalized}/api/v4"


def resolve_mineru_file_upload_url(base_url: str) -> str:
    return f"{resolve_mineru_api_root(base_url)}/file-urls/batch"


def resolve_mineru_extract_results_url(base_url: str, *, batch_id: str) -> str:
    return f"{resolve_mineru_api_root(base_url)}/extract-results/batch/{batch_id}"


def require_mineru_success_payload(
    *,
    response_payload: object,
    action: str,
) -> dict[str, object]:
    if not isinstance(response_payload, dict):
        raise RuntimeError(f"MinerU response must be a JSON object while trying to {action}")
    code = response_payload.get("code")
    if code not in {0, "0", None}:
        raise RuntimeError(
            f"MinerU API failed to {action}: code={code}, msg={response_payload.get('msg')}"
        )
    payload = response_payload.get("data")
    if not isinstance(payload, dict):
        raise RuntimeError(f"MinerU response is missing data while trying to {action}")
    return payload
