from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import ALLOWED_CORPORA

from campus_ingestion_core.settings import ObjectStoreSettings


def build_raw_asset_key(
    *,
    corpus: str,
    raw_asset_id: str,
    raw_version_id: str,
    filename: str,
) -> str:
    _validate_corpus_and_filename(corpus=corpus, filename=filename)
    if not raw_asset_id:
        raise ValueError("raw_asset_id is required")
    if not raw_version_id:
        raise ValueError("raw_version_id is required")
    return "/".join(
        [
            corpus,
            "assets",
            *_raw_asset_segments(raw_asset_id),
            *_identity_segments(raw_version_id),
            filename,
        ]
    )


def build_processed_artifact_key(
    *,
    corpus: str,
    document_id: str,
    version_id: str,
    filename: str,
) -> str:
    _validate_corpus_and_filename(corpus=corpus, filename=filename)
    if not document_id:
        raise ValueError("document_id is required")
    if not version_id:
        raise ValueError("version_id is required")
    return "/".join(
        [
            corpus,
            "documents",
            *_identity_segments(document_id),
            *_identity_segments(version_id),
            filename,
        ]
    )


def build_processed_asset_artifact_key(
    *,
    corpus: str,
    raw_asset_id: str,
    raw_version_id: str,
    filename: str,
) -> str:
    _validate_corpus_and_filename(corpus=corpus, filename=filename)
    if not raw_asset_id:
        raise ValueError("raw_asset_id is required")
    if not raw_version_id:
        raise ValueError("raw_version_id is required")
    return "/".join(
        [
            corpus,
            "assets",
            *_raw_asset_segments(raw_asset_id),
            *_identity_segments(raw_version_id),
            filename,
        ]
    )


def _validate_corpus_and_filename(*, corpus: str, filename: str) -> None:
    if corpus not in ALLOWED_CORPORA:
        raise ValueError(f"unsupported corpus: {corpus}")
    if not filename or "/" in filename.strip("/"):
        raise ValueError("filename must be a single path segment")


def _identity_segments(value: str) -> tuple[str, ...]:
    normalized = value.strip()
    if not normalized:
        raise ValueError("identity value is required")
    if "/" in normalized:
        raise ValueError("identity value must not contain slash")
    segments = tuple(part.strip() for part in normalized.split(":") if part.strip())
    if not segments:
        raise ValueError("identity value is required")
    return segments


def _raw_asset_segments(raw_asset_id: str) -> tuple[str, ...]:
    segments = _identity_segments(raw_asset_id)
    if len(segments) >= 2 and segments[0] == "asset":
        return segments[1:]
    return segments


@dataclass(frozen=True, slots=True)
class S3ObjectStoreClientFactory:
    settings: ObjectStoreSettings

    def client_config(self) -> dict[str, object]:
        return {
            "endpoint_url": self.settings.endpoint,
            "region_name": self.settings.region,
            "aws_access_key_id": self.settings.access_key,
            "aws_secret_access_key": self.settings.secret_key,
            "use_ssl": self.settings.secure,
        }

    def create(self):  # pragma: no cover - exercised only when boto3 is installed
        try:
            import boto3
        except ImportError as exc:  # pragma: no cover - dependent on environment
            raise RuntimeError(
                "boto3 is required to create the S3-compatible object store client"
            ) from exc
        return boto3.client("s3", **self.client_config())
