from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse

DEFAULT_BUCKET_SOURCE = "campus-rag-source"
DEFAULT_BUCKET_DERIVED = "campus-rag-derived"


def resolve_object_store_bucket_names(env: dict[str, str] | None = None) -> tuple[str, str]:
    source = env if env is not None else os.environ
    bucket_source = (source.get("OBJECT_STORE_BUCKET_SOURCE") or DEFAULT_BUCKET_SOURCE).strip()
    bucket_derived = (source.get("OBJECT_STORE_BUCKET_DERIVED") or DEFAULT_BUCKET_DERIVED).strip()
    return bucket_source, bucket_derived


@dataclass(frozen=True, slots=True)
class ObjectStoreSettings:
    endpoint: str
    access_key: str = ""
    secret_key: str = ""
    region: str = "us-east-1"
    bucket_source: str = DEFAULT_BUCKET_SOURCE
    bucket_derived: str = DEFAULT_BUCKET_DERIVED
    secure: bool = False
    source_access_key: str = ""
    source_secret_key: str = ""
    derived_access_key: str = ""
    derived_secret_key: str = ""

    def __post_init__(self) -> None:
        parsed = urlparse(self.endpoint)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(
                "OBJECT_STORE_ENDPOINT must be an http(s) URL; local directory fallback is not allowed"
            )
        if not self.bucket_source:
            raise ValueError("OBJECT_STORE_BUCKET_SOURCE is required")
        if not self.bucket_derived:
            raise ValueError("OBJECT_STORE_BUCKET_DERIVED is required")
        self._validate_credential_pair(
            access_key=self.access_key,
            secret_key=self.secret_key,
            access_key_name="OBJECT_STORE_ACCESS_KEY",
            secret_key_name="OBJECT_STORE_SECRET_KEY",
        )
        self._validate_credential_pair(
            access_key=self.source_access_key,
            secret_key=self.source_secret_key,
            access_key_name="OBJECT_STORE_SOURCE_ACCESS_KEY",
            secret_key_name="OBJECT_STORE_SOURCE_SECRET_KEY",
        )
        self._validate_credential_pair(
            access_key=self.derived_access_key,
            secret_key=self.derived_secret_key,
            access_key_name="OBJECT_STORE_DERIVED_ACCESS_KEY",
            secret_key_name="OBJECT_STORE_DERIVED_SECRET_KEY",
        )
        if not self.has_any_credentials:
            raise ValueError(
                "Object store credentials are required; configure shared "
                "OBJECT_STORE_ACCESS_KEY/OBJECT_STORE_SECRET_KEY or bucket-scoped "
                "OBJECT_STORE_SOURCE_* / OBJECT_STORE_DERIVED_* credential pairs"
            )

    @property
    def has_shared_credentials(self) -> bool:
        return bool(self.access_key and self.secret_key)

    @property
    def has_any_credentials(self) -> bool:
        return (
            self.has_shared_credentials
            or self.has_source_credentials
            or self.has_derived_credentials
        )

    @property
    def has_source_credentials(self) -> bool:
        return bool(self.source_access_key and self.source_secret_key)

    @property
    def has_derived_credentials(self) -> bool:
        return bool(self.derived_access_key and self.derived_secret_key)

    def credentials_for_bucket(self, bucket: str) -> tuple[str, str]:
        normalized_bucket = bucket.strip()
        if normalized_bucket == self.bucket_source and self.has_source_credentials:
            return self.source_access_key, self.source_secret_key
        if normalized_bucket == self.bucket_derived and self.has_derived_credentials:
            return self.derived_access_key, self.derived_secret_key
        if self.has_shared_credentials:
            return self.access_key, self.secret_key
        raise ValueError(f"no object-store credentials configured for bucket {normalized_bucket}")

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "ObjectStoreSettings":
        source = env if env is not None else os.environ
        endpoint = (source.get("OBJECT_STORE_ENDPOINT") or "").strip()
        access_key = (source.get("OBJECT_STORE_ACCESS_KEY") or "").strip()
        secret_key = (source.get("OBJECT_STORE_SECRET_KEY") or "").strip()
        source_access_key = (source.get("OBJECT_STORE_SOURCE_ACCESS_KEY") or "").strip()
        source_secret_key = (source.get("OBJECT_STORE_SOURCE_SECRET_KEY") or "").strip()
        derived_access_key = (source.get("OBJECT_STORE_DERIVED_ACCESS_KEY") or "").strip()
        derived_secret_key = (source.get("OBJECT_STORE_DERIVED_SECRET_KEY") or "").strip()
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
            source_access_key=source_access_key,
            source_secret_key=source_secret_key,
            derived_access_key=derived_access_key,
            derived_secret_key=derived_secret_key,
        )

    @staticmethod
    def _validate_credential_pair(
        *,
        access_key: str,
        secret_key: str,
        access_key_name: str,
        secret_key_name: str,
    ) -> None:
        has_access_key = bool(access_key)
        has_secret_key = bool(secret_key)
        if has_access_key == has_secret_key:
            return
        missing_name = secret_key_name if has_access_key else access_key_name
        raise ValueError(
            f"{access_key_name} and {secret_key_name} must be configured together; missing {missing_name}"
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
