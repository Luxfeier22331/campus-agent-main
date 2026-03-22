from __future__ import annotations

from dataclasses import dataclass
import os
from urllib.parse import urlparse


DEFAULT_BUCKET_RAW = "campus-rag-raw"
DEFAULT_BUCKET_PROCESSED = "campus-rag-processed"


@dataclass(frozen=True, slots=True)
class ObjectStoreSettings:
    endpoint: str
    access_key: str
    secret_key: str
    region: str = "us-east-1"
    bucket_raw: str = DEFAULT_BUCKET_RAW
    bucket_processed: str = DEFAULT_BUCKET_PROCESSED
    secure: bool = False

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
        if not self.bucket_raw:
            raise ValueError("OBJECT_STORE_BUCKET_RAW is required")
        if not self.bucket_processed:
            raise ValueError("OBJECT_STORE_BUCKET_PROCESSED is required")

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "ObjectStoreSettings":
        source = env if env is not None else os.environ
        endpoint = (source.get("OBJECT_STORE_ENDPOINT") or "").strip()
        access_key = (source.get("OBJECT_STORE_ACCESS_KEY") or "").strip()
        secret_key = (source.get("OBJECT_STORE_SECRET_KEY") or "").strip()
        region = (source.get("OBJECT_STORE_REGION") or "us-east-1").strip() or "us-east-1"
        bucket_raw = (source.get("OBJECT_STORE_BUCKET_RAW") or DEFAULT_BUCKET_RAW).strip()
        bucket_processed = (
            source.get("OBJECT_STORE_BUCKET_PROCESSED") or DEFAULT_BUCKET_PROCESSED
        ).strip()
        secure = _parse_bool(source.get("OBJECT_STORE_SECURE"), default=False)
        return cls(
            endpoint=endpoint,
            access_key=access_key,
            secret_key=secret_key,
            region=region,
            bucket_raw=bucket_raw,
            bucket_processed=bucket_processed,
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
