from __future__ import annotations

import hashlib
import json
import os
import re
from base64 import b64encode
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, Protocol

import httpx

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    normalize_postgres_connection_url,
)
from campus_ingestion_core.registry import (
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    _coerce_json_payload,
    _ensure_table_schema,
    _postgres_connection,
    _qualified_table_sql,
    _table_index_suffix,
)

ScheduleImageOcrConfidence = Literal["high", "medium", "low"]
ScheduleImageOcrAdmissionStatus = Literal["admitted", "rejected"]

_TIME_RE = re.compile(r"(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)")
_TEMPORAL_SCOPE_HINT_RE = re.compile(
    r"(20\d{2}年)?\d{1,2}月\d{1,2}日|"
    r"\d{1,2}月\d{1,2}日?\s*(?:至|到|-|—|~|～)\s*\d{1,2}月?\d{1,2}日?|"
    r"\d{1,2}月\d{1,2}日?起|"
    r"(?:每)?周[一二三四五六日天](?:\s*(?:至|到|-|—|~|～|、|,|，|和|及)\s*(?:周)?[一二三四五六日天])*|"
    r"星期[一二三四五六日天](?:\s*(?:至|到|-|—|~|～|、|,|，|和|及)\s*(?:星期)?[一二三四五六日天])*|"
    r"工作日|周末|每日|每天|法定节假日|节假日|寒假|暑假|假期|近期|本周"
)
_ROUTE_HINTS = (
    "海淀校区",
    "丰台校区",
    "海淀",
    "丰台",
    "地铁",
    "接驳",
    "班车",
    "通勤",
    "专车",
    "校车",
)
_GUIDE_HINTS = ("预约", "扫码", "扫一扫", "服务门户", "企业微信", "民大通", "约满即止")
DEFAULT_SCHEDULE_IMAGE_OCR_BASE_URL = "https://api.openai.com/v1"
DEFAULT_SCHEDULE_IMAGE_OCR_MAX_OUTPUT_TOKENS = 2200
DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_ENV_KEY = (
    "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_OPERATOR_ENV_KEY = (
    "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_OPERATOR_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_TABLE = (
    "ingestion_projection.internal_notice_schedule_image_ocr_attempt"
)


class ScheduleImageOcrSourceObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class ScheduleImageOcrWritableObjectStore(ScheduleImageOcrSourceObjectStore, Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


class ScheduleImageOcrProvider(Protocol):
    def process(
        self, request: ScheduleImageOcrProviderRequest
    ) -> ScheduleImageOcrProviderResult: ...


class ScheduleImageOcrAttemptStore(Protocol):
    def record(self, attempt: ScheduleImageOcrAttempt) -> None: ...


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrEvidence:
    notice_id: str
    notice_title: str
    release_time: str
    organization: str
    image_index: int
    attachment_ref_id: str
    filename: str
    mime_type: str
    byte_size: int
    sha256: str
    object_key: str
    image_use: str
    reason_codes: tuple[str, ...] = ()
    context_before: str = ""
    context_after: str = ""


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrProviderRequest:
    evidence: ScheduleImageOcrEvidence
    image_bytes: bytes


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrProviderResult:
    provider: str
    model: str
    confidence: ScheduleImageOcrConfidence
    extracted_text: str
    tables: tuple[tuple[tuple[str, ...], ...], ...] = ()
    layout_elements: tuple[Mapping[str, Any], ...] = ()
    raw_response: Mapping[str, Any] | Sequence[Any] | str | None = None


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrArtifactKeys:
    provider_response_key: str
    layout_elements_key: str
    ocr_manifest_key: str


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrAttempt:
    source_corpus: str
    source_collection: str
    source_notice_id: str
    attachment_ref_id: str
    image_index: int
    source_object_key: str
    source_sha256: str
    provider: str
    model: str
    status: str
    confidence: str
    provider_response_key: str
    layout_elements_key: str
    ocr_manifest_key: str
    admission_batch_id: str
    run_id: str
    attempt_number: int = 1
    created_at: str = ""
    error: str = ""


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrSourceArtifactWriteReport:
    status: str
    keys: ScheduleImageOcrArtifactKeys


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrDryRunItemReport:
    notice_id: str
    attachment_ref_id: str
    image_index: int
    status: str
    classification: str
    reason: str = ""


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrDryRunReport:
    run_id: str
    notice_count: int
    image_count: int
    processed_count: int
    failed_count: int
    item_reports: tuple[ScheduleImageOcrDryRunItemReport, ...]


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrChildDocument:
    document_id: str
    canonical_markdown: str
    document_units: tuple[dict[str, Any], ...]
    source_notice_id: str
    attachment_ref_id: str


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrChildDocumentArtifactReport:
    document_id: str
    canonical_markdown_object_key: str
    document_units_object_key: str
    content_hash: str


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrAdmissionDecision:
    status: ScheduleImageOcrAdmissionStatus
    reason: str
    document: ScheduleImageOcrChildDocument | None = None


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrNoticeImageReview:
    notice_id: str
    attachment_ref_id: str
    image_index: int
    admission_status: str
    admission_reason: str
    image_role: str
    rationale: str


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrNoticeReview:
    notice_id: str
    image_count: int
    admitted_schedule_image_count: int
    non_schedule_visual_count: int
    rejected_schedule_candidate_count: int
    body_schedule_candidate_count: int
    recommended_actions: tuple[str, ...]
    images: tuple[ScheduleImageOcrNoticeImageReview, ...]


class InMemoryScheduleImageOcrAttemptStore:
    def __init__(self) -> None:
        self.attempts: list[ScheduleImageOcrAttempt] = []

    def record(self, attempt: ScheduleImageOcrAttempt) -> None:
        self.attempts.append(attempt)


class PostgresScheduleImageOcrAttemptStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("internal notice schedule image OCR attempt database url is required")
        self.table_name = table_name
        self._ensure_schema()

    def record(self, attempt: ScheduleImageOcrAttempt) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                insert into {table_sql} (
                    source_corpus,
                    source_collection,
                    source_notice_id,
                    attachment_ref_id,
                    image_index,
                    attempt_number,
                    admission_batch_id,
                    provider,
                    model,
                    status,
                    confidence,
                    provider_response_key,
                    layout_elements_key,
                    ocr_manifest_key,
                    run_id,
                    error,
                    created_at,
                    record
                )
                values (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
                )
                on conflict (
                    source_corpus,
                    source_collection,
                    source_notice_id,
                    attachment_ref_id,
                    image_index,
                    attempt_number
                )
                do update set
                    admission_batch_id = excluded.admission_batch_id,
                    provider = excluded.provider,
                    model = excluded.model,
                    status = excluded.status,
                    confidence = excluded.confidence,
                    provider_response_key = excluded.provider_response_key,
                    layout_elements_key = excluded.layout_elements_key,
                    ocr_manifest_key = excluded.ocr_manifest_key,
                    run_id = excluded.run_id,
                    error = excluded.error,
                    created_at = excluded.created_at,
                    record = excluded.record
                """,
                (
                    attempt.source_corpus,
                    attempt.source_collection,
                    attempt.source_notice_id,
                    attempt.attachment_ref_id,
                    attempt.image_index,
                    attempt.attempt_number,
                    attempt.admission_batch_id,
                    attempt.provider,
                    attempt.model,
                    attempt.status,
                    attempt.confidence,
                    attempt.provider_response_key,
                    attempt.layout_elements_key,
                    attempt.ocr_manifest_key,
                    attempt.run_id,
                    attempt.error,
                    attempt.created_at,
                    json.dumps(asdict(attempt), ensure_ascii=False),
                ),
            )

    def list_by_image(
        self,
        *,
        source_notice_id: str,
        attachment_ref_id: str,
        image_index: int,
    ) -> tuple[ScheduleImageOcrAttempt, ...]:
        table_sql = _qualified_table_sql(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                select record from {table_sql}
                where source_notice_id = %s
                  and attachment_ref_id = %s
                  and image_index = %s
                order by attempt_number asc
                """,
                (source_notice_id, attachment_ref_id, image_index),
            )
            rows = cursor.fetchall()
        attempts: list[ScheduleImageOcrAttempt] = []
        for row in rows:
            payload = _coerce_json_payload(row[0])
            payload["image_index"] = int(payload.get("image_index") or 0)
            payload["attempt_number"] = int(payload.get("attempt_number") or 1)
            attempts.append(ScheduleImageOcrAttempt(**payload))
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
                    attachment_ref_id text not null,
                    image_index integer not null,
                    attempt_number integer not null,
                    admission_batch_id text not null default '',
                    provider text not null,
                    model text not null,
                    status text not null,
                    confidence text not null,
                    provider_response_key text not null,
                    layout_elements_key text not null,
                    ocr_manifest_key text not null,
                    run_id text not null default '',
                    error text not null default '',
                    created_at timestamptz not null,
                    record jsonb not null,
                    primary key (
                        source_corpus,
                        source_collection,
                        source_notice_id,
                        attachment_ref_id,
                        image_index,
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
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_admission
                on {table_sql} (source_corpus, source_collection, admission_batch_id)
                """
            )


class ChatCompletionsScheduleImageOcrProvider:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        provider: str = "openai-chat-completions",
        base_url: str = DEFAULT_SCHEDULE_IMAGE_OCR_BASE_URL,
        max_output_tokens: int = DEFAULT_SCHEDULE_IMAGE_OCR_MAX_OUTPUT_TOKENS,
        http_client: httpx.Client | None = None,
    ) -> None:
        if not api_key.strip():
            raise ValueError("schedule image OCR api_key must not be empty")
        if not model.strip():
            raise ValueError("schedule image OCR model must not be empty")
        if not provider.strip():
            raise ValueError("schedule image OCR provider must not be empty")
        if max_output_tokens <= 0:
            raise ValueError("schedule image OCR max_output_tokens must be greater than zero")
        self._api_key = api_key.strip()
        self._model = model.strip()
        self._provider = provider.strip()
        self._max_output_tokens = max_output_tokens
        self._http_client = http_client or httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(connect=10.0, read=90.0, write=10.0, pool=3.0),
            trust_env=False,
        )

    @classmethod
    def from_env(
        cls,
        env: Mapping[str, str] | None = None,
    ) -> ChatCompletionsScheduleImageOcrProvider:
        source = env if env is not None else os.environ
        api_key = (source.get("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_API_KEY") or "").strip()
        model = (source.get("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_MODEL") or "").strip()
        provider = (
            source.get("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_PROVIDER") or "openai-chat-completions"
        ).strip()
        base_url = (
            source.get("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_BASE_URL")
            or DEFAULT_SCHEDULE_IMAGE_OCR_BASE_URL
        ).strip()
        max_output_tokens = int(
            (
                source.get("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_MAX_OUTPUT_TOKENS")
                or str(DEFAULT_SCHEDULE_IMAGE_OCR_MAX_OUTPUT_TOKENS)
            ).strip()
        )
        if not api_key:
            raise ValueError("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_API_KEY is required")
        if not model:
            raise ValueError("INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_MODEL is required")
        return cls(
            api_key=api_key,
            model=model,
            provider=provider,
            base_url=base_url,
            max_output_tokens=max_output_tokens,
        )

    def process(self, request: ScheduleImageOcrProviderRequest) -> ScheduleImageOcrProviderResult:
        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Extract only visible campus transport schedule facts from the image. "
                        "Return structured JSON. Extract every visible data row, not only table "
                        "titles or headers. Return tables as row matrices. When a visible merged "
                        "cell spans multiple rows or columns, repeat that visible cell text in "
                        "each affected matrix cell. Do not infer missing route, date, or time "
                        "values from outside the image. If guide or reservation text is visible, "
                        "include it in extracted_text but do not merge it into tables."
                    ),
                },
                {
                    "role": "user",
                    "content": _build_chat_ocr_user_content(request),
                },
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "internal_notice_schedule_image_ocr",
                    "schema": _schedule_ocr_schema(),
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
        return _coerce_provider_result(
            parsed,
            provider=self._provider,
            model=self._model,
            raw_response=response_json if isinstance(response_json, dict) else parsed,
        )


def load_schedule_image_ocr_evidence_inventory(
    path: Path,
) -> tuple[ScheduleImageOcrEvidence, ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("schedule image OCR inventory must be a JSON list")
    return build_schedule_image_ocr_evidence_inventory_from_rows(
        raw for raw in payload if isinstance(raw, Mapping)
    )


def build_schedule_image_ocr_evidence_inventory_from_rows(
    rows: Iterable[Mapping[str, object]],
) -> tuple[ScheduleImageOcrEvidence, ...]:
    entries: list[ScheduleImageOcrEvidence] = []
    for raw in rows:
        object_key = _text(raw.get("object_key"))
        sha256 = _text(raw.get("sha256"))
        if not object_key or not bool(raw.get("object_exists")) or not sha256:
            continue
        entries.append(
            ScheduleImageOcrEvidence(
                notice_id=_required_text(raw, "notice_id"),
                notice_title=_text(raw.get("notice_title")),
                release_time=_text(raw.get("release_time")),
                organization=_text(raw.get("organization")),
                image_index=_int(raw.get("image_index"), default=0),
                attachment_ref_id=_attachment_ref_id(raw),
                filename=_text(raw.get("filename")),
                mime_type=_text(raw.get("mime_type")) or "application/octet-stream",
                byte_size=_int(raw.get("byte_size"), default=0),
                sha256=sha256,
                object_key=object_key,
                image_use=_text(raw.get("image_use")) or "schedule_image_candidate",
                reason_codes=tuple(
                    _text(item) for item in (raw.get("reason_codes") or ()) if _text(item)
                ),
                context_before=_text(raw.get("context_before")),
                context_after=_text(raw.get("context_after")),
            )
        )
    return tuple(entries)


def build_schedule_image_ocr_attempt_store_from_env(
    env: Mapping[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresScheduleImageOcrAttemptStore:
    source = dict(env if env is not None else os.environ)
    if prefer_operator:
        operator_database_url = _schedule_ocr_operator_database_url(source)
        if not operator_database_url:
            raise ValueError(
                f"{DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} "
                "is required when prefer_operator=True"
            )
        return PostgresScheduleImageOcrAttemptStore(
            database_url=build_operator_postgres_connection_url(operator_database_url)
        )
    database_url = _schedule_ocr_runtime_database_url(source)
    if not database_url:
        raise ValueError(
            f"{DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_ENV_KEY} or "
            f"{SHARED_POSTGRES_ENV_KEY} is required"
        )
    return PostgresScheduleImageOcrAttemptStore(database_url=database_url)


def run_schedule_image_ocr_dry_run(
    *,
    evidence_entries: Sequence[ScheduleImageOcrEvidence],
    object_store: ScheduleImageOcrSourceObjectStore,
    source_bucket: str,
    provider: ScheduleImageOcrProvider,
    output_dir: Path,
    run_id: str,
) -> ScheduleImageOcrDryRunReport:
    output_dir.mkdir(parents=True, exist_ok=True)
    item_reports: list[ScheduleImageOcrDryRunItemReport] = []
    notices = {entry.notice_id for entry in evidence_entries}
    for evidence in evidence_entries:
        try:
            image_bytes = object_store.get_bytes(bucket=source_bucket, key=evidence.object_key)
            _verify_sha256(evidence=evidence, image_bytes=image_bytes)
            result = provider.process(
                ScheduleImageOcrProviderRequest(
                    evidence=evidence,
                    image_bytes=image_bytes,
                )
            )
            image_dir = output_dir / evidence.notice_id / f"image-{evidence.image_index}"
            image_dir.mkdir(parents=True, exist_ok=True)
            _write_json(image_dir / "manifest.json", _dry_run_manifest(evidence, run_id=run_id))
            _write_json(image_dir / "ocr-result.json", _provider_result_payload(result))
            (image_dir / "text.txt").write_text(result.extracted_text, encoding="utf-8")
            _write_json(image_dir / "tables.json", {"tables": _tables_payload(result.tables)})
            classification = classify_schedule_image_ocr_result(evidence=evidence, result=result)
            item_reports.append(
                ScheduleImageOcrDryRunItemReport(
                    notice_id=evidence.notice_id,
                    attachment_ref_id=evidence.attachment_ref_id,
                    image_index=evidence.image_index,
                    status="processed",
                    classification=classification,
                )
            )
        except Exception as exc:
            item_reports.append(
                ScheduleImageOcrDryRunItemReport(
                    notice_id=evidence.notice_id,
                    attachment_ref_id=evidence.attachment_ref_id,
                    image_index=evidence.image_index,
                    status="failed",
                    classification="failed",
                    reason=str(exc),
                )
            )
    failed_count = sum(1 for item in item_reports if item.status == "failed")
    return ScheduleImageOcrDryRunReport(
        run_id=run_id,
        notice_count=len(notices),
        image_count=len(evidence_entries),
        processed_count=len(item_reports) - failed_count,
        failed_count=failed_count,
        item_reports=tuple(item_reports),
    )


def classify_schedule_image_ocr_result(
    *,
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
) -> str:
    if result.confidence == "low":
        return "low_confidence"
    combined_text = _combined_text(evidence, result)
    has_contextual_schedule_table = any(_table_has_time(table) for table in result.tables) and (
        _has_route_hint(combined_text)
    )
    if _has_schedule_table(result) or has_contextual_schedule_table:
        if evidence.image_use == "mixed_schedule_and_guide_image" or _contains_guide_hint(
            combined_text
        ):
            return "mixed_schedule_and_guide"
        return "extractable_schedule_table"
    if _has_route_hint(combined_text):
        return "route_or_boarding_only"
    return "low_confidence"


def build_schedule_image_ocr_artifact_keys(
    *,
    evidence: ScheduleImageOcrEvidence,
    provider: str,
    model: str,
) -> ScheduleImageOcrArtifactKeys:
    base = _capture_base_prefix(evidence.object_key)
    model_slug = _model_slug(provider=provider, model=model)
    return ScheduleImageOcrArtifactKeys(
        provider_response_key=f"{base}/provider/{model_slug}/provider-response.jsonl",
        layout_elements_key=f"{base}/source-truth/layout-elements.jsonl",
        ocr_manifest_key=f"{base}/source-truth/ocr-manifest.json",
    )


def write_schedule_image_ocr_source_artifacts(
    *,
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
    object_store: ScheduleImageOcrWritableObjectStore,
    source_bucket: str,
    attempt_store: ScheduleImageOcrAttemptStore,
    admission_batch_id: str,
    run_id: str,
) -> ScheduleImageOcrSourceArtifactWriteReport:
    keys = build_schedule_image_ocr_artifact_keys(
        evidence=evidence,
        provider=result.provider,
        model=result.model,
    )
    object_store.put_bytes(
        bucket=source_bucket,
        key=keys.provider_response_key,
        data=(
            json.dumps(
                _provider_response_record(evidence=evidence, result=result), ensure_ascii=False
            )
            + "\n"
        ).encode("utf-8"),
        content_type="application/x-ndjson; charset=utf-8",
    )
    object_store.put_bytes(
        bucket=source_bucket,
        key=keys.layout_elements_key,
        data=_layout_elements_jsonl(result).encode("utf-8"),
        content_type="application/x-ndjson; charset=utf-8",
    )
    object_store.put_bytes(
        bucket=source_bucket,
        key=keys.ocr_manifest_key,
        data=json.dumps(
            _source_ocr_manifest(
                evidence=evidence,
                result=result,
                keys=keys,
                admission_batch_id=admission_batch_id,
                run_id=run_id,
            ),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ).encode("utf-8"),
        content_type="application/json; charset=utf-8",
    )
    attempt_store.record(
        ScheduleImageOcrAttempt(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            source_notice_id=evidence.notice_id,
            attachment_ref_id=evidence.attachment_ref_id,
            image_index=evidence.image_index,
            source_object_key=evidence.object_key,
            source_sha256=evidence.sha256,
            provider=result.provider,
            model=result.model,
            status="stored",
            confidence=result.confidence,
            provider_response_key=keys.provider_response_key,
            layout_elements_key=keys.layout_elements_key,
            ocr_manifest_key=keys.ocr_manifest_key,
            admission_batch_id=admission_batch_id,
            run_id=run_id,
            created_at=datetime.now(UTC).isoformat(),
        )
    )
    return ScheduleImageOcrSourceArtifactWriteReport(status="stored", keys=keys)


def write_schedule_image_ocr_child_document_artifacts(
    *,
    document: ScheduleImageOcrChildDocument,
    object_store: ScheduleImageOcrWritableObjectStore,
    derived_bucket: str,
    year: str,
) -> ScheduleImageOcrChildDocumentArtifactReport:
    base_key = (
        "campus_notices/documents/internal_notice/"
        f"{document.source_notice_id}/{document.attachment_ref_id}/source-faithful/{year}"
    )
    canonical_key = f"{base_key}/canonical.md"
    units_key = f"{base_key}/document-units.jsonl"
    canonical_bytes = document.canonical_markdown.encode("utf-8")
    units_bytes = _document_units_jsonl(document.document_units).encode("utf-8")
    object_store.put_bytes(
        bucket=derived_bucket,
        key=canonical_key,
        data=canonical_bytes,
        content_type="text/markdown; charset=utf-8",
    )
    object_store.put_bytes(
        bucket=derived_bucket,
        key=units_key,
        data=units_bytes,
        content_type="application/x-ndjson; charset=utf-8",
    )
    content_hash = "sha256:" + hashlib.sha256(canonical_bytes + b"\n" + units_bytes).hexdigest()
    return ScheduleImageOcrChildDocumentArtifactReport(
        document_id=document.document_id,
        canonical_markdown_object_key=canonical_key,
        document_units_object_key=units_key,
        content_hash=content_hash,
    )


def build_schedule_image_ocr_child_document_registry_record(
    *,
    evidence: ScheduleImageOcrEvidence,
    document: ScheduleImageOcrChildDocument,
    artifact_report: ScheduleImageOcrChildDocumentArtifactReport,
    generated_at: str,
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document.document_id,
        revision_track="source-faithful",
        version_id=f"{artifact_report.content_hash}:source-faithful",
        source_uri=(
            "authenticated_notice_portal://muc_internal_portal/notices/"
            f"{evidence.notice_id}/attachments/{document.attachment_ref_id}"
        ),
        content_hash=artifact_report.content_hash,
        corpus="campus_notices",
        collection="internal_notice",
        cleaning_policy_version="authenticated_notice_schedule_image_ocr.v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp=generated_at,
        parser_version="authenticated_notice_schedule_image_ocr.v1",
        source_channel="authenticated_notice_portal",
        is_current=True,
        published_date=evidence.release_time.split(maxsplit=1)[0]
        if evidence.release_time
        else None,
        provenance_status="source_ocr_admitted",
        document_units_object_key=artifact_report.document_units_object_key,
        canonical_markdown_object_key=artifact_report.canonical_markdown_object_key,
        processed_object_keys=(
            artifact_report.canonical_markdown_object_key,
            artifact_report.document_units_object_key,
        ),
        import_source="authenticated_notice_schedule_image_ocr",
    )


def admit_schedule_image_ocr_child_document(
    *,
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
    generated_at: str,
) -> ScheduleImageOcrAdmissionDecision:
    if result.confidence == "low":
        return ScheduleImageOcrAdmissionDecision(status="rejected", reason="low_confidence")
    if not _has_time(result):
        return ScheduleImageOcrAdmissionDecision(status="rejected", reason="missing_schedule_time")
    if not _has_route_hint(_combined_text(evidence, result)):
        return ScheduleImageOcrAdmissionDecision(status="rejected", reason="missing_route_hint")
    if not _has_temporal_scope_hint(_combined_text(evidence, result)):
        return ScheduleImageOcrAdmissionDecision(status="rejected", reason="missing_temporal_scope")
    schedule_tables = tuple(table for table in result.tables if _table_has_time(table))
    if not schedule_tables:
        return ScheduleImageOcrAdmissionDecision(status="rejected", reason="missing_schedule_table")
    document = _build_child_document(
        evidence=evidence,
        result=result,
        schedule_tables=schedule_tables,
        generated_at=generated_at,
    )
    return ScheduleImageOcrAdmissionDecision(
        status="admitted",
        reason="schedule_table_admitted",
        document=document,
    )


def summarize_schedule_image_ocr_notice_review(
    *,
    items: Sequence[
        tuple[
            ScheduleImageOcrEvidence,
            ScheduleImageOcrProviderResult,
            ScheduleImageOcrAdmissionDecision,
        ]
    ],
) -> ScheduleImageOcrNoticeReview:
    if not items:
        raise ValueError("schedule image OCR notice review requires at least one item")
    notice_ids = {evidence.notice_id for evidence, _, _ in items}
    if len(notice_ids) != 1:
        raise ValueError("schedule image OCR notice review items must belong to one notice")
    image_reviews = tuple(
        _review_notice_image(evidence=evidence, result=result, decision=decision)
        for evidence, result, decision in items
    )
    admitted_count = sum(1 for image in image_reviews if image.image_role == "schedule_table")
    non_schedule_visual_count = sum(
        1 for image in image_reviews if image.image_role == "non_schedule_visual"
    )
    rejected_schedule_count = sum(
        1 for image in image_reviews if image.image_role == "schedule_candidate_rejected"
    )
    body_candidate_count = sum(
        1 for image in image_reviews if image.image_role == "body_schedule_candidate"
    )
    actions: list[str] = []
    if admitted_count:
        actions.append("write_schedule_child_documents")
    if non_schedule_visual_count:
        actions.append("skip_non_schedule_visuals")
    if rejected_schedule_count:
        actions.append("review_rejected_schedule_candidates")
    if body_candidate_count:
        actions.append("run_body_schedule_extractor")
    if not actions:
        actions.append("no_schedule_image_action")
    return ScheduleImageOcrNoticeReview(
        notice_id=next(iter(notice_ids)),
        image_count=len(image_reviews),
        admitted_schedule_image_count=admitted_count,
        non_schedule_visual_count=non_schedule_visual_count,
        rejected_schedule_candidate_count=rejected_schedule_count,
        body_schedule_candidate_count=body_candidate_count,
        recommended_actions=tuple(actions),
        images=image_reviews,
    )


def _build_child_document(
    *,
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
    schedule_tables: tuple[tuple[tuple[str, ...], ...], ...],
    generated_at: str,
) -> ScheduleImageOcrChildDocument:
    attachment_ref_id = normalize_schedule_image_ocr_attachment_ref_id(evidence.attachment_ref_id)
    document_id = (
        "notice_attachment:muc_internal_portal:"
        f"{evidence.notice_id}:{attachment_ref_id}:schedule-ocr"
    )
    table_context_lines = _schedule_table_context_lines(result)
    markdown_parts = [
        f"# {evidence.notice_title}",
        "",
        f"- notice_id: `{evidence.notice_id}`",
        f"- attachment_ref_id: `{attachment_ref_id}`",
        f"- generated_at: `{generated_at}`",
        f"- ocr_provider: `{result.provider}`",
        f"- ocr_model: `{result.model}`",
        "",
    ]
    if table_context_lines:
        markdown_parts.extend(table_context_lines)
        markdown_parts.append("")
    document_units: list[dict[str, Any]] = []
    for index, table in enumerate(schedule_tables, start=1):
        markdown_parts.append(f"## Schedule table {index}")
        markdown_parts.append("")
        markdown_parts.extend(_markdown_table(table))
        markdown_parts.append("")
        document_units.append(
            {
                "unit_id": f"{document_id}:table-{index}",
                "unit_type": "table_unit",
                "source_notice_id": evidence.notice_id,
                "source_attachment_ref_id": attachment_ref_id,
                "clean_text": _table_unit_clean_text(
                    context_lines=table_context_lines,
                    table=table,
                ),
                "table_cells": _tables_payload((table,))[0],
                "metadata": {
                    "source": "authenticated_notice_schedule_image_ocr",
                    "confidence": result.confidence,
                    "image_index": evidence.image_index,
                    "context_lines": list(table_context_lines),
                },
            }
        )
    return ScheduleImageOcrChildDocument(
        document_id=document_id,
        canonical_markdown="\n".join(markdown_parts).rstrip() + "\n",
        document_units=tuple(document_units),
        source_notice_id=evidence.notice_id,
        attachment_ref_id=attachment_ref_id,
    )


def _schedule_table_context_lines(result: ScheduleImageOcrProviderResult) -> tuple[str, ...]:
    lines: list[str] = []
    for raw_line in str(result.extracted_text or "").splitlines():
        line = _clean_context_line(raw_line)
        if not line:
            continue
        if any(hint in line for hint in _GUIDE_HINTS):
            continue
        if "表" not in line:
            continue
        if not any(hint in line for hint in ("班次", "时刻", "发车", "通勤", "接驳")):
            continue
        lines.append(line)
    return tuple(dict.fromkeys(lines))


def _table_unit_clean_text(
    *,
    context_lines: Sequence[str],
    table: Sequence[Sequence[str]],
) -> str:
    table_lines = tuple(
        " | ".join(str(cell or "").strip() for cell in row if str(cell or "").strip())
        for row in table
        if row
    )
    return "\n".join([*context_lines, *table_lines]).strip()


def _clean_context_line(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _review_notice_image(
    *,
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
    decision: ScheduleImageOcrAdmissionDecision,
) -> ScheduleImageOcrNoticeImageReview:
    if decision.status == "admitted":
        return ScheduleImageOcrNoticeImageReview(
            notice_id=evidence.notice_id,
            attachment_ref_id=evidence.attachment_ref_id,
            image_index=evidence.image_index,
            admission_status=decision.status,
            admission_reason=decision.reason,
            image_role="schedule_table",
            rationale="admitted schedule OCR child document",
        )
    combined_text = _combined_text(evidence, result)
    visual_text = result.extracted_text or combined_text
    if _looks_like_non_schedule_visual(visual_text):
        return ScheduleImageOcrNoticeImageReview(
            notice_id=evidence.notice_id,
            attachment_ref_id=evidence.attachment_ref_id,
            image_index=evidence.image_index,
            admission_status=decision.status,
            admission_reason=decision.reason,
            image_role="non_schedule_visual",
            rationale="image appears to be a route map, boarding point photo, QR code, or guide",
        )
    if _looks_like_body_schedule_candidate(evidence):
        return ScheduleImageOcrNoticeImageReview(
            notice_id=evidence.notice_id,
            attachment_ref_id=evidence.attachment_ref_id,
            image_index=evidence.image_index,
            admission_status=decision.status,
            admission_reason=decision.reason,
            image_role="body_schedule_candidate",
            rationale="notice text contains explicit schedule times but image OCR has no table",
        )
    return ScheduleImageOcrNoticeImageReview(
        notice_id=evidence.notice_id,
        attachment_ref_id=evidence.attachment_ref_id,
        image_index=evidence.image_index,
        admission_status=decision.status,
        admission_reason=decision.reason,
        image_role="schedule_candidate_rejected",
        rationale="schedule candidate remains rejected after OCR admission checks",
    )


def _looks_like_non_schedule_visual(text: str) -> bool:
    compact_text = _compact(text)
    visual_hints = (
        "实景图",
        "路线图",
        "二维码",
        "乘车点",
        "乘车区",
        "上下车点",
        "候车区",
        "扫一扫",
        "扫码",
        "步行",
        "公共交通",
        "国家开放大学",
    )
    return any(hint in compact_text for hint in visual_hints) and not _TIME_RE.search(text)


def _looks_like_body_schedule_candidate(evidence: ScheduleImageOcrEvidence) -> bool:
    text = "\n".join((evidence.notice_title, evidence.context_before, evidence.context_after))
    if "专车" not in text:
        return False
    return bool(re.search(r"第[一二三四五六七八九十]+班\s*([01]?\d|2[0-3])[:：][0-5]\d", text))


def _required_text(raw: Mapping[str, Any], key: str) -> str:
    value = _text(raw.get(key))
    if not value:
        raise ValueError(f"schedule image OCR inventory row missing {key}")
    return value


def _schedule_ocr_operator_database_url(source: Mapping[str, str]) -> str:
    return (
        source.get(DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_OPERATOR_ENV_KEY)
        or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
        or ""
    ).strip()


def _schedule_ocr_runtime_database_url(source: Mapping[str, str]) -> str:
    return (
        source.get(DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or ""
    ).strip()


def _text(value: object) -> str:
    return str(value or "").strip()


def _int(value: object, *, default: int) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _attachment_ref_id(raw: Mapping[str, Any]) -> str:
    value = _text(raw.get("attachment_ref_id"))
    if value:
        return normalize_schedule_image_ocr_attachment_ref_id(value)
    attachment_id = _text(raw.get("attachment_id"))
    if attachment_id:
        return normalize_schedule_image_ocr_attachment_ref_id(f"attachment-{attachment_id}")
    return f"image-{_int(raw.get('image_index'), default=0)}"


def normalize_schedule_image_ocr_attachment_ref_id(value: object) -> str:
    text = _text(value)
    match = re.fullmatch(r"attachment-(\d+)", text)
    if match is None:
        return text
    return f"attachment-{int(match.group(1)):04d}"


def _verify_sha256(*, evidence: ScheduleImageOcrEvidence, image_bytes: bytes) -> None:
    digest = hashlib.sha256(image_bytes).hexdigest()
    if digest != evidence.sha256:
        raise ValueError(
            "schedule image OCR source sha256 mismatch: "
            f"notice_id={evidence.notice_id} image_index={evidence.image_index}"
        )


def _dry_run_manifest(evidence: ScheduleImageOcrEvidence, *, run_id: str) -> dict[str, Any]:
    payload = asdict(evidence)
    payload["run_id"] = run_id
    payload["source_corpus"] = "campus_notices"
    payload["source_collection"] = "internal_notice"
    return payload


def _provider_result_payload(result: ScheduleImageOcrProviderResult) -> dict[str, Any]:
    return {
        "provider": result.provider,
        "model": result.model,
        "confidence": result.confidence,
        "extracted_text": result.extracted_text,
        "tables": _tables_payload(result.tables),
        "layout_elements": [dict(item) for item in result.layout_elements],
        "raw_response": result.raw_response,
    }


def _provider_response_record(
    *,
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
) -> dict[str, Any]:
    return {
        "notice_id": evidence.notice_id,
        "attachment_ref_id": evidence.attachment_ref_id,
        "image_index": evidence.image_index,
        "source_object_key": evidence.object_key,
        "source_sha256": evidence.sha256,
        "provider": result.provider,
        "model": result.model,
        "confidence": result.confidence,
        "raw_response": result.raw_response,
        "extracted_text": result.extracted_text,
        "tables": _tables_payload(result.tables),
    }


def _build_chat_ocr_user_content(
    request: ScheduleImageOcrProviderRequest,
) -> list[dict[str, object]]:
    evidence = request.evidence
    return [
        {
            "type": "text",
            "text": (
                f"Notice id: {evidence.notice_id}\n"
                f"Notice title: {evidence.notice_title}\n"
                f"Release time: {evidence.release_time}\n"
                f"Organization: {evidence.organization}\n"
                f"Image use candidate: {evidence.image_use}\n"
                f"Context before: {evidence.context_before}\n"
                f"Context after: {evidence.context_after}\n"
                "Extract visible transport timetable text and tables. Include all readable "
                "body rows. If the image contains a timetable table, tables must include the "
                "header row plus body rows with departure times."
            ),
        },
        {
            "type": "image_url",
            "image_url": {
                "url": _data_url(evidence.mime_type, request.image_bytes),
                "detail": "high",
            },
        },
    ]


def _data_url(mime_type: str, data: bytes) -> str:
    return f"data:{mime_type};base64,{b64encode(data).decode('ascii')}"


def _schedule_ocr_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["confidence", "extracted_text", "tables", "layout_elements"],
        "properties": {
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            "extracted_text": {"type": "string"},
            "tables": {
                "type": "array",
                "items": {
                    "type": "array",
                    "items": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
            },
            "layout_elements": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": True,
                },
            },
        },
    }


def _extract_chat_completions_payload(response_json: object) -> dict[str, object]:
    if not isinstance(response_json, dict):
        raise ValueError("schedule image OCR response must be a JSON object")
    choices = response_json.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("schedule image OCR response missing choices")
    choice = choices[0]
    if not isinstance(choice, dict):
        raise ValueError("schedule image OCR choice must be an object")
    message = choice.get("message")
    if not isinstance(message, dict):
        raise ValueError("schedule image OCR choice missing message")
    parsed = message.get("parsed")
    if isinstance(parsed, dict):
        return parsed
    content = message.get("content")
    if isinstance(content, str):
        payload = json.loads(content)
        if isinstance(payload, dict):
            return payload
    raise ValueError("schedule image OCR message content must be a JSON object")


def _coerce_provider_result(
    payload: Mapping[str, object],
    *,
    provider: str,
    model: str,
    raw_response: Mapping[str, Any] | Sequence[Any] | str | None,
) -> ScheduleImageOcrProviderResult:
    confidence = str(payload.get("confidence") or "").strip()
    extracted_text = _coerce_extracted_text(payload.get("extracted_text"))
    tables = _coerce_tables(payload.get("tables"))
    if confidence not in {"high", "medium", "low"}:
        confidence = "medium" if tables else "low"
    layout_elements = tuple(
        dict(item) for item in (payload.get("layout_elements") or ()) if isinstance(item, dict)
    )
    return ScheduleImageOcrProviderResult(
        provider=provider,
        model=model,
        confidence=confidence,  # type: ignore[arg-type]
        extracted_text=extracted_text,
        tables=tables,
        layout_elements=layout_elements,
        raw_response=raw_response,
    )


def _coerce_extracted_text(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list | tuple):
        return "\n".join(str(item or "").strip() for item in value if str(item or "").strip())
    return str(value or "").strip()


def _coerce_tables(value: object) -> tuple[tuple[tuple[str, ...], ...], ...]:
    if not isinstance(value, list | tuple):
        return ()
    tables: list[tuple[tuple[str, ...], ...]] = []
    for raw_table in value:
        if isinstance(raw_table, dict):
            table_rows = _coerce_table_object(raw_table)
            if table_rows:
                tables.append(tuple(table_rows))
            continue
        if not isinstance(raw_table, list | tuple):
            continue
        rows: list[tuple[str, ...]] = []
        for raw_row in raw_table:
            if isinstance(raw_row, list | tuple):
                rows.append(tuple(_cell_text(cell) for cell in raw_row))
        if rows:
            tables.append(tuple(rows))
    return tuple(tables)


def _coerce_table_object(raw_table: Mapping[str, object]) -> list[tuple[str, ...]]:
    columns = raw_table.get("columns") or raw_table.get("headers")
    rows_value = raw_table.get("rows")
    table_rows: list[tuple[str, ...]] = []
    target_width = 0
    if isinstance(columns, list | tuple):
        header = tuple(_cell_text(cell) for cell in columns)
        table_rows.append(header)
        target_width = len(header)
    headers = table_rows[0] if table_rows else ()
    if isinstance(rows_value, list | tuple):
        if _is_dict_table_rows(rows_value):
            table_rows.extend(_coerce_dict_rows(rows_value, headers=headers))
        else:
            table_rows.extend(_coerce_table_rows(rows_value, target_width=target_width))
    cells_value = raw_table.get("cells")
    if not rows_value and isinstance(cells_value, list | tuple):
        table_rows.extend(_coerce_cells_value(cells_value, headers=headers))
    row_groups = raw_table.get("row_groups")
    if not rows_value and not cells_value and isinstance(row_groups, list | tuple):
        table_rows.extend(_coerce_row_groups(row_groups, headers=headers))
    return table_rows


def _is_dict_table_rows(rows_value: Sequence[object]) -> bool:
    return any(isinstance(row, Mapping) and "cells" not in row for row in rows_value)


def _coerce_dict_rows(
    raw_rows: Sequence[object],
    *,
    headers: Sequence[str],
) -> list[tuple[str, ...]]:
    if not headers:
        return []
    rows: list[tuple[str, ...]] = []
    previous: list[str] = [""] * len(headers)
    for raw_row in raw_rows:
        if not isinstance(raw_row, Mapping):
            continue
        row: list[str] = []
        for index, header in enumerate(headers):
            value = _cell_text(raw_row.get(header))
            if not value and _should_fill_down_header(header):
                value = previous[index]
            row.append(value)
        if any(row):
            rows.append(tuple(row))
            previous = row
    return rows


def _coerce_cells_value(
    cells_value: Sequence[object],
    *,
    headers: Sequence[str],
) -> list[tuple[str, ...]]:
    if not cells_value:
        return []
    if all(isinstance(row, list | tuple) for row in cells_value):
        return _coerce_table_rows(cells_value, target_width=len(headers))
    if any(isinstance(cell, Mapping) and _has_position(cell) for cell in cells_value):
        return _coerce_positioned_cells(cells_value, headers=headers)
    return []


def _coerce_positioned_cells(
    cells_value: Sequence[object],
    *,
    headers: Sequence[str],
) -> list[tuple[str, ...]]:
    if not headers:
        return []
    rows: dict[int, dict[int, str]] = {}
    for raw_cell in cells_value:
        if not isinstance(raw_cell, Mapping):
            continue
        row_index = _position_index(raw_cell.get("row"))
        column_index = _column_index(raw_cell, headers=headers)
        if row_index is None or column_index is None:
            continue
        text = _cell_text(raw_cell)
        row_span = _span_value(raw_cell, "rowspan")
        col_span = _span_value(raw_cell, "colspan")
        for row_offset in range(row_span):
            row = rows.setdefault(row_index + row_offset, {})
            for col_offset in range(col_span):
                row[column_index + col_offset] = text
    if not rows:
        return []
    body_rows: list[tuple[str, ...]] = []
    width = len(headers)
    previous: list[str] = [""] * width
    for row_index in sorted(rows):
        raw_row = rows[row_index]
        row = [raw_row.get(index, "") for index in range(width)]
        if tuple(row) == tuple(headers):
            continue
        row = [
            value or (previous[index] if _should_fill_down_header(headers[index]) else "")
            for index, value in enumerate(row)
        ]
        if any(row):
            body_rows.append(tuple(row))
            previous = row
    return body_rows


def _coerce_row_groups(
    row_groups: Sequence[object],
    *,
    headers: Sequence[str],
) -> list[tuple[str, ...]]:
    if not headers:
        return []
    rows: list[tuple[str, ...]] = []
    for group in row_groups:
        if isinstance(group, Mapping):
            rows.extend(_coerce_row_group(group, headers=headers, inherited={}))
    return rows


def _coerce_row_group(
    group: Mapping[str, object],
    *,
    headers: Sequence[str],
    inherited: Mapping[str, str],
) -> list[tuple[str, ...]]:
    context = dict(inherited)
    for key, value in group.items():
        if key == "rows" or key.endswith("_groups"):
            continue
        if key in headers:
            context[key] = _cell_text(value)
    rows: list[tuple[str, ...]] = []
    raw_rows = group.get("rows")
    if isinstance(raw_rows, list | tuple):
        for raw_row in raw_rows:
            if not isinstance(raw_row, Mapping):
                continue
            merged = dict(context)
            merged.update({key: _cell_text(value) for key, value in raw_row.items()})
            rows.append(tuple(merged.get(header, "") for header in headers))
    for key, value in group.items():
        if not key.endswith("_groups") or not isinstance(value, list | tuple):
            continue
        for nested_group in value:
            if isinstance(nested_group, Mapping):
                rows.extend(_coerce_row_group(nested_group, headers=headers, inherited=context))
    return rows


def _coerce_table_rows(
    raw_rows: Sequence[object],
    *,
    target_width: int,
) -> list[tuple[str, ...]]:
    rows: list[tuple[str, ...]] = []
    active_rowspans: dict[int, tuple[str, int]] = {}
    for raw_row in raw_rows:
        raw_cells = _row_cells(raw_row)
        if raw_cells is None:
            continue
        row, active_rowspans = _coerce_table_row(
            raw_cells,
            active_rowspans=active_rowspans,
            target_width=target_width,
        )
        if row:
            rows.append(row)
            target_width = max(target_width, len(row))
    return rows


def _row_cells(raw_row: object) -> Sequence[object] | None:
    if isinstance(raw_row, Mapping):
        cells = raw_row.get("cells")
        if isinstance(cells, list | tuple):
            return cells
        return None
    if isinstance(raw_row, list | tuple):
        return raw_row
    return None


def _coerce_table_row(
    raw_cells: Sequence[object],
    *,
    active_rowspans: Mapping[int, tuple[str, int]],
    target_width: int,
) -> tuple[tuple[str, ...], dict[int, tuple[str, int]]]:
    row: list[str] = []
    next_rowspans: dict[int, tuple[str, int]] = {}
    new_rowspans: dict[int, tuple[str, int]] = {}
    filled_active_columns: set[int] = set()
    column_index = 0

    def fill_active_cell() -> bool:
        nonlocal column_index
        active = active_rowspans.get(column_index)
        if active is None:
            return False
        text, remaining = active
        row.append(text)
        filled_active_columns.add(column_index)
        if remaining > 1:
            next_rowspans[column_index] = (text, remaining - 1)
        column_index += 1
        return True

    for raw_cell in raw_cells:
        while fill_active_cell():
            continue
        text = _cell_text(raw_cell)
        colspan = _span_value(raw_cell, "colspan")
        rowspan = _span_value(raw_cell, "rowspan")
        for span_offset in range(colspan):
            current_column = column_index + span_offset
            row.append(text)
            if rowspan > 1:
                new_rowspans[current_column] = (text, rowspan - 1)
        column_index += colspan

    width = max(target_width, column_index, max(active_rowspans, default=-1) + 1)
    while column_index < width:
        if not fill_active_cell():
            row.append("")
            column_index += 1

    for column, (text, remaining) in active_rowspans.items():
        if column not in filled_active_columns and remaining > 1:
            next_rowspans[column] = (text, remaining - 1)
    next_rowspans.update(new_rowspans)
    return tuple(row), next_rowspans


def _span_value(value: object, key: str) -> int:
    if not isinstance(value, Mapping):
        return 1
    aliases = {
        "rowspan": ("rowspan", "row_span"),
        "colspan": ("colspan", "col_span"),
    }
    try:
        span = int(
            next((value.get(alias) for alias in aliases.get(key, (key,)) if value.get(alias)), 1)
        )
    except (TypeError, ValueError):
        span = 1
    return max(1, span)


def _has_position(value: Mapping[str, object]) -> bool:
    return "row" in value and ("column" in value or "col" in value)


def _position_index(value: object) -> int | None:
    try:
        index = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return max(0, index)


def _column_index(value: Mapping[str, object], *, headers: Sequence[str]) -> int | None:
    raw_column = value.get("column", value.get("col"))
    if isinstance(raw_column, str) and raw_column in headers:
        return list(headers).index(raw_column)
    try:
        index = int(raw_column)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if index <= 0:
        return 0
    return index - 1


def _should_fill_down_header(header: str) -> bool:
    compact_header = _compact(header)
    return compact_header in {
        "日期",
        "星期",
        "线路",
        "路线",
        "运行方向",
        "发车地点",
        "备注",
    }


def _cell_text(value: object) -> str:
    if isinstance(value, dict):
        return str(value.get("text") or "").strip()
    return str(value or "").strip()


def _source_ocr_manifest(
    *,
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
    keys: ScheduleImageOcrArtifactKeys,
    admission_batch_id: str,
    run_id: str,
) -> dict[str, Any]:
    return {
        "schema_version": "authenticated_notice_schedule_image_ocr_manifest.v1",
        "source_corpus": "campus_notices",
        "source_collection": "internal_notice",
        "source_notice_id": evidence.notice_id,
        "attachment_ref_id": evidence.attachment_ref_id,
        "image_index": evidence.image_index,
        "source_object_key": evidence.object_key,
        "source_sha256": evidence.sha256,
        "provider": result.provider,
        "model": result.model,
        "confidence": result.confidence,
        "provider_response_key": keys.provider_response_key,
        "layout_elements_key": keys.layout_elements_key,
        "ocr_manifest_key": keys.ocr_manifest_key,
        "admission_batch_id": admission_batch_id,
        "run_id": run_id,
    }


def _layout_elements_jsonl(result: ScheduleImageOcrProviderResult) -> str:
    rows = [dict(item) for item in result.layout_elements]
    if not rows:
        rows = [
            {
                "type": "text",
                "text": result.extracted_text,
                "confidence": result.confidence,
            }
        ]
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)


def _document_units_jsonl(rows: Sequence[Mapping[str, Any]]) -> str:
    return "".join(json.dumps(dict(row), ensure_ascii=False) + "\n" for row in rows)


def _tables_payload(
    tables: Sequence[Sequence[Sequence[str]]],
) -> list[list[list[str]]]:
    return [[[str(cell or "").strip() for cell in row] for row in table] for table in tables]


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def _capture_base_prefix(object_key: str) -> str:
    marker = "/capture/"
    if marker not in object_key:
        raise ValueError(f"schedule image OCR object key is not a capture key: {object_key}")
    return object_key.split(marker, maxsplit=1)[0]


def _model_slug(*, provider: str, model: str) -> str:
    if not provider.strip():
        raise ValueError("schedule image OCR provider is required")
    if not model.strip():
        raise ValueError("schedule image OCR model is required")
    raw = f"{provider}__{model}"
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", raw.strip()).strip("-").lower()
    if not slug:
        raise ValueError("schedule image OCR provider/model slug is empty")
    return slug


def _has_schedule_table(result: ScheduleImageOcrProviderResult) -> bool:
    return any(_table_has_time(table) and _table_has_route(table) for table in result.tables)


def _has_time(result: ScheduleImageOcrProviderResult) -> bool:
    if _TIME_RE.search(result.extracted_text):
        return True
    return any(_table_has_time(table) for table in result.tables)


def _table_has_time(table: Sequence[Sequence[str]]) -> bool:
    return any(_TIME_RE.search(str(cell or "")) for row in table for cell in row)


def _table_has_route(table: Sequence[Sequence[str]]) -> bool:
    text = _compact(" ".join(str(cell or "") for row in table for cell in row))
    return any(hint in text for hint in _ROUTE_HINTS)


def _has_route_hint(text: str) -> bool:
    compact = _compact(text)
    return any(hint in compact for hint in _ROUTE_HINTS)


def _has_temporal_scope_hint(text: str) -> bool:
    return bool(_TEMPORAL_SCOPE_HINT_RE.search(text))


def _contains_guide_hint(text: str) -> bool:
    return any(hint in text for hint in _GUIDE_HINTS)


def _combined_text(
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
) -> str:
    table_text = "\n".join(
        " ".join(str(cell or "") for cell in row) for table in result.tables for row in table
    )
    return "\n".join(
        (
            evidence.notice_title,
            evidence.context_before,
            result.extracted_text,
            table_text,
            evidence.context_after,
        )
    )


def _compact(value: str) -> str:
    return "".join(str(value or "").split())


def _markdown_table(table: Sequence[Sequence[str]]) -> list[str]:
    if not table:
        return []
    width = max((len(row) for row in table), default=0)
    rows = [[str(cell or "").strip() for cell in row] for row in table]
    rows = [row + [""] * (width - len(row)) for row in rows]
    header = rows[0]
    body = rows[1:]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in body)
    return lines


__all__ = [
    "DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_OPERATOR_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_TABLE",
    "DEFAULT_SCHEDULE_IMAGE_OCR_BASE_URL",
    "DEFAULT_SCHEDULE_IMAGE_OCR_MAX_OUTPUT_TOKENS",
    "ChatCompletionsScheduleImageOcrProvider",
    "InMemoryScheduleImageOcrAttemptStore",
    "PostgresScheduleImageOcrAttemptStore",
    "ScheduleImageOcrAdmissionDecision",
    "ScheduleImageOcrArtifactKeys",
    "ScheduleImageOcrAttempt",
    "ScheduleImageOcrAttemptStore",
    "ScheduleImageOcrChildDocument",
    "ScheduleImageOcrChildDocumentArtifactReport",
    "ScheduleImageOcrConfidence",
    "ScheduleImageOcrDryRunItemReport",
    "ScheduleImageOcrDryRunReport",
    "ScheduleImageOcrEvidence",
    "ScheduleImageOcrNoticeImageReview",
    "ScheduleImageOcrNoticeReview",
    "ScheduleImageOcrProvider",
    "ScheduleImageOcrProviderRequest",
    "ScheduleImageOcrProviderResult",
    "ScheduleImageOcrSourceArtifactWriteReport",
    "ScheduleImageOcrSourceObjectStore",
    "ScheduleImageOcrWritableObjectStore",
    "admit_schedule_image_ocr_child_document",
    "build_schedule_image_ocr_artifact_keys",
    "build_schedule_image_ocr_attempt_store_from_env",
    "build_schedule_image_ocr_child_document_registry_record",
    "build_schedule_image_ocr_evidence_inventory_from_rows",
    "classify_schedule_image_ocr_result",
    "load_schedule_image_ocr_evidence_inventory",
    "normalize_schedule_image_ocr_attachment_ref_id",
    "run_schedule_image_ocr_dry_run",
    "summarize_schedule_image_ocr_notice_review",
    "write_schedule_image_ocr_child_document_artifacts",
    "write_schedule_image_ocr_source_artifacts",
]
