from __future__ import annotations

from campus_ingestion_core.authenticated_notice_attachment_fetch_status import (
    DEFAULT_ATTACHMENT_FETCH_STATUS_ENV_KEY,
    DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY,
    AuthenticatedNoticeAttachmentFetchStatusStore,
    build_authenticated_notice_attachment_fetch_status_store_from_env,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    DEFAULT_SOURCE_TRUTH_INVENTORY_ENV_KEY,
    DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY,
    AuthenticatedNoticeSourceTruthInventoryStore,
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.internal_notice_consumption_projection import (
    NoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
)
from campus_ingestion_core.internal_notice_read_model import (
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_ENV_KEY,
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_OPERATOR_ENV_KEY,
    InternalNoticeReadModelStore,
    build_internal_notice_read_model_store_from_env,
)
from campus_ingestion_core.notice_consumption_projection import (
    DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY,
    DEFAULT_NOTICE_CONSUMPTION_PROJECTION_OPERATOR_ENV_KEY,
)
from campus_ingestion_core.registry import (
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
)


def _build_inventory_store_from_env_if_configured(
    env: dict[str, str],
    *,
    builder=build_authenticated_notice_source_truth_inventory_store_from_env,
) -> AuthenticatedNoticeSourceTruthInventoryStore | None:
    management_env_keys = (
        DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY,
        SHARED_POSTGRES_OPERATOR_ENV_KEY,
    )
    if any(env.get(key) for key in management_env_keys):
        return builder(
            env,
            prefer_operator=True,
        )
    runtime_env_keys = (
        DEFAULT_SOURCE_TRUTH_INVENTORY_ENV_KEY,
        SHARED_POSTGRES_ENV_KEY,
    )
    if any(env.get(key) for key in runtime_env_keys):
        return builder(env)
    return None


def _build_attachment_fetch_status_store_from_env_if_configured(
    env: dict[str, str],
) -> AuthenticatedNoticeAttachmentFetchStatusStore | None:
    operator_env_keys = (
        DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY,
        SHARED_POSTGRES_OPERATOR_ENV_KEY,
    )
    if any(env.get(key) for key in operator_env_keys):
        return build_authenticated_notice_attachment_fetch_status_store_from_env(
            env,
            prefer_operator=True,
        )
    runtime_env_keys = (
        DEFAULT_ATTACHMENT_FETCH_STATUS_ENV_KEY,
        SHARED_POSTGRES_ENV_KEY,
    )
    if any(env.get(key) for key in runtime_env_keys):
        return build_authenticated_notice_attachment_fetch_status_store_from_env(env)
    return None


def _build_consumption_projection_store_from_env_if_configured(
    env: dict[str, str],
) -> NoticeConsumptionProjectionStore | None:
    projection_operator_env_keys = (
        DEFAULT_NOTICE_CONSUMPTION_PROJECTION_OPERATOR_ENV_KEY,
        SHARED_POSTGRES_OPERATOR_ENV_KEY,
    )
    if any(env.get(key) for key in projection_operator_env_keys):
        return build_notice_consumption_projection_store_from_env(env, prefer_operator=True)
    projection_runtime_env_keys = (
        DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY,
        SHARED_POSTGRES_ENV_KEY,
    )
    if any(env.get(key) for key in projection_runtime_env_keys):
        return build_notice_consumption_projection_store_from_env(env)
    return None


def _build_read_model_store_from_env_if_configured(
    env: dict[str, str],
) -> InternalNoticeReadModelStore | None:
    read_model_operator_env_keys = (
        DEFAULT_INTERNAL_NOTICE_READ_MODEL_OPERATOR_ENV_KEY,
        SHARED_POSTGRES_OPERATOR_ENV_KEY,
    )
    if any(env.get(key) for key in read_model_operator_env_keys):
        return build_internal_notice_read_model_store_from_env(env, prefer_operator=True)
    read_model_runtime_env_keys = (
        DEFAULT_INTERNAL_NOTICE_READ_MODEL_ENV_KEY,
        SHARED_POSTGRES_ENV_KEY,
    )
    if any(env.get(key) for key in read_model_runtime_env_keys):
        return build_internal_notice_read_model_store_from_env(env)
    return None
