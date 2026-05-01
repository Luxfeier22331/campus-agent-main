from __future__ import annotations

from campus_ingestion_core.authenticated_notice_attachment_fetch_status import (
    DEFAULT_ATTACHMENT_FETCH_STATUS_ENV_KEY,
    DEFAULT_ATTACHMENT_FETCH_STATUS_MANAGEMENT_ENV_KEY,
    DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    DEFAULT_SOURCE_TRUTH_INVENTORY_ENV_KEY,
    DEFAULT_SOURCE_TRUTH_INVENTORY_MANAGEMENT_ENV_KEY,
    DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY,
)
from campus_ingestion_core.internal_notice_read_model import (
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_ENV_KEY,
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_MANAGEMENT_ENV_KEY,
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_OPERATOR_ENV_KEY,
)
from campus_ingestion_core.notice_consumption_projection import (
    DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY,
    DEFAULT_NOTICE_CONSUMPTION_PROJECTION_MANAGEMENT_ENV_KEY,
    DEFAULT_NOTICE_CONSUMPTION_PROJECTION_OPERATOR_ENV_KEY,
)
from campus_ingestion_core.registry import (
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    RAW_ASSET_REGISTRY_ENV_KEY,
    RAW_ASSET_REGISTRY_MANAGEMENT_ENV_KEY,
    RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY,
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
)


def env_has_inventory_store_config(env: dict[str, str]) -> bool:
    return any(
        env.get(key)
        for key in (
            DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY,
            DEFAULT_SOURCE_TRUTH_INVENTORY_MANAGEMENT_ENV_KEY,
            DEFAULT_SOURCE_TRUTH_INVENTORY_ENV_KEY,
            SHARED_POSTGRES_OPERATOR_ENV_KEY,
            SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
            SHARED_POSTGRES_ENV_KEY,
            DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
            DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY,
            DOCUMENT_REGISTRY_ENV_KEY,
            RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY,
            RAW_ASSET_REGISTRY_MANAGEMENT_ENV_KEY,
            RAW_ASSET_REGISTRY_ENV_KEY,
        )
    )


def env_has_attachment_fetch_status_config(env: dict[str, str]) -> bool:
    return any(
        env.get(key)
        for key in (
            DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY,
            DEFAULT_ATTACHMENT_FETCH_STATUS_MANAGEMENT_ENV_KEY,
            DEFAULT_ATTACHMENT_FETCH_STATUS_ENV_KEY,
            SHARED_POSTGRES_OPERATOR_ENV_KEY,
            SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
            SHARED_POSTGRES_ENV_KEY,
        )
    )


def env_has_consumption_projection_config(env: dict[str, str]) -> bool:
    return any(
        env.get(key)
        for key in (
            DEFAULT_NOTICE_CONSUMPTION_PROJECTION_OPERATOR_ENV_KEY,
            DEFAULT_NOTICE_CONSUMPTION_PROJECTION_MANAGEMENT_ENV_KEY,
            DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY,
            SHARED_POSTGRES_OPERATOR_ENV_KEY,
            SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
            SHARED_POSTGRES_ENV_KEY,
            DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
            DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY,
            DOCUMENT_REGISTRY_ENV_KEY,
        )
    )


def env_has_read_model_config(env: dict[str, str]) -> bool:
    return any(
        env.get(key)
        for key in (
            DEFAULT_INTERNAL_NOTICE_READ_MODEL_OPERATOR_ENV_KEY,
            DEFAULT_INTERNAL_NOTICE_READ_MODEL_MANAGEMENT_ENV_KEY,
            DEFAULT_INTERNAL_NOTICE_READ_MODEL_ENV_KEY,
            SHARED_POSTGRES_OPERATOR_ENV_KEY,
            SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
            SHARED_POSTGRES_ENV_KEY,
            DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
            DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY,
            DOCUMENT_REGISTRY_ENV_KEY,
        )
    )


__all__ = [
    "env_has_attachment_fetch_status_config",
    "env_has_consumption_projection_config",
    "env_has_inventory_store_config",
    "env_has_read_model_config",
]
