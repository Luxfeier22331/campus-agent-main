from __future__ import annotations

from dataclasses import dataclass
import os
from urllib.parse import urlparse


DEFAULT_BUCKET_SOURCE = "campus-rag-source"
DEFAULT_BUCKET_DERIVED = "campus-rag-derived"
DEFAULT_BUCKET_RAW = DEFAULT_BUCKET_SOURCE
DEFAULT_BUCKET_PROCESSED = DEFAULT_BUCKET_DERIVED


def resolve_object_store_bucket_names(env: dict[str, str] | None = None) -> tuple[str, str]:
    source = env if env is not None else os.environ
    bucket_source = (
        source.get("OBJECT_STORE_BUCKET_SOURCE")
        or source.get("OBJECT_STORE_BUCKET_RAW")
        or DEFAULT_BUCKET_SOURCE
    ).strip()
    bucket_derived = (
        source.get("OBJECT_STORE_BUCKET_DERIVED")
        or source.get("OBJECT_STORE_BUCKET_PROCESSED")
        or DEFAULT_BUCKET_DERIVED
    ).strip()
    return bucket_source, bucket_derived


@dataclass(frozen=True, slots=True)
class ObjectStoreSettings:
    endpoint: str
    access_key: str
    secret_key: str
    region: str = "us-east-1"
    bucket_source: str = DEFAULT_BUCKET_SOURCE
    bucket_derived: str = DEFAULT_BUCKET_DERIVED
    secure: bool = False

    @property
    def bucket_raw(self) -> str:
        return self.bucket_source

    @property
    def bucket_processed(self) -> str:
        return self.bucket_derived

    def __post_init__(self) -> None:
        parsed = urlparse(self.endpoint)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(
                "OBJECT_STORE_ENDPOINT must be an http(s) URL; local directory fallback is not allowed"
            )
        if not self.access_key:
            raise ValueError("OBJECT_STORE_ACCESS_KEY is required")
        if not self.secret_key:
            raise ValueError("OBJECT_STORE_SECRET_KEY is required")
        if not self.bucket_source:
            raise ValueError("OBJECT_STORE_BUCKET_SOURCE is required")
        if not self.bucket_derived:
            raise ValueError("OBJECT_STORE_BUCKET_DERIVED is required")

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "ObjectStoreSettings":
        source = env if env is not None else os.environ
        endpoint = (source.get("OBJECT_STORE_ENDPOINT") or "").strip()
        access_key = (source.get("OBJECT_STORE_ACCESS_KEY") or "").strip()
        secret_key = (source.get("OBJECT_STORE_SECRET_KEY") or "").strip()
        region = (source.get("OBJECT_STORE_REGION") or "us-east-1").strip() or "us-east-1"
        bucket_source, bucket_derived = resolve_object_store_bucket_names(source)
        secure = _parse_bool(source.get("OBJECT_STORE_SECURE"), default=False)
        return cls(
            endpoint=endpoint,
            access_key=access_key,
            secret_key=secret_key,
            region=region,
            bucket_source=bucket_source,
            bucket_derived=bucket_derived,
            secure=secure,
        )


def _parse_bool(value: str | None, *, default: bool) -> bool:
    if value is None or value == "":
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"invalid boolean value: {value}")
