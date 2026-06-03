from __future__ import annotations

from pathlib import Path

from campus_ingestion_core.authenticated_notice_source_projections_shared import (
    ONLINE_OCR_PROVIDER_ASYNC_JOBS,
    AuthenticatedNoticeOcrProviderRuntime,
    AuthenticatedNoticeOcrRuntime,
    _normalize_authenticated_notice_ocr_provider_payload,
)
from campus_ingestion_core.raw_ingestion import (
    ONLINE_OCR_PROVIDER_MINERU_API,
    OnlineOcrClient,
    OnlineOcrSettings,
    build_online_ocr_client,
    parse_online_ocr_bytes,
)


def _resolve_authenticated_notice_ocr_runtime(
    *,
    env: dict[str, str] | None,
    runtime_profile=None,
    ocr_client: OnlineOcrClient | None,
    ocr_clients: dict[str, OnlineOcrClient] | None = None,
) -> AuthenticatedNoticeOcrRuntime:
    source = env if env is not None else {}
    active_settings = OnlineOcrSettings.from_env(source, required=False)
    mineru_settings = OnlineOcrSettings.from_env(
        source,
        prefix="OCR_MINERU_",
        default_provider=ONLINE_OCR_PROVIDER_MINERU_API,
    )
    settings_by_provider: dict[str, OnlineOcrSettings] = {}
    if active_settings is not None:
        settings_by_provider[active_settings.provider] = active_settings
    if mineru_settings is not None:
        settings_by_provider[mineru_settings.provider] = mineru_settings

    explicit_clients = dict(ocr_clients or {})
    single_client_provider = (
        active_settings.provider if active_settings is not None else ONLINE_OCR_PROVIDER_ASYNC_JOBS
    )
    if ocr_client is not None and single_client_provider not in explicit_clients:
        explicit_clients[single_client_provider] = ocr_client

    available_providers = set(settings_by_provider) | set(explicit_clients)
    if not available_providers:
        OnlineOcrSettings.from_env(source, required=True)
        raise ValueError("OCR_BASE_URL and OCR_API_KEY must be configured together")

    preferred_provider = str(getattr(runtime_profile, "source_ocr_provider", "") or "").strip()
    active_provider = (
        active_settings.provider if active_settings is not None else single_client_provider
    )
    primary_provider = (
        preferred_provider if preferred_provider in available_providers else active_provider
    )
    if primary_provider not in available_providers:
        primary_provider = sorted(available_providers)[0]

    primary_runtime = _build_authenticated_notice_ocr_provider_runtime(
        provider=primary_provider,
        settings_by_provider=settings_by_provider,
        explicit_clients=explicit_clients,
    )
    return AuthenticatedNoticeOcrRuntime(
        client=primary_runtime.client,
        provider=primary_runtime.provider,
    )


def _build_authenticated_notice_ocr_provider_runtime(
    *,
    provider: str,
    settings_by_provider: dict[str, OnlineOcrSettings],
    explicit_clients: dict[str, OnlineOcrClient],
) -> AuthenticatedNoticeOcrProviderRuntime:
    client = explicit_clients.get(provider)
    if client is not None:
        return AuthenticatedNoticeOcrProviderRuntime(client=client, provider=provider)
    settings = settings_by_provider.get(provider)
    if settings is None:
        raise ValueError(f"{provider} OCR settings are not configured")
    return AuthenticatedNoticeOcrProviderRuntime(
        client=build_online_ocr_client(settings),
        provider=provider,
    )


def _parse_attachment_with_ocr_runtimes(
    *,
    ocr_runtime: AuthenticatedNoticeOcrRuntime,
    file_bytes: bytes | None,
    file_path: Path | None,
    filename: str,
    media_type: str | None,
    error_prefix: str,
) -> bytes:
    errors: list[str] = []
    try:
        if file_path is not None:
            provider_result = ocr_runtime.client.parse_file(file_path)
        else:
            if file_bytes is None:
                raise ValueError("file bytes are required when file path is unavailable")
            provider_result = parse_online_ocr_bytes(
                ocr_client=ocr_runtime.client,
                file_bytes=file_bytes,
                filename=filename,
                media_type=media_type,
            )
        return _normalize_authenticated_notice_ocr_provider_payload(
            provider_response_bytes=provider_result.provider_result_bytes,
            provider=ocr_runtime.provider,
        )
    except Exception as exc:
        errors.append(str(exc))
    raise RuntimeError(f"{error_prefix}: {' | '.join(errors)}")
