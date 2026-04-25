from __future__ import annotations

import json
import os
from base64 import b64encode
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from typing import Literal, Protocol

import httpx

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    AuthenticatedNoticeSourceTruthInventoryStore,
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.internal_notice_consumption_admission import (
    DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY,
    DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_MANAGEMENT_ENV_KEY,
    DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_ENV_KEY,
)
from campus_ingestion_core.notice_consumption_projection import (
    DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY,
    DEFAULT_NOTICE_CONSUMPTION_PROJECTION_MANAGEMENT_ENV_KEY,
    DEFAULT_NOTICE_CONSUMPTION_PROJECTION_OPERATOR_ENV_KEY,
    NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_DEFAULT_AGENT_NOTICE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    NoticeConsumptionProjectionEntry,
    NoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
    normalize_notice_ids,
)
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
from campus_ingestion_core.settings import ObjectStoreSettings

DEFAULT_INTERNAL_NOTICE_MULTIMODAL_BASE_URL = "https://api.openai.com/v1"
DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS = 900
DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_ATTEMPTS = 3
DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY = (
    "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_MANAGEMENT_ENV_KEY = (
    "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_MANAGEMENT_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY = (
    "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_TABLE = (
    "ingestion_projection.internal_notice_multimodal_attempt"
)

InternalNoticeMultimodalAction = Literal[
    "retain_for_notice_query",
    "no_adoption",
    "needs_additional_processing",
]
InternalNoticeMultimodalConfidence = Literal["high", "medium", "low"]


class InternalNoticeMultimodalObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class InternalNoticeMultimodalProcessor(Protocol):
    def process(
        self,
        request: InternalNoticeMultimodalProcessingRequest,
    ) -> InternalNoticeMultimodalDecision: ...


class InternalNoticeMultimodalAttemptStore(Protocol):
    def record(self, attempt: InternalNoticeMultimodalAttempt) -> None: ...

    def list_by_unit(self, unit_id: str) -> tuple[InternalNoticeMultimodalAttempt, ...]: ...


@dataclass(frozen=True, slots=True)
class InternalNoticeMultimodalAttachment:
    attachment_ref_id: str
    filename: str
    mime_type: str
    object_key: str
    data: bytes


@dataclass(frozen=True, slots=True)
class InternalNoticeMultimodalProcessingRequest:
    source_notice_id: str
    unit_id: str
    notice_title: str
    primary_role: str
    reasons: tuple[str, ...]
    attachments: tuple[InternalNoticeMultimodalAttachment, ...]


@dataclass(frozen=True, slots=True)
class InternalNoticeMultimodalDecision:
    action: InternalNoticeMultimodalAction
    summary: str
    extracted_text: str
    reasons: tuple[str, ...]
    confidence: InternalNoticeMultimodalConfidence


@dataclass(frozen=True, slots=True)
class InternalNoticeMultimodalAttempt:
    source_corpus: str
    source_collection: str
    source_notice_id: str
    unit_id: str
    attempt_number: int
    admission_batch_id: str
    model: str
    decision_action: str
    status: str
    reasons: tuple[str, ...]
    error: str | None = None
    created_at: str = ""


@dataclass(frozen=True, slots=True)
class InternalNoticeMultimodalItemReport:
    source_notice_id: str
    unit_id: str
    action: str
    status: str
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class InternalNoticeMultimodalProcessingReport:
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    projection_entry_count: int
    pending_entry_count: int
    processed_count: int
    retained_for_notice_query_count: int
    no_adoption_count: int
    still_pending_count: int
    failed_count: int
    item_reports: tuple[InternalNoticeMultimodalItemReport, ...]


@dataclass(frozen=True, slots=True)
class InternalNoticeMultimodalDrainReport:
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    pending_notice_ids: tuple[str, ...]
    scanned_projection_entry_count: int
    batch_count: int
    projection_entry_count: int
    pending_entry_count: int
    processed_count: int
    retained_for_notice_query_count: int
    no_adoption_count: int
    still_pending_count: int
    failed_count: int
    item_reports: tuple[InternalNoticeMultimodalItemReport, ...]


class InMemoryInternalNoticeMultimodalAttemptStore:
    def __init__(
        self,
        records: Sequence[InternalNoticeMultimodalAttempt] = (),
    ) -> None:
        self._records = list(records)

    def record(self, attempt: InternalNoticeMultimodalAttempt) -> None:
        self._records.append(attempt)

    def list_by_unit(self, unit_id: str) -> tuple[InternalNoticeMultimodalAttempt, ...]:
        return tuple(item for item in self._records if item.unit_id == unit_id)


class PostgresInternalNoticeMultimodalAttemptStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("internal notice multimodal attempt database url is required")
        self.table_name = table_name
        self._ensure_schema()

    def record(self, attempt: InternalNoticeMultimodalAttempt) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                insert into {table_sql} (
                    source_corpus,
                    source_collection,
                    source_notice_id,
                    unit_id,
                    attempt_number,
                    admission_batch_id,
                    model,
                    decision_action,
                    status,
                    reasons,
                    error,
                    created_at,
                    record
                )
                values (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s::jsonb
                )
                on conflict (source_corpus, source_collection, unit_id, attempt_number)
                do update set
                    source_notice_id = excluded.source_notice_id,
                    admission_batch_id = excluded.admission_batch_id,
                    model = excluded.model,
                    decision_action = excluded.decision_action,
                    status = excluded.status,
                    reasons = excluded.reasons,
                    error = excluded.error,
                    created_at = excluded.created_at,
                    record = excluded.record
                """,
                (
                    attempt.source_corpus,
                    attempt.source_collection,
                    attempt.source_notice_id,
                    attempt.unit_id,
                    attempt.attempt_number,
                    attempt.admission_batch_id,
                    attempt.model,
                    attempt.decision_action,
                    attempt.status,
                    json.dumps(attempt.reasons, ensure_ascii=False),
                    attempt.error,
                    attempt.created_at,
                    json.dumps(asdict(attempt), ensure_ascii=False),
                ),
            )

    def list_by_unit(self, unit_id: str) -> tuple[InternalNoticeMultimodalAttempt, ...]:
        table_sql = _qualified_table_sql(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                select record from {table_sql}
                where unit_id = %s
                order by attempt_number asc
                """,
                (unit_id,),
            )
            rows = cursor.fetchall()
        attempts: list[InternalNoticeMultimodalAttempt] = []
        for row in rows:
            payload = _coerce_json_payload(row[0])
            payload["reasons"] = tuple(payload.get("reasons") or ())
            payload["source_corpus"] = str(payload.get("source_corpus") or "campus_notices")
            payload["source_collection"] = str(
                payload.get("source_collection") or "internal_notice"
            )
            payload["admission_batch_id"] = str(payload.get("admission_batch_id") or "")
            attempts.append(InternalNoticeMultimodalAttempt(**payload))
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
                    attempt_number integer not null,
                    admission_batch_id text not null default '',
                    model text not null,
                    decision_action text not null,
                    status text not null,
                    reasons jsonb not null,
                    error text,
                    created_at timestamptz not null,
                    record jsonb not null,
                    primary key (source_corpus, source_collection, unit_id, attempt_number)
                )
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_notice
                on {table_sql} (source_corpus, source_collection, source_notice_id)
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_admission
                on {table_sql} (source_corpus, source_collection, admission_batch_id)
                """
            )
            cursor.execute(
                f"""
                alter table {table_sql}
                add column if not exists admission_batch_id text not null default ''
                """
            )


def build_internal_notice_multimodal_attempt_store_from_env(
    env: Mapping[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresInternalNoticeMultimodalAttemptStore:
    source = dict(env if env is not None else os.environ)
    if prefer_operator:
        operator_database_url = (
            source.get(DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY)
            or source.get(DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_MANAGEMENT_ENV_KEY)
            or source.get(DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_ENV_KEY)
            or source.get(DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_MANAGEMENT_ENV_KEY)
            or source.get(DEFAULT_NOTICE_CONSUMPTION_PROJECTION_OPERATOR_ENV_KEY)
            or source.get(DEFAULT_NOTICE_CONSUMPTION_PROJECTION_MANAGEMENT_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_OPERATOR_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY)
            or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
            or source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY)
            or ""
        ).strip()
        if not operator_database_url:
            raise ValueError(
                f"{DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY} or "
                f"{DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_MANAGEMENT_ENV_KEY} or "
                f"{DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_ENV_KEY} or "
                f"{DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_MANAGEMENT_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_MANAGEMENT_ENV_KEY} is required when prefer_operator=True"
            )
        return PostgresInternalNoticeMultimodalAttemptStore(
            database_url=build_operator_postgres_connection_url(operator_database_url)
        )
    database_url = (
        source.get(DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY)
        or source.get(DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY)
        or source.get(DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or source.get(DOCUMENT_REGISTRY_ENV_KEY)
        or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY} or "
            f"{DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY} or "
            f"{DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} "
            "is required"
        )
    return PostgresInternalNoticeMultimodalAttemptStore(database_url=database_url)


class ChatCompletionsInternalNoticeMultimodalProcessor:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str = DEFAULT_INTERNAL_NOTICE_MULTIMODAL_BASE_URL,
        max_output_tokens: int = DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS,
        http_client: httpx.Client | None = None,
    ) -> None:
        if not api_key.strip():
            raise ValueError("api_key must not be empty")
        if not model.strip():
            raise ValueError("model must not be empty")
        if not base_url.strip():
            raise ValueError("base_url must not be empty")
        if max_output_tokens <= 0:
            raise ValueError("max_output_tokens must be greater than zero")
        self._api_key = api_key.strip()
        self._model = model.strip()
        self._max_output_tokens = max_output_tokens
        self._http_client = http_client or httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=3.0),
            trust_env=False,
        )

    @classmethod
    def from_env(
        cls,
        env: Mapping[str, str] | None = None,
    ) -> ChatCompletionsInternalNoticeMultimodalProcessor:
        source = env if env is not None else os.environ
        api_key = (
            source.get("INTERNAL_NOTICE_MULTIMODAL_API_KEY")
            or source.get("PROMPT_RUNTIME_API_KEY")
            or source.get("LLM_API_KEY")
            or ""
        ).strip()
        model = (
            source.get("INTERNAL_NOTICE_MULTIMODAL_MODEL")
            or source.get("PROMPT_RUNTIME_MODEL")
            or ""
        ).strip()
        base_url = (
            source.get("INTERNAL_NOTICE_MULTIMODAL_BASE_URL")
            or source.get("PROMPT_RUNTIME_BASE_URL")
            or source.get("LLM_BASE_URL")
            or DEFAULT_INTERNAL_NOTICE_MULTIMODAL_BASE_URL
        ).strip()
        max_output_tokens = int(
            (
                source.get("INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS")
                or source.get("PROMPT_RUNTIME_MAX_OUTPUT_TOKENS")
                or str(DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS)
            ).strip()
        )
        if not api_key:
            raise ValueError(
                "INTERNAL_NOTICE_MULTIMODAL_API_KEY or PROMPT_RUNTIME_API_KEY or "
                "LLM_API_KEY is required"
            )
        if not model:
            raise ValueError("INTERNAL_NOTICE_MULTIMODAL_MODEL or PROMPT_RUNTIME_MODEL is required")
        return cls(
            api_key=api_key,
            model=model,
            base_url=base_url,
            max_output_tokens=max_output_tokens,
        )

    def process(
        self,
        request: InternalNoticeMultimodalProcessingRequest,
    ) -> InternalNoticeMultimodalDecision:
        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You process restricted campus notice visual attachments. "
                        "Return only structured JSON. Do not infer policy text that is not visible. "
                        "If the visual content can help answer notice-level questions, choose "
                        "retain_for_notice_query. If it is decorative or not useful for campus QA, "
                        "choose no_adoption. If the image is unreadable or needs another lane, choose "
                        "needs_additional_processing."
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
                    "name": "internal_notice_multimodal_processing",
                    "schema": _decision_schema(),
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
        if not isinstance(response_json, dict):
            raise ValueError("internal notice multimodal response must be a JSON object")
        raw_payload = _extract_chat_completions_payload(response_json)
        return _coerce_decision(raw_payload)


def process_internal_notice_pending_multimodal_entries(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    notice_ids: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    object_store: InternalNoticeMultimodalObjectStore | None = None,
    source_bucket: str | None = None,
    processor: InternalNoticeMultimodalProcessor | None = None,
    attempt_store: InternalNoticeMultimodalAttemptStore | None = None,
    max_attempts: int = DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_ATTEMPTS,
    admission_batch_id: str = "",
    admission_command: str = "",
    admission_created_at: str = "",
) -> InternalNoticeMultimodalProcessingReport:
    normalized_notice_ids = normalize_notice_ids(notice_ids)
    if not normalized_notice_ids:
        raise ValueError("selected notice_ids are required for multimodal processing")
    if max_attempts <= 0:
        raise ValueError("max_attempts must be greater than zero")
    source = dict(env if env is not None else os.environ)
    runtime_projection_store = (
        projection_store or build_notice_consumption_projection_store_from_env(source)
    )
    entries = runtime_projection_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
    )
    updated_entries: list[NoticeConsumptionProjectionEntry] = []
    item_reports: list[InternalNoticeMultimodalItemReport] = []
    retained_count = 0
    no_adoption_count = 0
    still_pending_count = 0
    failed_count = 0
    pending_count = 0
    processed_count = 0
    runtime_inventory_store = source_truth_inventory_store
    inventory_by_notice_id: dict[str, AuthenticatedNoticeSourceTruthInventoryEntry] | None = None
    runtime_object_store = object_store
    runtime_source_bucket = source_bucket
    runtime_processor = processor
    for entry in entries:
        if not _is_pending_multimodal_entry(entry):
            updated_entries.append(entry)
            continue
        pending_count += 1
        if runtime_object_store is None or runtime_source_bucket is None:
            object_settings = ObjectStoreSettings.from_env(source)
            runtime_object_store = runtime_object_store or S3ObjectStoreWriter(object_settings)
            runtime_source_bucket = runtime_source_bucket or object_settings.bucket_source
        if runtime_processor is None:
            runtime_processor = ChatCompletionsInternalNoticeMultimodalProcessor.from_env(source)
        if inventory_by_notice_id is None:
            runtime_inventory_store = (
                runtime_inventory_store
                or build_authenticated_notice_source_truth_inventory_store_from_env(source)
            )
            inventory_entries = runtime_inventory_store.list_by_scope(
                source_corpus,
                source_collection,
                notice_ids=normalized_notice_ids,
            )
            inventory_by_notice_id = {item.notice_id: item for item in inventory_entries}
        inventory_entry = inventory_by_notice_id.get(entry.source_notice_id)
        request = _build_processing_request(
            entry=entry,
            inventory_entry=inventory_entry,
            object_store=runtime_object_store,
            source_bucket=runtime_source_bucket,
        )
        try:
            raw_decision = runtime_processor.process(request)
            decision = _guard_multimodal_decision(raw_decision)
        except Exception as exc:
            _record_attempt(
                attempt_store=attempt_store,
                entry=entry,
                source_corpus=source_corpus,
                source_collection=source_collection,
                attempt_number=_next_attempt_number(attempt_store, entry.unit_id),
                admission_batch_id=admission_batch_id,
                model=_processor_model_label(runtime_processor),
                decision_action="failed",
                status="failed",
                reasons=(),
                error=str(exc),
            )
            failed_count += 1
            updated_entries.append(entry)
            item_reports.append(
                InternalNoticeMultimodalItemReport(
                    source_notice_id=entry.source_notice_id,
                    unit_id=entry.unit_id,
                    action="failed",
                    status=entry.consumption_status,
                    reason=str(exc),
                )
            )
            continue
        processed_count += 1
        attempt_number = _next_attempt_number(attempt_store, entry.unit_id)
        _record_attempt(
            attempt_store=attempt_store,
            entry=entry,
            source_corpus=source_corpus,
            source_collection=source_collection,
            attempt_number=attempt_number,
            admission_batch_id=admission_batch_id,
            model=_processor_model_label(runtime_processor),
            decision_action=raw_decision.action,
            status="processed_guarded" if decision != raw_decision else "processed",
            reasons=decision.reasons,
            error=None,
        )
        if decision.action == "retain_for_notice_query":
            retained_count += 1
            updated = _mark_retained_for_notice_query(
                entry,
                decision,
                admission_batch_id=admission_batch_id,
                admission_command=admission_command,
                admission_created_at=admission_created_at,
            )
        elif decision.action == "no_adoption":
            no_adoption_count += 1
            updated = _mark_no_adoption(
                entry,
                decision,
                admission_batch_id=admission_batch_id,
                admission_command=admission_command,
                admission_created_at=admission_created_at,
            )
        elif attempt_number >= max_attempts:
            no_adoption_count += 1
            updated = _mark_attempts_exhausted(
                entry,
                decision,
                admission_batch_id=admission_batch_id,
                admission_command=admission_command,
                admission_created_at=admission_created_at,
            )
        else:
            still_pending_count += 1
            updated = _mark_still_pending(
                entry,
                decision,
                admission_batch_id=admission_batch_id,
                admission_command=admission_command,
                admission_created_at=admission_created_at,
            )
        updated_entries.append(updated)
        item_reports.append(
            InternalNoticeMultimodalItemReport(
                source_notice_id=entry.source_notice_id,
                unit_id=entry.unit_id,
                action=decision.action,
                status=updated.consumption_status,
            )
        )
    runtime_projection_store.replace_notices(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
        records=tuple(updated_entries),
    )
    return InternalNoticeMultimodalProcessingReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=normalized_notice_ids,
        projection_entry_count=len(entries),
        pending_entry_count=pending_count,
        processed_count=processed_count,
        retained_for_notice_query_count=retained_count,
        no_adoption_count=no_adoption_count,
        still_pending_count=still_pending_count,
        failed_count=failed_count,
        item_reports=tuple(item_reports),
    )


def select_internal_notice_pending_multimodal_notice_ids(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    notice_ids: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
    limit: int = 100,
) -> tuple[str, ...]:
    if limit <= 0:
        raise ValueError("limit must be greater than zero")
    source = dict(env if env is not None else os.environ)
    runtime_projection_store = (
        projection_store or build_notice_consumption_projection_store_from_env(source)
    )
    entries = runtime_projection_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalize_notice_ids(notice_ids),
    )
    return _pending_multimodal_notice_ids(entries, limit=limit)


def drain_internal_notice_pending_multimodal_entries(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    notice_ids: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    object_store: InternalNoticeMultimodalObjectStore | None = None,
    source_bucket: str | None = None,
    processor: InternalNoticeMultimodalProcessor | None = None,
    attempt_store: InternalNoticeMultimodalAttemptStore | None = None,
    max_attempts: int = DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_ATTEMPTS,
    limit: int = 100,
    batch_size: int = 20,
    admission_batch_id: str = "",
    admission_command: str = "",
    admission_created_at: str = "",
) -> InternalNoticeMultimodalDrainReport:
    if limit <= 0:
        raise ValueError("limit must be greater than zero")
    if batch_size <= 0:
        raise ValueError("batch_size must be greater than zero")
    source = dict(env if env is not None else os.environ)
    normalized_notice_ids = normalize_notice_ids(notice_ids)
    runtime_projection_store = (
        projection_store or build_notice_consumption_projection_store_from_env(source)
    )
    entries = runtime_projection_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
    )
    pending_notice_ids = _pending_multimodal_notice_ids(entries, limit=limit)
    batch_reports: list[InternalNoticeMultimodalProcessingReport] = []
    item_reports: list[InternalNoticeMultimodalItemReport] = []
    for batch_notice_ids in _chunked(pending_notice_ids, batch_size):
        batch_report = process_internal_notice_pending_multimodal_entries(
            source_corpus=source_corpus,
            source_collection=source_collection,
            notice_ids=batch_notice_ids,
            env=source,
            projection_store=runtime_projection_store,
            source_truth_inventory_store=source_truth_inventory_store,
            object_store=object_store,
            source_bucket=source_bucket,
            processor=processor,
            attempt_store=attempt_store,
            max_attempts=max_attempts,
            admission_batch_id=admission_batch_id,
            admission_command=admission_command,
            admission_created_at=admission_created_at,
        )
        batch_reports.append(batch_report)
        item_reports.extend(batch_report.item_reports)
    return InternalNoticeMultimodalDrainReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=normalized_notice_ids,
        pending_notice_ids=pending_notice_ids,
        scanned_projection_entry_count=len(entries),
        batch_count=len(batch_reports),
        projection_entry_count=sum(report.projection_entry_count for report in batch_reports),
        pending_entry_count=sum(report.pending_entry_count for report in batch_reports),
        processed_count=sum(report.processed_count for report in batch_reports),
        retained_for_notice_query_count=sum(
            report.retained_for_notice_query_count for report in batch_reports
        ),
        no_adoption_count=sum(report.no_adoption_count for report in batch_reports),
        still_pending_count=sum(report.still_pending_count for report in batch_reports),
        failed_count=sum(report.failed_count for report in batch_reports),
        item_reports=tuple(item_reports),
    )


def _pending_multimodal_notice_ids(
    entries: Sequence[NoticeConsumptionProjectionEntry],
    *,
    limit: int,
) -> tuple[str, ...]:
    pending_notice_ids: list[str] = []
    seen: set[str] = set()
    for entry in entries:
        if not _is_pending_multimodal_entry(entry):
            continue
        if entry.source_notice_id in seen:
            continue
        seen.add(entry.source_notice_id)
        pending_notice_ids.append(entry.source_notice_id)
        if len(pending_notice_ids) >= limit:
            break
    return tuple(pending_notice_ids)


def _chunked(values: Sequence[str], size: int) -> tuple[tuple[str, ...], ...]:
    return tuple(tuple(values[index : index + size]) for index in range(0, len(values), size))


def _is_pending_multimodal_entry(entry: NoticeConsumptionProjectionEntry) -> bool:
    return entry.consumption_status == NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING


def _build_processing_request(
    *,
    entry: NoticeConsumptionProjectionEntry,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    object_store: InternalNoticeMultimodalObjectStore,
    source_bucket: str,
) -> InternalNoticeMultimodalProcessingRequest:
    metadata = dict(entry.role_metadata or {})
    notice_title = (
        str(metadata.get("notice_title") or "").strip()
        or str(metadata.get("title") or "").strip()
        or (
            str((inventory_entry.parent_snapshot or {}).get("notice_title") or "").strip()
            if inventory_entry is not None
            else ""
        )
        or entry.source_notice_document_id
    )
    return InternalNoticeMultimodalProcessingRequest(
        source_notice_id=entry.source_notice_id,
        unit_id=entry.unit_id,
        notice_title=notice_title,
        primary_role=entry.primary_role,
        reasons=_extract_reasons(entry),
        attachments=_load_multimodal_processing_attachments(
            inventory_entry=inventory_entry,
            object_store=object_store,
            source_bucket=source_bucket,
        ),
    )


def _load_multimodal_processing_attachments(
    *,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    object_store: InternalNoticeMultimodalObjectStore,
    source_bucket: str,
) -> tuple[InternalNoticeMultimodalAttachment, ...]:
    if inventory_entry is None:
        return ()
    plans = [
        dict(item)
        for item in (inventory_entry.parent_snapshot.get("attachment_projection_plans") or ())
        if isinstance(item, dict)
        and str(item.get("classification") or "") == "multimodal_processing_required"
    ]
    if not plans:
        return ()
    attachment_refs = _load_attachment_refs(
        object_store=object_store,
        source_bucket=source_bucket,
        attachment_refs_key=inventory_entry.attachment_refs_key,
    )
    refs_by_id = {
        str(item.get("attachment_ref_id") or "").strip(): item for item in attachment_refs
    }
    attachments: list[InternalNoticeMultimodalAttachment] = []
    for plan in plans:
        attachment_ref_id = str(plan.get("attachment_ref_id") or "").strip()
        if not attachment_ref_id:
            continue
        ref = refs_by_id.get(attachment_ref_id) or {}
        object_key = str(ref.get("object_key") or "").strip()
        if not object_key:
            continue
        try:
            data = object_store.get_bytes(bucket=source_bucket, key=object_key)
        except Exception:
            continue
        attachments.append(
            InternalNoticeMultimodalAttachment(
                attachment_ref_id=attachment_ref_id,
                filename=str(
                    ref.get("filename")
                    or ref.get("original_filename")
                    or ref.get("anchor_text")
                    or attachment_ref_id
                ).strip(),
                mime_type=str(ref.get("mime_type") or "application/octet-stream").strip(),
                object_key=object_key,
                data=data,
            )
        )
    return tuple(attachments)


def _load_attachment_refs(
    *,
    object_store: InternalNoticeMultimodalObjectStore,
    source_bucket: str,
    attachment_refs_key: str,
) -> tuple[dict[str, object], ...]:
    try:
        payload = object_store.get_bytes(bucket=source_bucket, key=attachment_refs_key)
    except Exception:
        return ()
    rows: list[dict[str, object]] = []
    for line in payload.decode("utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        item = json.loads(stripped)
        if isinstance(item, dict):
            rows.append(item)
    return tuple(rows)


def _mark_retained_for_notice_query(
    entry: NoticeConsumptionProjectionEntry,
    decision: InternalNoticeMultimodalDecision,
    *,
    admission_batch_id: str,
    admission_command: str,
    admission_created_at: str,
) -> NoticeConsumptionProjectionEntry:
    return replace(
        entry,
        default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
        target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        role_metadata=_build_processed_metadata(
            entry,
            decision,
            admission_batch_id=admission_batch_id,
            admission_command=admission_command,
            admission_created_at=admission_created_at,
        ),
    )


def _mark_no_adoption(
    entry: NoticeConsumptionProjectionEntry,
    decision: InternalNoticeMultimodalDecision,
    *,
    admission_batch_id: str,
    admission_command: str,
    admission_created_at: str,
) -> NoticeConsumptionProjectionEntry:
    return replace(
        entry,
        default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
        target_surface=NOTICE_TARGET_SURFACE_UNSUPPORTED,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
        role_metadata={
            **_build_processed_metadata(
                entry,
                decision,
                admission_batch_id=admission_batch_id,
                admission_command=admission_command,
                admission_created_at=admission_created_at,
            ),
            "no_adoption_reason": "multimodal_no_adoption",
        },
    )


def _mark_attempts_exhausted(
    entry: NoticeConsumptionProjectionEntry,
    decision: InternalNoticeMultimodalDecision,
    *,
    admission_batch_id: str,
    admission_command: str,
    admission_created_at: str,
) -> NoticeConsumptionProjectionEntry:
    return replace(
        entry,
        default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
        target_surface=NOTICE_TARGET_SURFACE_UNSUPPORTED,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
        role_metadata={
            **_build_processed_metadata(
                entry,
                decision,
                admission_batch_id=admission_batch_id,
                admission_command=admission_command,
                admission_created_at=admission_created_at,
            ),
            "no_adoption_reason": "multimodal_attempts_exhausted",
        },
    )


def _mark_still_pending(
    entry: NoticeConsumptionProjectionEntry,
    decision: InternalNoticeMultimodalDecision,
    *,
    admission_batch_id: str,
    admission_command: str,
    admission_created_at: str,
) -> NoticeConsumptionProjectionEntry:
    return replace(
        entry,
        role_metadata={
            **_build_processed_metadata(
                entry,
                decision,
                admission_batch_id=admission_batch_id,
                admission_command=admission_command,
                admission_created_at=admission_created_at,
            ),
            "processing_gap_reason": _pending_gap_reason(decision),
        },
    )


def _build_processed_metadata(
    entry: NoticeConsumptionProjectionEntry,
    decision: InternalNoticeMultimodalDecision,
    *,
    admission_batch_id: str,
    admission_command: str,
    admission_created_at: str,
) -> dict[str, object]:
    metadata: dict[str, object] = {
        **dict(entry.role_metadata or {}),
        "previous_consumption_status": entry.consumption_status,
        "multimodal_processing_status": decision.action,
        "multimodal_summary": decision.summary,
        "multimodal_extracted_text": decision.extracted_text,
        "multimodal_reasons": decision.reasons,
        "multimodal_confidence": decision.confidence,
    }
    if admission_batch_id:
        metadata["consumer_admission_batch_id"] = admission_batch_id
    if admission_command:
        metadata["consumer_admission_command"] = admission_command
    if admission_created_at:
        metadata["consumer_admission_created_at"] = admission_created_at
    return metadata


def _guard_multimodal_decision(
    decision: InternalNoticeMultimodalDecision,
) -> InternalNoticeMultimodalDecision:
    summary = decision.summary.strip()
    extracted_text = decision.extracted_text.strip()
    if decision.action == "retain_for_notice_query":
        guard_reasons: list[str] = []
        if not summary and not extracted_text:
            guard_reasons.append("retain_missing_content")
        if decision.confidence == "low":
            guard_reasons.append("retain_low_confidence")
        if guard_reasons:
            return replace(
                decision,
                action="needs_additional_processing",
                reasons=tuple(dict.fromkeys((*decision.reasons, *guard_reasons))),
            )
    if decision.action == "no_adoption" and extracted_text:
        return replace(
            decision,
            action="needs_additional_processing",
            reasons=tuple(dict.fromkeys((*decision.reasons, "no_adoption_with_extracted_text"))),
        )
    return decision


def _pending_gap_reason(decision: InternalNoticeMultimodalDecision) -> str:
    reasons = set(decision.reasons)
    if {"retain_missing_content", "retain_low_confidence"} & reasons:
        return "multimodal_retain_guard_failed"
    if "no_adoption_with_extracted_text" in reasons:
        return "multimodal_no_adoption_guard_failed"
    return "multimodal_additional_processing_required"


def _build_chat_user_content(
    request: InternalNoticeMultimodalProcessingRequest,
) -> list[dict[str, object]]:
    content: list[dict[str, object]] = [
        {
            "type": "text",
            "text": (
                f"Notice id: {request.source_notice_id}\n"
                f"Unit id: {request.unit_id}\n"
                f"Notice title: {request.notice_title}\n"
                f"Primary role: {request.primary_role}\n"
                f"Prior reasons: {', '.join(request.reasons) or '<none>'}\n"
                "Assess the attached visual assets for notice-level campus QA use. "
                "Write Chinese summary and extracted_text when visible."
            ),
        }
    ]
    for attachment in request.attachments:
        if not attachment.mime_type.lower().startswith("image/"):
            continue
        content.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": _data_url(attachment.mime_type, attachment.data),
                    "detail": "high",
                },
            }
        )
    return content


def _decision_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["action", "summary", "extracted_text", "reasons", "confidence"],
        "properties": {
            "action": {
                "type": "string",
                "enum": [
                    "retain_for_notice_query",
                    "no_adoption",
                    "needs_additional_processing",
                ],
            },
            "summary": {"type": "string"},
            "extracted_text": {"type": "string"},
            "reasons": {"type": "array", "items": {"type": "string"}},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        },
    }


def _extract_chat_completions_payload(response_json: dict[str, object]) -> dict[str, object]:
    choices = response_json.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("chat completions response missing choices")
    choice = choices[0]
    if not isinstance(choice, dict):
        raise ValueError("chat completions choice must be an object")
    message = choice.get("message")
    if not isinstance(message, dict):
        raise ValueError("chat completions choice missing message")
    parsed = message.get("parsed")
    if isinstance(parsed, dict):
        return parsed
    content = message.get("content")
    if isinstance(content, str):
        payload = json.loads(content)
        if isinstance(payload, dict):
            return payload
    raise ValueError("chat completions message content must be a JSON object")


def _coerce_decision(payload: Mapping[str, object]) -> InternalNoticeMultimodalDecision:
    action = str(payload.get("action") or "").strip()
    if action not in {
        "retain_for_notice_query",
        "no_adoption",
        "needs_additional_processing",
    }:
        raise ValueError(f"unsupported multimodal action: {action or '<empty>'}")
    confidence = str(payload.get("confidence") or "").strip() or "low"
    if confidence not in {"high", "medium", "low"}:
        confidence = "low"
    return InternalNoticeMultimodalDecision(
        action=action,  # type: ignore[arg-type]
        summary=str(payload.get("summary") or "").strip(),
        extracted_text=str(payload.get("extracted_text") or "").strip(),
        reasons=tuple(
            str(item).strip() for item in (payload.get("reasons") or ()) if str(item).strip()
        ),
        confidence=confidence,  # type: ignore[arg-type]
    )


def _extract_reasons(entry: NoticeConsumptionProjectionEntry) -> tuple[str, ...]:
    raw = entry.role_metadata.get("reasons") or ()
    return tuple(str(item).strip() for item in raw if str(item).strip())


def _data_url(mime_type: str, payload: bytes) -> str:
    return f"data:{mime_type};base64,{b64encode(payload).decode('ascii')}"


def _next_attempt_number(
    attempt_store: InternalNoticeMultimodalAttemptStore | None,
    unit_id: str,
) -> int:
    if attempt_store is None:
        return 1
    return len(attempt_store.list_by_unit(unit_id)) + 1


def _record_attempt(
    *,
    attempt_store: InternalNoticeMultimodalAttemptStore | None,
    entry: NoticeConsumptionProjectionEntry,
    source_corpus: str,
    source_collection: str,
    attempt_number: int,
    admission_batch_id: str,
    model: str,
    decision_action: str,
    status: str,
    reasons: tuple[str, ...],
    error: str | None,
) -> None:
    if attempt_store is None:
        return
    attempt_store.record(
        InternalNoticeMultimodalAttempt(
            source_corpus=source_corpus,
            source_collection=source_collection,
            source_notice_id=entry.source_notice_id,
            unit_id=entry.unit_id,
            attempt_number=attempt_number,
            admission_batch_id=admission_batch_id,
            model=model,
            decision_action=decision_action,
            status=status,
            reasons=reasons,
            error=error,
            created_at=utc_now(),
        )
    )


def _processor_model_label(processor: InternalNoticeMultimodalProcessor) -> str:
    return str(getattr(processor, "_model", processor.__class__.__name__))


__all__ = [
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_MANAGEMENT_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_TABLE",
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_ATTEMPTS",
    "ChatCompletionsInternalNoticeMultimodalProcessor",
    "InMemoryInternalNoticeMultimodalAttemptStore",
    "InternalNoticeMultimodalAttachment",
    "InternalNoticeMultimodalAttempt",
    "InternalNoticeMultimodalAttemptStore",
    "InternalNoticeMultimodalDecision",
    "InternalNoticeMultimodalDrainReport",
    "InternalNoticeMultimodalItemReport",
    "InternalNoticeMultimodalObjectStore",
    "InternalNoticeMultimodalProcessingReport",
    "InternalNoticeMultimodalProcessingRequest",
    "InternalNoticeMultimodalProcessor",
    "PostgresInternalNoticeMultimodalAttemptStore",
    "build_internal_notice_multimodal_attempt_store_from_env",
    "drain_internal_notice_pending_multimodal_entries",
    "process_internal_notice_pending_multimodal_entries",
    "select_internal_notice_pending_multimodal_notice_ids",
]
