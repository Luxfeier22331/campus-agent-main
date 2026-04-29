from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from campus_ingestion_core.campusrag_ingestion_artifacts import ProcessedArtifactInput
from campus_ingestion_core.settings import ObjectStoreSettings

_RETRYABLE_PUT_ERROR_CODES = frozenset(
    {
        "IncompleteBody",
        "InternalError",
        "RequestTimeout",
        "RequestTimeoutException",
        "SlowDown",
    }
)
_RETRYABLE_PUT_EXCEPTION_NAMES = frozenset(
    {
        "ConnectionClosedError",
        "ConnectTimeoutError",
        "EndpointConnectionError",
        "ReadTimeoutError",
    }
)
_NON_EMPTY_PUT_CLIENT_REFRESH_INTERVAL = 8


@dataclass(frozen=True, slots=True)
class PersistImportStats:
    success_count: int
    skipped_count: int
    failed_count: int
    raw_uploaded_count: int
    raw_reused_count: int
    document_ids: tuple[str, ...]
    unresolved_source_pdfs: tuple[str, ...]
    errors: tuple[str, ...]
    timestamp: str
    created_document_ids: tuple[str, ...] = ()
    updated_document_ids: tuple[str, ...] = ()
    skipped_document_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class DocumentImportInput:
    source_label: str
    document_units_bytes: bytes
    provider_response_bytes: bytes | None
    canonical_markdown_bytes: bytes | None
    metadata: dict[str, object]
    import_source: str
    revision_track: str = "source-faithful"
    source_channel: str = "pdf_ocr"
    is_current: bool = False
    corpus: str = ""
    collection: str = ""
    visibility_scope: str | None = None
    status: str = "active"
    raw_path: Path | None = None
    raw_source_uri: str | None = None
    raw_asset_id: str | None = None
    raw_version_id: str | None = None
    provider_response_object_key: str | None = None
    layout_elements_bytes: bytes | None = None
    layout_elements_object_key: str | None = None
    additional_processed_object_keys: tuple[str, ...] = field(default_factory=tuple)
    additional_processed_artifacts: tuple[ProcessedArtifactInput, ...] = field(
        default_factory=tuple
    )
    title: str | None = None
    year: str | None = None


class ObjectStoreWriter(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


class S3ObjectStoreWriter:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        from campus_ingestion_core.object_store import S3ObjectStoreClientFactory

        self._factory = S3ObjectStoreClientFactory(settings)
        self._client = self._factory.create()
        self._non_empty_put_count = 0

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        if data:
            try:
                self._put_object(
                    client=self._client,
                    bucket=bucket,
                    key=key,
                    data=data,
                    content_type=content_type,
                )
            except Exception as exc:
                if not _is_retryable_put_exception(exc):
                    raise
                self._replace_shared_client()
                self._put_object(
                    client=self._client,
                    bucket=bucket,
                    key=key,
                    data=data,
                    content_type=content_type,
                )
            self._record_successful_non_empty_put()
            return

        client = self._one_shot_client_for_zero_byte_payload()
        try:
            self._put_object(
                client=client,
                bucket=bucket,
                key=key,
                data=data,
                content_type=content_type,
            )
        finally:
            self._close_client(client)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        response = self._client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()

    def _one_shot_client_for_zero_byte_payload(self):
        # Local MinIO can stall on the next reused connection after a zero-byte put_object.
        # Isolating empty writes to a throwaway client keeps the shared client pool healthy.
        return self._factory.create()

    def _record_successful_non_empty_put(self) -> None:
        self._non_empty_put_count += 1
        if self._non_empty_put_count >= _NON_EMPTY_PUT_CLIENT_REFRESH_INTERVAL:
            self._replace_shared_client()

    def _replace_shared_client(self) -> None:
        self._close_client(self._client)
        self._client = self._factory.create()
        self._non_empty_put_count = 0

    @staticmethod
    def _put_object(
        *,
        client: object,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )

    @staticmethod
    def _close_client(client: object) -> None:
        close = getattr(client, "close", None)
        if callable(close):
            close()


def _is_retryable_put_exception(exc: BaseException) -> bool:
    response = getattr(exc, "response", None)
    if isinstance(response, dict):
        error = response.get("Error")
        if isinstance(error, dict) and error.get("Code") in _RETRYABLE_PUT_ERROR_CODES:
            return True
    return exc.__class__.__name__ in _RETRYABLE_PUT_EXCEPTION_NAMES
