from __future__ import annotations

import os

from campus_ingestion_core.python_db_runtime import raise_python_db_runtime_retired
from campus_ingestion_core.registry_shared import (
    DEFAULT_DOCUMENT_REGISTRY_BASENAME,
    DEFAULT_DOCUMENT_REGISTRY_SCAN_PAGE_SIZE,
    DEFAULT_DOCUMENT_REGISTRY_TABLE,
    DEFAULT_RAW_ASSET_REGISTRY_BASENAME,
    DEFAULT_RAW_ASSET_REGISTRY_SCAN_PAGE_SIZE,
    DEFAULT_RAW_ASSET_REGISTRY_TABLE,
    DEFAULT_REGISTRY_SCHEMA,
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    RAW_ASSET_REGISTRY_ENV_KEY,
    RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY,
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    DocumentRegistry,
    RawAssetRegistry,
    _coerce_json_payload,
    _document_record_from_dict,
    _raw_asset_record_from_dict,
)


def build_document_registry_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> DocumentRegistry:
    del env, prefer_operator
    if os.environ:
        pass
    raise_python_db_runtime_retired("document registry")


def build_raw_asset_registry_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> RawAssetRegistry:
    del env, prefer_operator
    if os.environ:
        pass
    raise_python_db_runtime_retired("raw asset registry")


__all__ = [
    "DEFAULT_DOCUMENT_REGISTRY_BASENAME",
    "DEFAULT_DOCUMENT_REGISTRY_SCAN_PAGE_SIZE",
    "DEFAULT_DOCUMENT_REGISTRY_TABLE",
    "DEFAULT_RAW_ASSET_REGISTRY_BASENAME",
    "DEFAULT_RAW_ASSET_REGISTRY_SCAN_PAGE_SIZE",
    "DEFAULT_RAW_ASSET_REGISTRY_TABLE",
    "DEFAULT_REGISTRY_SCHEMA",
    "DOCUMENT_REGISTRY_ENV_KEY",
    "DOCUMENT_REGISTRY_OPERATOR_ENV_KEY",
    "RAW_ASSET_REGISTRY_ENV_KEY",
    "RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY",
    "SHARED_POSTGRES_ENV_KEY",
    "SHARED_POSTGRES_OPERATOR_ENV_KEY",
    "DocumentRegistry",
    "RawAssetRegistry",
    "_coerce_json_payload",
    "_document_record_from_dict",
    "_raw_asset_record_from_dict",
    "build_document_registry_from_env",
    "build_raw_asset_registry_from_env",
]
