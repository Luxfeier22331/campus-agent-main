from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from typing import Any, Literal, Protocol
from urllib.parse import urlparse

import httpx

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import build_document_artifact_key
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    normalize_postgres_connection_url,
)
from campus_ingestion_core.registry import (
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    _coerce_json_payload,
    _ensure_table_schema,
    _postgres_connection,
    _qualified_table_sql,
    _table_index_suffix,
)

WECHAT_PUBLIC_NOTICE_MULTIMODAL_FETCH_MANIFEST_SCHEMA = "wechat_public_notice_inline_image_fetch.v1"
WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA = "wechat_public_notice_inline_image_ocr.v1"
WECHAT_PUBLIC_NOTICE_MULTIMODAL_IMPORT_SOURCE = "wechat_public_notice_inline_image_ocr"
WECHAT_PUBLIC_NOTICE_MULTIMODAL_PARSER_VERSION = "wechat_public_notice_inline_image_ocr.v1"
DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_BASE_URL = "https://api.openai.com/v1"
DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS = 2200
DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_TIMEOUT_SECONDS = 90.0
DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY = (
    "WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_DATABASE_URL"
)
DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_MANAGEMENT_ENV_KEY = (
    "WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_MANAGEMENT_DATABASE_URL"
)
DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY = (
    "WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_DATABASE_URL"
)
DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_TABLE = (
    "ingestion_projection.wechat_public_notice_multimodal_attempt"
)
_IMAGE_CONTENT_TYPE_RE = re.compile(r"^image/[a-z0-9.+-]+$", re.IGNORECASE)

WeChatPublicNoticeImageStatus = Literal[
    "pending",
    "admitted",
    "no_extractable_text",
    "fetch_failed",
    "ocr_failed",
]
WeChatPublicNoticeMultimodalConfidence = Literal["high", "medium", "low"]


class WeChatPublicNoticeMultimodalObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


class WeChatPublicNoticeDocumentRegistry(Protocol):
    def list_versions(
        self,
        document_id: str,
        revision_track: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]: ...

    def upsert_many(self, records: tuple[DocumentRegistryRecord, ...]) -> None: ...


class WeChatPublicNoticeMultimodalAttemptStore(Protocol):
    def record(self, attempt: WeChatPublicNoticeMultimodalAttempt) -> None: ...

    def list_by_image(
        self,
        *,
        source_notice_id: str,
        media_ref_id: str,
    ) -> tuple[WeChatPublicNoticeMultimodalAttempt, ...]: ...


class WeChatPublicNoticeInlineImageFetcher(Protocol):
    def fetch(
        self,
        request: WeChatPublicNoticeInlineImageFetchRequest,
    ) -> WeChatPublicNoticeFetchedInlineImage: ...


class WeChatPublicNoticeMultimodalProvider(Protocol):
    def process(
        self,
        request: WeChatPublicNoticeMultimodalProviderRequest,
    ) -> WeChatPublicNoticeMultimodalProviderResult: ...


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeInlineImageRef:
    media_ref_id: str
    ref_order: int
    source_url: str
    normalized_source_url: str
    capture_status: str = ""
    final_url: str = ""
    object_key: str = ""
    content_sha256: str = ""
    mime_type: str = ""
    byte_size: int = 0
    captured_at: str = ""
    fetch_error_message: str = ""


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeInlineImageArtifactKeys:
    base_prefix: str
    fetch_manifest_key: str
    ocr_manifest_key: str


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeInlineImageOutcome:
    media_ref_id: str
    source_url: str
    normalized_source_url: str
    status: WeChatPublicNoticeImageStatus
    fetch_manifest_key: str
    ocr_manifest_key: str
    image_object_key: str = ""
    summary: str = ""
    extracted_text: str = ""
    confidence: str = ""
    provider: str = ""
    model: str = ""
    provider_response_key: str = ""
    layout_elements_key: str = ""
    child_document_id: str = ""
    child_canonical_markdown_key: str = ""
    child_document_units_key: str = ""
    error: str = ""


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeInlineImageFetchRequest:
    source_notice_id: str
    notice_title: str
    article_source_url: str
    media_ref_id: str
    image_url: str


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeFetchedInlineImage:
    content_type: str
    image_bytes: bytes
    final_url: str


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeMultimodalProviderRequest:
    source_notice_id: str
    notice_title: str
    article_source_url: str
    publish_time: str
    media_ref_id: str
    image_url: str
    image_bytes: bytes


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeMultimodalProviderResult:
    provider: str
    model: str
    confidence: WeChatPublicNoticeMultimodalConfidence
    has_meaningful_text: bool
    summary: str
    extracted_text: str
    layout_elements: tuple[Mapping[str, Any], ...] = ()
    raw_response: Mapping[str, Any] | Sequence[Any] | str | None = None


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeMultimodalAttempt:
    source_corpus: str
    source_collection: str
    source_notice_id: str
    unit_id: str
    media_ref_id: str
    attempt_number: int
    admission_batch_id: str
    status: str
    provider: str
    model: str
    fetch_manifest_key: str
    ocr_manifest_key: str
    provider_response_key: str
    layout_elements_key: str
    error: str = ""
    created_at: str = ""


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeMultimodalItemReport:
    source_notice_id: str
    media_ref_id: str
    status: str
    attempt_number: int
    reason: str = ""


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeMultimodalProcessingReport:
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    pending_notice_ids: tuple[str, ...]
    projection_entry_count: int
    pending_entry_count: int
    scanned_image_count: int
    attempted_image_count: int
    admitted_count: int
    no_extractable_text_count: int
    terminal_failure_count: int
    still_pending_count: int
    item_reports: tuple[WeChatPublicNoticeMultimodalItemReport, ...]


class InMemoryWeChatPublicNoticeMultimodalAttemptStore:
    def __init__(
        self,
        records: Sequence[WeChatPublicNoticeMultimodalAttempt] = (),
    ) -> None:
        self._records = list(records)

    def record(self, attempt: WeChatPublicNoticeMultimodalAttempt) -> None:
        self._records.append(attempt)

    def list_by_image(
        self,
        *,
        source_notice_id: str,
        media_ref_id: str,
    ) -> tuple[WeChatPublicNoticeMultimodalAttempt, ...]:
        return tuple(
            item
            for item in self._records
            if item.source_notice_id == source_notice_id and item.media_ref_id == media_ref_id
        )


class PostgresWeChatPublicNoticeMultimodalAttemptStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("wechat public notice multimodal attempt database url is required")
        self.table_name = table_name
        self._ensure_schema()

    def record(self, attempt: WeChatPublicNoticeMultimodalAttempt) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                insert into {table_sql} (
                    source_corpus,
                    source_collection,
                    source_notice_id,
                    unit_id,
                    media_ref_id,
                    attempt_number,
                    admission_batch_id,
                    status,
                    provider,
                    model,
                    fetch_manifest_key,
                    ocr_manifest_key,
                    provider_response_key,
                    layout_elements_key,
                    error,
                    created_at,
                    record
                )
                values (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s::jsonb
                )
                on conflict (
                    source_corpus,
                    source_collection,
                    source_notice_id,
                    media_ref_id,
                    attempt_number
                )
                do update set
                    unit_id = excluded.unit_id,
                    admission_batch_id = excluded.admission_batch_id,
                    status = excluded.status,
                    provider = excluded.provider,
                    model = excluded.model,
                    fetch_manifest_key = excluded.fetch_manifest_key,
                    ocr_manifest_key = excluded.ocr_manifest_key,
                    provider_response_key = excluded.provider_response_key,
                    layout_elements_key = excluded.layout_elements_key,
                    error = excluded.error,
                    created_at = excluded.created_at,
                    record = excluded.record
                """,
                (
                    attempt.source_corpus,
                    attempt.source_collection,
                    attempt.source_notice_id,
                    attempt.unit_id,
                    attempt.media_ref_id,
                    attempt.attempt_number,
                    attempt.admission_batch_id,
                    attempt.status,
                    attempt.provider,
                    attempt.model,
                    attempt.fetch_manifest_key,
                    attempt.ocr_manifest_key,
                    attempt.provider_response_key,
                    attempt.layout_elements_key,
                    attempt.error,
                    attempt.created_at,
                    json.dumps(asdict(attempt), ensure_ascii=False),
                ),
            )

    def list_by_image(
        self,
        *,
        source_notice_id: str,
        media_ref_id: str,
    ) -> tuple[WeChatPublicNoticeMultimodalAttempt, ...]:
        table_sql = _qualified_table_sql(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                select record from {table_sql}
                where source_notice_id = %s
                  and media_ref_id = %s
                order by attempt_number asc
                """,
                (source_notice_id, media_ref_id),
            )
            rows = cursor.fetchall()
        attempts: list[WeChatPublicNoticeMultimodalAttempt] = []
        for row in rows:
            payload = _coerce_json_payload(row[0])
            payload["attempt_number"] = int(payload.get("attempt_number") or 1)
            attempts.append(WeChatPublicNoticeMultimodalAttempt(**payload))
        return tuple(attempts)

    def _ensure_schema(self) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        suffix = _table_index_suffix(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            _ensure_table_schema(cursor, table_name=self.table_name)
            cursor.execute(
                f"""
                create table if not exists {table_sql} (
                    source_corpus text not null,
                    source_collection text not null,
                    source_notice_id text not null,
                    unit_id text not null,
                    media_ref_id text not null,
                    attempt_number integer not null,
                    admission_batch_id text not null default '',
                    status text not null,
                    provider text not null default '',
                    model text not null default '',
                    fetch_manifest_key text not null default '',
                    ocr_manifest_key text not null default '',
                    provider_response_key text not null default '',
                    layout_elements_key text not null default '',
                    error text not null default '',
                    created_at timestamptz not null,
                    record jsonb not null,
                    primary key (
                        source_corpus,
                        source_collection,
                        source_notice_id,
                        media_ref_id,
                        attempt_number
                    )
                )
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_notice
                on {table_sql} (source_corpus, source_collection, source_notice_id)
                """
            )


class HttpxWeChatPublicNoticeInlineImageFetcher:
    def __init__(
        self,
        *,
        http_client: httpx.Client | None = None,
        timeout_seconds: float = DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_TIMEOUT_SECONDS,
    ) -> None:
        self._http_client = http_client or httpx.Client(
            timeout=httpx.Timeout(
                connect=10.0,
                read=timeout_seconds,
                write=10.0,
                pool=5.0,
            ),
            follow_redirects=True,
            trust_env=False,
        )

    def fetch(
        self,
        request: WeChatPublicNoticeInlineImageFetchRequest,
    ) -> WeChatPublicNoticeFetchedInlineImage:
        response = self._http_client.get(
            request.image_url,
            headers={
                "accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
                "referer": request.article_source_url,
                "user-agent": (
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/136.0 Safari/537.36"
                ),
            },
        )
        response.raise_for_status()
        content_type = str(response.headers.get("content-type") or "").split(";", 1)[0].strip()
        if not _IMAGE_CONTENT_TYPE_RE.match(content_type):
            raise ValueError(
                f"{request.media_ref_id} expected image content-type, got {content_type or 'unknown'}"
            )
        return WeChatPublicNoticeFetchedInlineImage(
            content_type=content_type,
            image_bytes=response.content,
            final_url=str(response.url),
        )


class ChatCompletionsWeChatPublicNoticeMultimodalProvider:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        provider: str = "openai-chat-completions",
        base_url: str = DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_BASE_URL,
        max_output_tokens: int = DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS,
        http_client: httpx.Client | None = None,
    ) -> None:
        if not api_key.strip():
            raise ValueError("wechat public notice multimodal api_key must not be empty")
        if not model.strip():
            raise ValueError("wechat public notice multimodal model must not be empty")
        if max_output_tokens <= 0:
            raise ValueError("wechat public notice multimodal max_output_tokens must be > 0")
        self._api_key = api_key.strip()
        self._model = model.strip()
        self._provider = provider.strip() or "openai-chat-completions"
        self._max_output_tokens = max_output_tokens
        self._http_client = http_client or httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(connect=10.0, read=90.0, write=10.0, pool=5.0),
            trust_env=False,
        )

    @classmethod
    def from_env(
        cls,
        env: Mapping[str, str] | None = None,
    ) -> ChatCompletionsWeChatPublicNoticeMultimodalProvider:
        source = env if env is not None else os.environ
        api_key = (
            source.get("WECHAT_PUBLIC_NOTICE_MULTIMODAL_API_KEY")
            or source.get("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_API_KEY")
            or source.get("PROMPT_RUNTIME_API_KEY")
            or source.get("LLM_API_KEY")
            or ""
        ).strip()
        model = (
            source.get("WECHAT_PUBLIC_NOTICE_MULTIMODAL_MODEL")
            or source.get("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_MODEL")
            or source.get("PROMPT_RUNTIME_MODEL")
            or ""
        ).strip()
        provider = (
            source.get("WECHAT_PUBLIC_NOTICE_MULTIMODAL_PROVIDER")
            or source.get("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_PROVIDER")
            or "openai-chat-completions"
        ).strip()
        base_url = (
            source.get("WECHAT_PUBLIC_NOTICE_MULTIMODAL_BASE_URL")
            or source.get("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_BASE_URL")
            or source.get("PROMPT_RUNTIME_BASE_URL")
            or source.get("LLM_BASE_URL")
            or DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_BASE_URL
        ).strip()
        max_output_tokens = int(
            (
                source.get("WECHAT_PUBLIC_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS")
                or source.get("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_MAX_OUTPUT_TOKENS")
                or source.get("PROMPT_RUNTIME_MAX_OUTPUT_TOKENS")
                or str(DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS)
            ).strip()
        )
        if not api_key:
            raise ValueError(
                "WECHAT_PUBLIC_NOTICE_MULTIMODAL_API_KEY or "
                "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_API_KEY or PROMPT_RUNTIME_API_KEY "
                "or LLM_API_KEY is required"
            )
        if not model:
            raise ValueError(
                "WECHAT_PUBLIC_NOTICE_MULTIMODAL_MODEL or "
                "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_MODEL or PROMPT_RUNTIME_MODEL is required"
            )
        return cls(
            api_key=api_key,
            model=model,
            provider=provider,
            base_url=base_url,
            max_output_tokens=max_output_tokens,
        )

    def process(
        self,
        request: WeChatPublicNoticeMultimodalProviderRequest,
    ) -> WeChatPublicNoticeMultimodalProviderResult:
        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Read the campus notice image carefully. Extract only visible text and "
                        "table-like facts. Do not invent unreadable text. Return strict JSON with "
                        "a short summary, extracted_text preserving visible wording, whether the "
                        "image has meaningful textual facts, a confidence label, and layout blocks."
                    ),
                },
                {
                    "role": "user",
                    "content": _build_chat_user_content(request),
                },
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "wechat_public_notice_inline_image_ocr",
                    "schema": _wechat_multimodal_schema(),
                    "strict": True,
                },
            },
            "max_completion_tokens": self._max_output_tokens,
        }
        response = self._http_client.post(
            "/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()
        response_json = response.json()
        parsed = _extract_chat_completions_payload(response_json)
        confidence = _coerce_confidence(parsed.get("confidence"))
        layout_elements = _coerce_layout_elements(parsed.get("layout_elements"))
        return WeChatPublicNoticeMultimodalProviderResult(
            provider=self._provider,
            model=self._model,
            confidence=confidence,
            has_meaningful_text=bool(parsed.get("has_meaningful_text")),
            summary=str(parsed.get("summary") or "").strip(),
            extracted_text=str(parsed.get("extracted_text") or "").strip(),
            layout_elements=layout_elements,
            raw_response=response_json if isinstance(response_json, dict) else parsed,
        )


def build_wechat_public_notice_multimodal_attempt_store_from_env(
    env: Mapping[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresWeChatPublicNoticeMultimodalAttemptStore:
    source = dict(env if env is not None else os.environ)
    if prefer_operator:
        operator_database_url = (
            source.get(DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY)
            or source.get(DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_MANAGEMENT_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_OPERATOR_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY)
            or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
            or source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY)
            or ""
        ).strip()
        if not operator_database_url:
            raise ValueError(
                f"{DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY} or "
                f"{DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_MANAGEMENT_ENV_KEY} or "
                f"{DOCUMENT_REGISTRY_OPERATOR_ENV_KEY} or {DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY} "
                f"or {SHARED_POSTGRES_OPERATOR_ENV_KEY} or {SHARED_POSTGRES_MANAGEMENT_ENV_KEY} "
                "is required when prefer_operator=True"
            )
        return PostgresWeChatPublicNoticeMultimodalAttemptStore(
            build_operator_postgres_connection_url(operator_database_url)
        )
    database_url = (
        source.get(DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY)
        or source.get(DOCUMENT_REGISTRY_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY} or "
            f"{DOCUMENT_REGISTRY_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} is required"
        )
    return PostgresWeChatPublicNoticeMultimodalAttemptStore(database_url=database_url)


def select_wechat_public_notice_pending_multimodal_notice_ids(
    *,
    projection_store,
    source_corpus: str,
    source_collection: str,
    limit: int,
) -> tuple[str, ...]:
    if limit <= 0:
        raise ValueError("limit must be greater than zero")
    entries = projection_store.list_by_scope(source_corpus, source_collection)
    pending_notice_ids: list[str] = []
    seen: set[str] = set()
    for entry in entries:
        if not _is_pending_multimodal_entry(entry):
            continue
        notice_id = str(entry.source_notice_id or "").strip()
        if not notice_id or notice_id in seen:
            continue
        seen.add(notice_id)
        pending_notice_ids.append(notice_id)
        if len(pending_notice_ids) >= limit:
            break
    return tuple(pending_notice_ids)


def process_wechat_public_notice_pending_multimodal_entries(
    *,
    source_corpus: str,
    source_collection: str,
    notice_ids: Sequence[str],
    projection_store,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    registry: WeChatPublicNoticeDocumentRegistry,
    source_bucket: str,
    derived_bucket: str,
    image_fetcher: WeChatPublicNoticeInlineImageFetcher,
    provider: WeChatPublicNoticeMultimodalProvider,
    attempt_store: WeChatPublicNoticeMultimodalAttemptStore | None = None,
    max_attempts: int = 3,
    admission_batch_id: str = "",
) -> WeChatPublicNoticeMultimodalProcessingReport:
    normalized_notice_ids = tuple(
        sorted({str(item).strip() for item in notice_ids if str(item).strip()})
    )
    if not normalized_notice_ids:
        raise ValueError("selected notice_ids are required for wechat multimodal processing")
    if max_attempts <= 0:
        raise ValueError("max_attempts must be greater than zero")
    entries = projection_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
    )
    pending_entries = tuple(entry for entry in entries if _is_pending_multimodal_entry(entry))
    item_reports: list[WeChatPublicNoticeMultimodalItemReport] = []
    scanned_image_count = 0
    attempted_image_count = 0
    admitted_count = 0
    no_extractable_text_count = 0
    terminal_failure_count = 0
    still_pending_count = 0
    for entry in pending_entries:
        metadata = dict(entry.role_metadata or {})
        source_truth_bucket = str(metadata.get("source_bucket") or source_bucket).strip()
        if not source_truth_bucket:
            raise ValueError("source bucket is required for wechat multimodal processing")
        media_refs_key = _required_text(metadata.get("media_refs_key"), label="media_refs_key")
        media_rows = _load_media_rows(
            object_store.get_bytes(bucket=source_truth_bucket, key=media_refs_key)
        )
        inline_refs = list_wechat_public_notice_inline_image_refs(media_rows)
        scanned_image_count += len(inline_refs)
        for inline_ref in inline_refs:
            outcome = load_wechat_public_notice_inline_image_outcome(
                object_store=object_store,
                bucket=source_truth_bucket,
                media_refs_key=media_refs_key,
                inline_ref=inline_ref,
            )
            if outcome.status in {"admitted", "no_extractable_text", "fetch_failed", "ocr_failed"}:
                item_reports.append(
                    WeChatPublicNoticeMultimodalItemReport(
                        source_notice_id=entry.source_notice_id,
                        media_ref_id=inline_ref.media_ref_id,
                        status=outcome.status,
                        attempt_number=len(
                            attempt_store.list_by_image(
                                source_notice_id=entry.source_notice_id,
                                media_ref_id=inline_ref.media_ref_id,
                            )
                        )
                        if attempt_store is not None
                        else 0,
                        reason="existing_terminal_outcome",
                    )
                )
                if outcome.status == "admitted":
                    admitted_count += 1
                elif outcome.status == "no_extractable_text":
                    no_extractable_text_count += 1
                else:
                    terminal_failure_count += 1
                continue

            attempt_number = _next_attempt_number(
                attempt_store=attempt_store,
                source_notice_id=entry.source_notice_id,
                media_ref_id=inline_ref.media_ref_id,
            )
            attempted_image_count += 1
            try:
                fetched = _load_inline_image_object(
                    object_store=object_store,
                    bucket=source_truth_bucket,
                    inline_ref=inline_ref,
                )
            except Exception as exc:
                terminal = attempt_number >= max_attempts
                if terminal:
                    write_wechat_public_notice_inline_image_ocr_manifest(
                        object_store=object_store,
                        bucket=source_truth_bucket,
                        media_refs_key=media_refs_key,
                        inline_ref=inline_ref,
                        payload={
                            "schema_version": WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
                            "source_notice_id": entry.source_notice_id,
                            "source_collection": entry.source_collection,
                            "media_ref_id": inline_ref.media_ref_id,
                            "status": "fetch_failed",
                            "provider": "",
                            "model": "",
                            "confidence": "",
                            "summary": "",
                            "extracted_text": "",
                            "provider_response_key": "",
                            "layout_elements_key": "",
                            "child_document_id": "",
                            "child_canonical_markdown_key": "",
                            "child_document_units_key": "",
                            "processed_at": utc_now(),
                            "image_object_key": inline_ref.object_key,
                            "error": str(exc),
                        },
                    )
                    terminal_failure_count += 1
                else:
                    still_pending_count += 1
                _record_attempt(
                    attempt_store=attempt_store,
                    entry=entry,
                    media_ref_id=inline_ref.media_ref_id,
                    attempt_number=attempt_number,
                    admission_batch_id=admission_batch_id,
                    status="fetch_failed",
                    provider="",
                    model="",
                    fetch_manifest_key="",
                    ocr_manifest_key=build_wechat_public_notice_inline_image_artifact_keys(
                        media_refs_key=media_refs_key,
                        media_ref_id=inline_ref.media_ref_id,
                    ).ocr_manifest_key,
                    provider_response_key="",
                    layout_elements_key="",
                    error=str(exc),
                )
                item_reports.append(
                    WeChatPublicNoticeMultimodalItemReport(
                        source_notice_id=entry.source_notice_id,
                        media_ref_id=inline_ref.media_ref_id,
                        status="fetch_failed" if terminal else "pending",
                        attempt_number=attempt_number,
                        reason=str(exc),
                    )
                )
                continue

            provider_response_key = ""
            layout_elements_key = ""
            try:
                result = provider.process(
                    WeChatPublicNoticeMultimodalProviderRequest(
                        source_notice_id=entry.source_notice_id,
                        notice_title=_resolve_notice_title(entry),
                        article_source_url=str(metadata.get("source_url") or ""),
                        publish_time=str(metadata.get("publish_time") or ""),
                        media_ref_id=inline_ref.media_ref_id,
                        image_url=inline_ref.normalized_source_url or inline_ref.source_url,
                        image_bytes=fetched.image_bytes,
                    )
                )
                status = _classify_provider_result(result)
                if status == "admitted":
                    artifact_report = write_wechat_public_notice_inline_image_provider_artifacts(
                        object_store=object_store,
                        bucket=source_truth_bucket,
                        media_refs_key=media_refs_key,
                        inline_ref=inline_ref,
                        result=result,
                    )
                    provider_response_key = artifact_report["provider_response_key"]
                    layout_elements_key = artifact_report["layout_elements_key"]
                    child_document = build_wechat_public_notice_inline_image_child_document(
                        entry=entry,
                        inline_ref=inline_ref,
                        result=result,
                    )
                    child_artifacts = (
                        write_wechat_public_notice_inline_image_child_document_artifacts(
                            object_store=object_store,
                            bucket=derived_bucket,
                            entry=entry,
                            inline_ref=inline_ref,
                            document=child_document,
                        )
                    )
                    registry_record = build_wechat_public_notice_inline_image_registry_record(
                        entry=entry,
                        inline_ref=inline_ref,
                        document=child_document,
                        artifact_report=child_artifacts,
                        result=result,
                    )
                    upsert_wechat_public_notice_inline_image_registry_record(
                        registry=registry,
                        record=registry_record,
                    )
                    write_wechat_public_notice_inline_image_ocr_manifest(
                        object_store=object_store,
                        bucket=source_truth_bucket,
                        media_refs_key=media_refs_key,
                        inline_ref=inline_ref,
                        payload=_build_ocr_manifest(
                            entry=entry,
                            inline_ref=inline_ref,
                            result=result,
                            status="admitted",
                            image_object_key=inline_ref.object_key,
                            provider_response_key=provider_response_key,
                            layout_elements_key=layout_elements_key,
                            child_document_id=child_document.document_id,
                            child_canonical_markdown_key=child_artifacts["canonical_markdown_key"],
                            child_document_units_key=child_artifacts["document_units_key"],
                            error="",
                        ),
                    )
                    admitted_count += 1
                elif status == "no_extractable_text":
                    artifact_report = write_wechat_public_notice_inline_image_provider_artifacts(
                        object_store=object_store,
                        bucket=source_truth_bucket,
                        media_refs_key=media_refs_key,
                        inline_ref=inline_ref,
                        result=result,
                    )
                    provider_response_key = artifact_report["provider_response_key"]
                    layout_elements_key = artifact_report["layout_elements_key"]
                    write_wechat_public_notice_inline_image_ocr_manifest(
                        object_store=object_store,
                        bucket=source_truth_bucket,
                        media_refs_key=media_refs_key,
                        inline_ref=inline_ref,
                        payload=_build_ocr_manifest(
                            entry=entry,
                            inline_ref=inline_ref,
                            result=result,
                            status="no_extractable_text",
                            image_object_key=inline_ref.object_key,
                            provider_response_key=provider_response_key,
                            layout_elements_key=layout_elements_key,
                            child_document_id="",
                            child_canonical_markdown_key="",
                            child_document_units_key="",
                            error="",
                        ),
                    )
                    no_extractable_text_count += 1
                else:
                    raise ValueError("unreachable multimodal status")
                _record_attempt(
                    attempt_store=attempt_store,
                    entry=entry,
                    media_ref_id=inline_ref.media_ref_id,
                    attempt_number=attempt_number,
                    admission_batch_id=admission_batch_id,
                    status=status,
                    provider=result.provider,
                    model=result.model,
                    fetch_manifest_key="",
                    ocr_manifest_key=build_wechat_public_notice_inline_image_artifact_keys(
                        media_refs_key=media_refs_key,
                        media_ref_id=inline_ref.media_ref_id,
                    ).ocr_manifest_key,
                    provider_response_key=provider_response_key,
                    layout_elements_key=layout_elements_key,
                    error="",
                )
                item_reports.append(
                    WeChatPublicNoticeMultimodalItemReport(
                        source_notice_id=entry.source_notice_id,
                        media_ref_id=inline_ref.media_ref_id,
                        status=status,
                        attempt_number=attempt_number,
                    )
                )
            except Exception as exc:
                terminal = attempt_number >= max_attempts
                if terminal:
                    write_wechat_public_notice_inline_image_ocr_manifest(
                        object_store=object_store,
                        bucket=source_truth_bucket,
                        media_refs_key=media_refs_key,
                        inline_ref=inline_ref,
                        payload={
                            "schema_version": WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
                            "source_notice_id": entry.source_notice_id,
                            "source_collection": entry.source_collection,
                            "media_ref_id": inline_ref.media_ref_id,
                            "status": "ocr_failed",
                            "provider": "",
                            "model": "",
                            "confidence": "",
                            "summary": "",
                            "extracted_text": "",
                            "provider_response_key": provider_response_key,
                            "layout_elements_key": layout_elements_key,
                            "child_document_id": "",
                            "child_canonical_markdown_key": "",
                            "child_document_units_key": "",
                            "processed_at": utc_now(),
                            "image_object_key": inline_ref.object_key,
                            "error": str(exc),
                        },
                    )
                    terminal_failure_count += 1
                else:
                    still_pending_count += 1
                _record_attempt(
                    attempt_store=attempt_store,
                    entry=entry,
                    media_ref_id=inline_ref.media_ref_id,
                    attempt_number=attempt_number,
                    admission_batch_id=admission_batch_id,
                    status="ocr_failed",
                    provider="",
                    model="",
                    fetch_manifest_key="",
                    ocr_manifest_key=build_wechat_public_notice_inline_image_artifact_keys(
                        media_refs_key=media_refs_key,
                        media_ref_id=inline_ref.media_ref_id,
                    ).ocr_manifest_key,
                    provider_response_key=provider_response_key,
                    layout_elements_key=layout_elements_key,
                    error=str(exc),
                )
                item_reports.append(
                    WeChatPublicNoticeMultimodalItemReport(
                        source_notice_id=entry.source_notice_id,
                        media_ref_id=inline_ref.media_ref_id,
                        status="ocr_failed" if terminal else "pending",
                        attempt_number=attempt_number,
                        reason=str(exc),
                    )
                )
    return WeChatPublicNoticeMultimodalProcessingReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=normalized_notice_ids,
        pending_notice_ids=tuple(
            sorted(
                {
                    entry.source_notice_id
                    for entry in pending_entries
                    if str(entry.source_notice_id).strip()
                }
            )
        ),
        projection_entry_count=len(entries),
        pending_entry_count=len(pending_entries),
        scanned_image_count=scanned_image_count,
        attempted_image_count=attempted_image_count,
        admitted_count=admitted_count,
        no_extractable_text_count=no_extractable_text_count,
        terminal_failure_count=terminal_failure_count,
        still_pending_count=still_pending_count,
        item_reports=tuple(item_reports),
    )


def build_wechat_public_notice_inline_image_artifact_keys(
    *,
    media_refs_key: str,
    media_ref_id: str,
) -> WeChatPublicNoticeInlineImageArtifactKeys:
    article_prefix = media_refs_key.rsplit("/source-truth/media-refs.jsonl", 1)[0]
    ref_slug = _slugify_segment(media_ref_id)
    base_prefix = f"{article_prefix}/projection/wechat_public_notice/multimodal/{ref_slug}"
    return WeChatPublicNoticeInlineImageArtifactKeys(
        base_prefix=base_prefix,
        fetch_manifest_key=f"{base_prefix}/source-image-reference.json",
        ocr_manifest_key=f"{base_prefix}/ocr-manifest.json",
    )


def list_wechat_public_notice_inline_image_refs(
    media_rows: Sequence[Mapping[str, object]],
) -> tuple[WeChatPublicNoticeInlineImageRef, ...]:
    refs: list[WeChatPublicNoticeInlineImageRef] = []
    for row in media_rows:
        if str(row.get("resourceRole") or "").strip() != "inline_image":
            continue
        media_ref_id = _required_text(row.get("mediaRefId"), label="mediaRefId")
        refs.append(
            WeChatPublicNoticeInlineImageRef(
                media_ref_id=media_ref_id,
                ref_order=int(row.get("refOrder") or 0),
                source_url=_required_text(row.get("sourceUrl"), label="sourceUrl"),
                normalized_source_url=_required_text(
                    row.get("normalizedSourceUrl"),
                    label="normalizedSourceUrl",
                ),
                capture_status=str(row.get("captureStatus") or "").strip(),
                final_url=str(row.get("finalUrl") or "").strip(),
                object_key=str(row.get("objectKey") or "").strip(),
                content_sha256=str(row.get("contentSha256") or "").strip(),
                mime_type=str(row.get("mimeType") or "").strip(),
                byte_size=int(row.get("byteSize") or 0),
                captured_at=str(row.get("capturedAt") or "").strip(),
                fetch_error_message=str(row.get("fetchErrorMessage") or "").strip(),
            )
        )
    return tuple(sorted(refs, key=lambda item: (item.ref_order, item.media_ref_id)))


def load_wechat_public_notice_inline_image_outcome(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    media_refs_key: str,
    inline_ref: WeChatPublicNoticeInlineImageRef,
) -> WeChatPublicNoticeInlineImageOutcome:
    artifact_keys = build_wechat_public_notice_inline_image_artifact_keys(
        media_refs_key=media_refs_key,
        media_ref_id=inline_ref.media_ref_id,
    )
    ocr_payload = _load_json_if_present(
        object_store=object_store,
        bucket=bucket,
        key=artifact_keys.ocr_manifest_key,
    )
    if ocr_payload is not None:
        return WeChatPublicNoticeInlineImageOutcome(
            media_ref_id=inline_ref.media_ref_id,
            source_url=inline_ref.source_url,
            normalized_source_url=inline_ref.normalized_source_url,
            status=_coerce_outcome_status(ocr_payload.get("status")),
            fetch_manifest_key="",
            ocr_manifest_key=artifact_keys.ocr_manifest_key,
            image_object_key=str(ocr_payload.get("image_object_key") or inline_ref.object_key),
            summary=str(ocr_payload.get("summary") or "").strip(),
            extracted_text=str(ocr_payload.get("extracted_text") or "").strip(),
            confidence=str(ocr_payload.get("confidence") or "").strip(),
            provider=str(ocr_payload.get("provider") or "").strip(),
            model=str(ocr_payload.get("model") or "").strip(),
            provider_response_key=str(ocr_payload.get("provider_response_key") or "").strip(),
            layout_elements_key=str(ocr_payload.get("layout_elements_key") or "").strip(),
            child_document_id=str(ocr_payload.get("child_document_id") or "").strip(),
            child_canonical_markdown_key=str(
                ocr_payload.get("child_canonical_markdown_key") or ""
            ).strip(),
            child_document_units_key=str(ocr_payload.get("child_document_units_key") or "").strip(),
            error=str(ocr_payload.get("error") or "").strip(),
        )
    capture_status = str(inline_ref.capture_status or "").strip()
    if capture_status == "fetch_failed":
        return WeChatPublicNoticeInlineImageOutcome(
            media_ref_id=inline_ref.media_ref_id,
            source_url=inline_ref.source_url,
            normalized_source_url=inline_ref.normalized_source_url,
            status="fetch_failed",
            fetch_manifest_key="",
            ocr_manifest_key=artifact_keys.ocr_manifest_key,
            image_object_key=inline_ref.object_key,
            error=inline_ref.fetch_error_message,
        )
    if not inline_ref.object_key:
        return WeChatPublicNoticeInlineImageOutcome(
            media_ref_id=inline_ref.media_ref_id,
            source_url=inline_ref.source_url,
            normalized_source_url=inline_ref.normalized_source_url,
            status="fetch_failed",
            fetch_manifest_key="",
            ocr_manifest_key=artifact_keys.ocr_manifest_key,
            error="missing source image object",
        )
    return WeChatPublicNoticeInlineImageOutcome(
        media_ref_id=inline_ref.media_ref_id,
        source_url=inline_ref.source_url,
        normalized_source_url=inline_ref.normalized_source_url,
        status="pending",
        fetch_manifest_key="",
        ocr_manifest_key=artifact_keys.ocr_manifest_key,
        image_object_key=inline_ref.object_key,
    )


def write_wechat_public_notice_inline_image_fetch_manifest(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    media_refs_key: str,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    payload: Mapping[str, object],
) -> str:
    key = build_wechat_public_notice_inline_image_artifact_keys(
        media_refs_key=media_refs_key,
        media_ref_id=inline_ref.media_ref_id,
    ).fetch_manifest_key
    object_store.put_bytes(
        bucket=bucket,
        key=key,
        data=(
            json.dumps(dict(payload), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8"),
        content_type="application/json; charset=utf-8",
    )
    return key


def write_wechat_public_notice_inline_image_ocr_manifest(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    media_refs_key: str,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    payload: Mapping[str, object],
) -> str:
    key = build_wechat_public_notice_inline_image_artifact_keys(
        media_refs_key=media_refs_key,
        media_ref_id=inline_ref.media_ref_id,
    ).ocr_manifest_key
    object_store.put_bytes(
        bucket=bucket,
        key=key,
        data=(
            json.dumps(dict(payload), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8"),
        content_type="application/json; charset=utf-8",
    )
    return key


def write_wechat_public_notice_inline_image_provider_artifacts(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    media_refs_key: str,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    result: WeChatPublicNoticeMultimodalProviderResult,
) -> dict[str, str]:
    artifact_keys = build_wechat_public_notice_inline_image_artifact_keys(
        media_refs_key=media_refs_key,
        media_ref_id=inline_ref.media_ref_id,
    )
    model_slug = _model_slug(provider=result.provider, model=result.model)
    provider_response_key = (
        f"{artifact_keys.base_prefix}/provider/{model_slug}/provider-response.jsonl"
    )
    layout_elements_key = f"{artifact_keys.base_prefix}/provider/{model_slug}/layout-elements.jsonl"
    object_store.put_bytes(
        bucket=bucket,
        key=provider_response_key,
        data=(
            json.dumps(
                {
                    "schema_version": WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
                    "provider": result.provider,
                    "model": result.model,
                    "confidence": result.confidence,
                    "summary": result.summary,
                    "extracted_text": result.extracted_text,
                    "has_meaningful_text": result.has_meaningful_text,
                    "raw_response": result.raw_response,
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8"),
        content_type="application/x-ndjson; charset=utf-8",
    )
    object_store.put_bytes(
        bucket=bucket,
        key=layout_elements_key,
        data=_layout_elements_jsonl(result.layout_elements).encode("utf-8"),
        content_type="application/x-ndjson; charset=utf-8",
    )
    return {
        "provider_response_key": provider_response_key,
        "layout_elements_key": layout_elements_key,
    }


def build_wechat_public_notice_inline_image_child_document(
    *,
    entry,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    result: WeChatPublicNoticeMultimodalProviderResult,
):
    notice_title = _resolve_notice_title(entry)
    metadata = dict(entry.role_metadata or {})
    document_id = (
        "wechat_notice_image:"
        f"{_slugify_segment(str(metadata.get('account_slug') or 'account'))}:"
        f"{entry.source_notice_id}:{_slugify_segment(inline_ref.media_ref_id)}"
    )
    summary = result.summary.strip()
    extracted_text = result.extracted_text.strip()
    lines = [
        f"# {notice_title}",
        "",
        f"- source_notice_id: `{entry.source_notice_id}`",
        f"- media_ref_id: `{inline_ref.media_ref_id}`",
        f"- source_url: {inline_ref.normalized_source_url or inline_ref.source_url}",
        f"- provider: `{result.provider}`",
        f"- model: `{result.model}`",
        "",
    ]
    if summary:
        lines.extend(["## OCR Summary", "", summary, ""])
    if extracted_text:
        lines.extend(["## OCR Extracted Text", "", extracted_text, ""])
    markdown = "\n".join(lines).strip() + "\n"
    document_units = (
        {
            "unit_id": f"{document_id}:ocr-text",
            "unit_type": "text_unit",
            "text": "\n\n".join(item for item in (summary, extracted_text) if item).strip(),
            "metadata": {
                "source": WECHAT_PUBLIC_NOTICE_MULTIMODAL_IMPORT_SOURCE,
                "confidence": result.confidence,
                "media_ref_id": inline_ref.media_ref_id,
            },
        },
    )
    return _ChildDocument(
        document_id=document_id,
        canonical_markdown=markdown,
        document_units=document_units,
    )


def write_wechat_public_notice_inline_image_child_document_artifacts(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    entry,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    document,
) -> dict[str, str]:
    metadata = dict(entry.role_metadata or {})
    title = _resolve_notice_title(entry)
    version_id = (
        "sha256:"
        + hashlib.sha256(document.canonical_markdown.encode("utf-8")).hexdigest()
        + ":source-faithful"
    )
    year = _publish_year(str(metadata.get("publish_day") or metadata.get("publish_time") or ""))
    canonical_markdown_key = build_document_artifact_key(
        corpus=entry.source_corpus,
        collection=entry.source_collection,
        document_id=document.document_id,
        revision_track="source-faithful",
        version_id=version_id,
        filename="canonical.md",
        title=f"{title}-{inline_ref.media_ref_id}",
        year=year,
    )
    document_units_key = build_document_artifact_key(
        corpus=entry.source_corpus,
        collection=entry.source_collection,
        document_id=document.document_id,
        revision_track="source-faithful",
        version_id=version_id,
        filename="document-units.jsonl",
        title=f"{title}-{inline_ref.media_ref_id}",
        year=year,
    )
    object_store.put_bytes(
        bucket=bucket,
        key=canonical_markdown_key,
        data=document.canonical_markdown.encode("utf-8"),
        content_type="text/markdown; charset=utf-8",
    )
    object_store.put_bytes(
        bucket=bucket,
        key=document_units_key,
        data=_document_units_jsonl(document.document_units).encode("utf-8"),
        content_type="application/x-ndjson; charset=utf-8",
    )
    return {
        "canonical_markdown_key": canonical_markdown_key,
        "document_units_key": document_units_key,
        "content_hash": "sha256:"
        + hashlib.sha256(document.canonical_markdown.encode("utf-8")).hexdigest(),
        "version_id": version_id,
    }


def build_wechat_public_notice_inline_image_registry_record(
    *,
    entry,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    document,
    artifact_report: Mapping[str, str],
    result: WeChatPublicNoticeMultimodalProviderResult,
) -> DocumentRegistryRecord:
    metadata = dict(entry.role_metadata or {})
    published_date = str(metadata.get("publish_time") or "").split("T", 1)[0] or None
    content_hash = _required_text(artifact_report.get("content_hash"), label="content_hash")
    version_id = _required_text(artifact_report.get("version_id"), label="version_id")
    return DocumentRegistryRecord(
        document_id=document.document_id,
        revision_track="source-faithful",
        version_id=version_id,
        source_uri=(
            "wechat_official_account://"
            f"{_slugify_segment(str(metadata.get('account_slug') or 'account'))}/"
            f"articles/{entry.source_notice_id}/media/{_slugify_segment(inline_ref.media_ref_id)}"
        ),
        content_hash=content_hash,
        corpus=entry.source_corpus,
        collection=entry.source_collection,
        cleaning_policy_version=WECHAT_PUBLIC_NOTICE_MULTIMODAL_PARSER_VERSION,
        visibility_scope="public",
        visibility_level="public",
        status="active",
        ingestion_timestamp=utc_now(),
        parser_version=WECHAT_PUBLIC_NOTICE_MULTIMODAL_PARSER_VERSION,
        source_channel="wechat_official_account",
        is_current=True,
        published_date=published_date,
        provenance_status="source_ocr_admitted",
        document_units_object_key=_required_text(
            artifact_report.get("document_units_key"),
            label="document_units_key",
        ),
        canonical_markdown_object_key=_required_text(
            artifact_report.get("canonical_markdown_key"),
            label="canonical_markdown_key",
        ),
        processed_object_keys=(
            _required_text(
                artifact_report.get("canonical_markdown_key"), label="canonical_markdown_key"
            ),
            _required_text(artifact_report.get("document_units_key"), label="document_units_key"),
        ),
        import_source=WECHAT_PUBLIC_NOTICE_MULTIMODAL_IMPORT_SOURCE,
    )


def upsert_wechat_public_notice_inline_image_registry_record(
    *,
    registry: WeChatPublicNoticeDocumentRegistry,
    record: DocumentRegistryRecord,
) -> None:
    existing_versions = registry.list_versions(
        record.document_id, revision_track=record.revision_track
    )
    records_to_write = []
    for existing in existing_versions:
        if existing.version_id == record.version_id:
            continue
        if existing.is_current:
            records_to_write.append(replace(existing, is_current=False))
    records_to_write.append(record)
    registry.upsert_many(tuple(records_to_write))


def _load_inline_image_object(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    inline_ref: WeChatPublicNoticeInlineImageRef,
) -> WeChatPublicNoticeFetchedInlineImage:
    if not inline_ref.object_key.strip():
        raise ValueError(f"{inline_ref.media_ref_id} missing source image object")
    image_bytes = object_store.get_bytes(bucket=bucket, key=inline_ref.object_key)
    content_type = inline_ref.mime_type.strip() or "image/png"
    if not _IMAGE_CONTENT_TYPE_RE.match(content_type):
        raise ValueError(
            f"{inline_ref.media_ref_id} expected image content-type, got {content_type or 'unknown'}"
        )
    return WeChatPublicNoticeFetchedInlineImage(
        content_type=content_type,
        image_bytes=image_bytes,
        final_url=inline_ref.final_url or inline_ref.normalized_source_url or inline_ref.source_url,
    )


def _write_inline_image_object(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    media_refs_key: str,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    fetched: WeChatPublicNoticeFetchedInlineImage,
) -> str:
    artifact_keys = build_wechat_public_notice_inline_image_artifact_keys(
        media_refs_key=media_refs_key,
        media_ref_id=inline_ref.media_ref_id,
    )
    extension = _infer_image_extension(
        content_type=fetched.content_type,
        source_url=fetched.final_url or inline_ref.normalized_source_url or inline_ref.source_url,
    )
    image_object_key = f"{artifact_keys.base_prefix}/original{extension}"
    object_store.put_bytes(
        bucket=bucket,
        key=image_object_key,
        data=fetched.image_bytes,
        content_type=fetched.content_type,
    )
    return image_object_key


def _build_fetch_manifest(
    *,
    entry,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    status: str,
    image_object_key: str,
    content_type: str,
    byte_size: int,
    sha256: str,
    final_url: str,
    error: str,
) -> dict[str, object]:
    metadata = dict(entry.role_metadata or {})
    return {
        "schema_version": WECHAT_PUBLIC_NOTICE_MULTIMODAL_FETCH_MANIFEST_SCHEMA,
        "source_notice_id": entry.source_notice_id,
        "source_collection": entry.source_collection,
        "media_ref_id": inline_ref.media_ref_id,
        "source_url": inline_ref.source_url,
        "normalized_source_url": inline_ref.normalized_source_url,
        "article_source_url": str(metadata.get("source_url") or ""),
        "status": status,
        "image_object_key": image_object_key,
        "content_type": content_type,
        "byte_size": byte_size,
        "sha256": sha256,
        "final_url": final_url,
        "fetched_at": utc_now(),
        "error": error,
    }


def _build_ocr_manifest(
    *,
    entry,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    result: WeChatPublicNoticeMultimodalProviderResult,
    status: str,
    image_object_key: str,
    provider_response_key: str,
    layout_elements_key: str,
    child_document_id: str,
    child_canonical_markdown_key: str,
    child_document_units_key: str,
    error: str,
) -> dict[str, object]:
    artifact_keys = build_wechat_public_notice_inline_image_artifact_keys(
        media_refs_key=_required_text(
            dict(entry.role_metadata or {}).get("media_refs_key"),
            label="media_refs_key",
        ),
        media_ref_id=inline_ref.media_ref_id,
    )
    fetch_manifest = {
        "fetch_manifest_key": artifact_keys.fetch_manifest_key,
        "ocr_manifest_key": artifact_keys.ocr_manifest_key,
    }
    return {
        "schema_version": WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
        "source_notice_id": entry.source_notice_id,
        "source_collection": entry.source_collection,
        "media_ref_id": inline_ref.media_ref_id,
        "status": status,
        "provider": result.provider,
        "model": result.model,
        "confidence": result.confidence,
        "summary": result.summary,
        "extracted_text": result.extracted_text,
        "provider_response_key": provider_response_key,
        "layout_elements_key": layout_elements_key,
        "child_document_id": child_document_id,
        "child_canonical_markdown_key": child_canonical_markdown_key,
        "child_document_units_key": child_document_units_key,
        "processed_at": utc_now(),
        "error": error,
        "image_object_key": image_object_key,
        **fetch_manifest,
    }


def _classify_provider_result(
    result: WeChatPublicNoticeMultimodalProviderResult,
) -> Literal["admitted", "no_extractable_text"]:
    summary = result.summary.strip()
    extracted_text = result.extracted_text.strip()
    if not result.has_meaningful_text and not summary and not extracted_text:
        return "no_extractable_text"
    if extracted_text and result.confidence in {"high", "medium"}:
        return "admitted"
    if summary and result.confidence == "high":
        return "admitted"
    raise ValueError("low confidence OCR result requires retry")


def _record_attempt(
    *,
    attempt_store: WeChatPublicNoticeMultimodalAttemptStore | None,
    entry,
    media_ref_id: str,
    attempt_number: int,
    admission_batch_id: str,
    status: str,
    provider: str,
    model: str,
    fetch_manifest_key: str,
    ocr_manifest_key: str,
    provider_response_key: str,
    layout_elements_key: str,
    error: str,
) -> None:
    if attempt_store is None:
        return
    attempt_store.record(
        WeChatPublicNoticeMultimodalAttempt(
            source_corpus=entry.source_corpus,
            source_collection=entry.source_collection,
            source_notice_id=entry.source_notice_id,
            unit_id=entry.unit_id,
            media_ref_id=media_ref_id,
            attempt_number=attempt_number,
            admission_batch_id=admission_batch_id,
            status=status,
            provider=provider,
            model=model,
            fetch_manifest_key=fetch_manifest_key,
            ocr_manifest_key=ocr_manifest_key,
            provider_response_key=provider_response_key,
            layout_elements_key=layout_elements_key,
            error=error,
            created_at=utc_now(),
        )
    )


def _next_attempt_number(
    *,
    attempt_store: WeChatPublicNoticeMultimodalAttemptStore | None,
    source_notice_id: str,
    media_ref_id: str,
) -> int:
    if attempt_store is None:
        return 1
    return (
        len(
            attempt_store.list_by_image(
                source_notice_id=source_notice_id,
                media_ref_id=media_ref_id,
            )
        )
        + 1
    )


def _is_pending_multimodal_entry(entry) -> bool:
    return (
        str(entry.consumption_status or "").strip() == "pending_multimodal_processing"
        and str(entry.target_surface or "").strip() == "multimodal_processing_candidate"
    )


def _load_media_rows(payload: bytes) -> tuple[dict[str, object], ...]:
    rows: list[dict[str, object]] = []
    for index, line in enumerate(payload.decode("utf-8").splitlines(), start=1):
        normalized = line.strip()
        if not normalized:
            continue
        parsed = json.loads(normalized)
        if not isinstance(parsed, dict):
            raise ValueError(f"media_refs line {index} must be a JSON object")
        rows.append(dict(parsed))
    return tuple(rows)


def _load_json_if_present(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    key: str,
) -> dict[str, object] | None:
    try:
        payload = object_store.get_bytes(bucket=bucket, key=key)
    except Exception:
        return None
    parsed = json.loads(payload.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError(f"{key} must decode to a JSON object")
    return dict(parsed)


def _required_text(value: object, *, label: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{label} is required")
    return text


def _resolve_notice_title(entry) -> str:
    metadata = dict(entry.role_metadata or {})
    return (
        str(metadata.get("notice_title") or "").strip()
        or str(metadata.get("title") or "").strip()
        or str(metadata.get("title_normalized") or "").strip()
        or entry.source_notice_id
    )


def _slugify_segment(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", str(value or "").strip()).strip("-").lower()
    if normalized:
        return normalized[:96]
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()[:16]


def _infer_image_extension(*, content_type: str, source_url: str) -> str:
    guessed = mimetypes.guess_extension(content_type, strict=False) or ""
    if guessed:
        return guessed
    path = urlparse(source_url).path
    if "." in path.rsplit("/", 1)[-1]:
        suffix = "." + path.rsplit(".", 1)[-1].lower()
        if len(suffix) <= 8:
            return suffix
    return ".bin"


def _publish_year(value: str) -> str:
    text = str(value or "").strip()
    match = re.search(r"(19|20)\d{2}", text)
    if match:
        return match.group(0)
    return "undated"


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _model_slug(*, provider: str, model: str) -> str:
    return _slugify_segment(f"{provider}-{model}")


def _layout_elements_jsonl(elements: Sequence[Mapping[str, Any]]) -> str:
    return "".join(json.dumps(dict(item), ensure_ascii=False) + "\n" for item in elements)


def _document_units_jsonl(units: Sequence[Mapping[str, Any]]) -> str:
    return "".join(json.dumps(dict(item), ensure_ascii=False) + "\n" for item in units)


def _build_chat_user_content(
    request: WeChatPublicNoticeMultimodalProviderRequest,
) -> list[dict[str, object]]:
    prompt = "\n".join(
        (
            f"notice_title: {request.notice_title}",
            f"publish_time: {request.publish_time}",
            f"article_source_url: {request.article_source_url}",
            f"media_ref_id: {request.media_ref_id}",
            "Extract user-relevant textual facts from this campus notice image.",
        )
    )
    return [
        {"type": "text", "text": prompt},
        {
            "type": "image_url",
            "image_url": {
                "url": "data:image/png;base64,"
                + base64.b64encode(request.image_bytes).decode("ascii")
            },
        },
    ]


def _wechat_multimodal_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "confidence": {
                "type": "string",
                "enum": ["high", "medium", "low"],
            },
            "has_meaningful_text": {"type": "boolean"},
            "summary": {"type": "string"},
            "extracted_text": {"type": "string"},
            "layout_elements": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "kind": {"type": "string"},
                        "text": {"type": "string"},
                    },
                    "required": ["kind", "text"],
                },
            },
        },
        "required": [
            "confidence",
            "has_meaningful_text",
            "summary",
            "extracted_text",
            "layout_elements",
        ],
    }


def _extract_chat_completions_payload(response_json: Mapping[str, Any]) -> dict[str, Any]:
    choices = response_json.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("chat completions response missing choices")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ValueError("chat completions response missing message")
    content = message.get("content")
    if isinstance(content, str):
        raw_text = content.strip()
        if not raw_text:
            raise ValueError("chat completions content is empty")
        parsed = json.loads(raw_text)
        if not isinstance(parsed, dict):
            raise ValueError("chat completions parsed content must be an object")
        return dict(parsed)
    if isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                parsed = json.loads(text)
                if not isinstance(parsed, dict):
                    raise ValueError("chat completions parsed content must be an object")
                return dict(parsed)
    raise ValueError("chat completions response missing JSON content")


def _coerce_confidence(value: object) -> WeChatPublicNoticeMultimodalConfidence:
    text = str(value or "").strip()
    if text not in {"high", "medium", "low"}:
        raise ValueError(f"unsupported confidence: {text}")
    return text  # type: ignore[return-value]


def _coerce_layout_elements(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list):
        return ()
    elements: list[Mapping[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").strip()
        text = str(item.get("text") or "").strip()
        if not kind and not text:
            continue
        elements.append({"kind": kind, "text": text})
    return tuple(elements)


def _coerce_outcome_status(value: object) -> WeChatPublicNoticeImageStatus:
    text = str(value or "").strip()
    if text not in {"pending", "admitted", "no_extractable_text", "fetch_failed", "ocr_failed"}:
        raise ValueError(f"unsupported wechat inline image outcome status: {text}")
    return text  # type: ignore[return-value]


@dataclass(frozen=True, slots=True)
class _ChildDocument:
    document_id: str
    canonical_markdown: str
    document_units: tuple[Mapping[str, Any], ...]


def fetched_image_object_key(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    media_refs_key: str,
    inline_ref: WeChatPublicNoticeInlineImageRef,
) -> str:
    fetch_payload = _load_json_if_present(
        object_store=object_store,
        bucket=bucket,
        key=build_wechat_public_notice_inline_image_artifact_keys(
            media_refs_key=media_refs_key,
            media_ref_id=inline_ref.media_ref_id,
        ).fetch_manifest_key,
    )
    if fetch_payload is None:
        return ""
    return str(fetch_payload.get("image_object_key") or "").strip()


__all__ = [
    "DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY",
    "DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_MANAGEMENT_ENV_KEY",
    "DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY",
    "DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_TABLE",
    "DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_BASE_URL",
    "DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS",
    "WECHAT_PUBLIC_NOTICE_MULTIMODAL_FETCH_MANIFEST_SCHEMA",
    "WECHAT_PUBLIC_NOTICE_MULTIMODAL_IMPORT_SOURCE",
    "WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA",
    "WECHAT_PUBLIC_NOTICE_MULTIMODAL_PARSER_VERSION",
    "ChatCompletionsWeChatPublicNoticeMultimodalProvider",
    "HttpxWeChatPublicNoticeInlineImageFetcher",
    "InMemoryWeChatPublicNoticeMultimodalAttemptStore",
    "PostgresWeChatPublicNoticeMultimodalAttemptStore",
    "WeChatPublicNoticeFetchedInlineImage",
    "WeChatPublicNoticeImageStatus",
    "WeChatPublicNoticeInlineImageArtifactKeys",
    "WeChatPublicNoticeInlineImageFetchRequest",
    "WeChatPublicNoticeInlineImageFetcher",
    "WeChatPublicNoticeInlineImageOutcome",
    "WeChatPublicNoticeInlineImageRef",
    "WeChatPublicNoticeMultimodalAttempt",
    "WeChatPublicNoticeMultimodalAttemptStore",
    "WeChatPublicNoticeMultimodalConfidence",
    "WeChatPublicNoticeMultimodalItemReport",
    "WeChatPublicNoticeMultimodalObjectStore",
    "WeChatPublicNoticeMultimodalProcessingReport",
    "WeChatPublicNoticeMultimodalProvider",
    "WeChatPublicNoticeMultimodalProviderRequest",
    "WeChatPublicNoticeMultimodalProviderResult",
    "build_wechat_public_notice_inline_image_artifact_keys",
    "build_wechat_public_notice_multimodal_attempt_store_from_env",
    "list_wechat_public_notice_inline_image_refs",
    "load_wechat_public_notice_inline_image_outcome",
    "process_wechat_public_notice_pending_multimodal_entries",
    "select_wechat_public_notice_pending_multimodal_notice_ids",
    "upsert_wechat_public_notice_inline_image_registry_record",
    "write_wechat_public_notice_inline_image_fetch_manifest",
    "write_wechat_public_notice_inline_image_ocr_manifest",
]
