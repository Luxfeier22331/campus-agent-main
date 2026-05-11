from __future__ import annotations

import os

from campus_ingestion_core.postgres_runtime import build_operator_postgres_connection_url
from campus_ingestion_core.registry_document_postgres import PostgresDocumentRegistry
from campus_ingestion_core.registry_raw_asset_postgres import PostgresRawAssetRegistry
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
    _ensure_table_schema,
    _optional_document_registry_operator_database_url,
    _optional_raw_asset_registry_operator_database_url,
    _postgres_connection,
    _qualified_table_sql,
    _raw_asset_record_from_dict,
    _required_document_registry_database_url,
    _required_document_registry_operator_database_url,
    _required_raw_asset_registry_database_url,
    _required_raw_asset_registry_operator_database_url,
    _table_index_suffix,
)


def build_document_registry_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> DocumentRegistry:
    source = env if env is not None else os.environ
    if prefer_operator:
        return PostgresDocumentRegistry(
            build_operator_postgres_connection_url(
                _required_document_registry_operator_database_url(source)
            )
        )
    return PostgresDocumentRegistry(_required_document_registry_database_url(source))


def build_raw_asset_registry_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> RawAssetRegistry:
    source = env if env is not None else os.environ
    if prefer_operator:
        return PostgresRawAssetRegistry(
            build_operator_postgres_connection_url(
                _required_raw_asset_registry_operator_database_url(source)
            )
        )
    return PostgresRawAssetRegistry(_required_raw_asset_registry_database_url(source))


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
    "PostgresDocumentRegistry",
    "PostgresRawAssetRegistry",
    "RawAssetRegistry",
    "_coerce_json_payload",
    "_document_record_from_dict",
    "_ensure_table_schema",
    "_optional_document_registry_operator_database_url",
    "_optional_raw_asset_registry_operator_database_url",
    "_postgres_connection",
    "_qualified_table_sql",
    "_raw_asset_record_from_dict",
    "_table_index_suffix",
    "build_document_registry_from_env",
    "build_raw_asset_registry_from_env",
]
