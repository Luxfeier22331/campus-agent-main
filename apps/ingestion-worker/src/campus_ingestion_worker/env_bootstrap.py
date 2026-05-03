from __future__ import annotations

import os
from pathlib import Path

from campus_shared.env_bootstrap import load_repo_env


DEFAULT_LOCAL_APP_API_BASE_URL = "http://127.0.0.1:27031"


def load_worker_env(*, repo_root: Path | None = None) -> Path | None:
    loaded_path = load_repo_env(repo_root=repo_root)
    _backfill_local_app_api_callback_env()
    return loaded_path


def _backfill_local_app_api_callback_env() -> None:
    if os.environ.get("INGESTION_WORKER_APP_API_BASE_URL", "").strip():
        return
    if os.environ.get("INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET", "").strip():
        return
    app_api_internal_shared_secret = os.environ.get("APP_API_INTERNAL_SHARED_SECRET", "").strip()
    if not app_api_internal_shared_secret:
        return
    os.environ["INGESTION_WORKER_APP_API_BASE_URL"] = DEFAULT_LOCAL_APP_API_BASE_URL
    os.environ["INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET"] = (
        app_api_internal_shared_secret
    )
