from __future__ import annotations

import os
import subprocess
from collections.abc import Mapping

from campus_ingestion_core.authenticated_notice_closeout_operations_retention import (
    AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX,
    CloseoutDbRunState,
)
from campus_ingestion_core.authenticated_notice_closeout_store import (
    DEFAULT_PROMOTION_TABLE,
    DEFAULT_RUN_TABLE,
)
from campus_ingestion_core.authenticated_notice_closeout_store_shared import (
    DEFAULT_CLOSEOUT_STORE_OPERATOR_ENV_KEY,
)
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    open_postgres_connection,
)
from campus_ingestion_core.registry import (
    DEFAULT_DOCUMENT_REGISTRY_TABLE,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
)


def load_closeout_db_run_states(
    env: Mapping[str, str] | None = None,
) -> dict[str, CloseoutDbRunState]:
    source = dict(env if env is not None else os.environ)
    database_url = _required_operator_database_url(
        source,
        primary_key=DEFAULT_CLOSEOUT_STORE_OPERATOR_ENV_KEY,
        label="closeout store",
    )
    query = f"""
        select
          runs.run_id,
          runs.record->>'state' as state,
          promotions.record->>'state' as promotion_state,
          promotions.record->>'phase' as promotion_phase
        from {DEFAULT_RUN_TABLE} runs
        left join {DEFAULT_PROMOTION_TABLE} promotions
          on promotions.run_id = runs.run_id
         and promotions.promotion_id = 'promotion-0001'
    """
    rows: dict[str, CloseoutDbRunState] = {}
    with (
        open_postgres_connection(build_operator_postgres_connection_url(database_url)) as conn,
        conn.cursor() as cursor,
    ):
        cursor.execute(query)
        for run_id, state, promotion_state, promotion_phase in cursor.fetchall():
            rows[str(run_id)] = CloseoutDbRunState(
                run_id=str(run_id),
                state=str(state),
                promotion_state=_normalize_optional_text(promotion_state),
                promotion_phase=_normalize_optional_text(promotion_phase),
            )
    return rows


def load_registry_referenced_closeout_run_ids(
    env: Mapping[str, str] | None = None,
    *,
    corpus: str = "campus_notices",
    collection: str = "internal_notice",
) -> frozenset[str]:
    source = dict(env if env is not None else os.environ)
    database_url = _required_operator_database_url(
        source,
        primary_key=DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
        label="document registry",
    )
    pattern = f"%{AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX}%"
    query = f"""
        select record::text
        from {DEFAULT_DOCUMENT_REGISTRY_TABLE}
        where corpus = %s
          and collection = %s
          and record::text like %s
    """
    run_ids: set[str] = set()
    with (
        open_postgres_connection(build_operator_postgres_connection_url(database_url)) as conn,
        conn.cursor() as cursor,
    ):
        cursor.execute(query, (corpus, collection, pattern))
        for (record_text,) in cursor.fetchall():
            run_ids.update(extract_closeout_run_ids_from_text(str(record_text)))
    return frozenset(run_ids)


def load_repo_referenced_closeout_run_ids(
    *,
    candidate_run_ids: set[str],
    repo_root: str = ".",
) -> frozenset[str]:
    if not candidate_run_ids:
        return frozenset()
    referenced: set[str] = set()
    for run_id in sorted(candidate_run_ids):
        completed = subprocess.run(
            [
                "rg",
                "--quiet",
                "--fixed-strings",
                run_id,
                "docs",
                ".planning",
                "packages",
                "apps",
                "tests",
            ],
            cwd=repo_root,
            check=False,
        )
        if completed.returncode == 0:
            referenced.add(run_id)
        elif completed.returncode == 1:
            continue
        else:
            raise RuntimeError(f"rg failed while checking repo references for {run_id}")
    return frozenset(referenced)


def extract_closeout_run_ids_from_text(text: str) -> frozenset[str]:
    run_ids: set[str] = set()
    start = 0
    while True:
        index = text.find(AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX, start)
        if index < 0:
            break
        suffix = text[index + len(AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX) :]
        run_id = suffix.split("/", 1)[0].strip()
        if run_id:
            run_ids.add(run_id)
        start = index + len(AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX)
    return frozenset(run_ids)


def _required_operator_database_url(
    source: Mapping[str, str],
    *,
    primary_key: str,
    label: str,
) -> str:
    database_url = (source.get(primary_key) or "").strip() or (
        source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY) or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{primary_key} or {SHARED_POSTGRES_OPERATOR_ENV_KEY} is required for {label}"
        )
    return database_url


def _normalize_optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


__all__ = [
    "extract_closeout_run_ids_from_text",
    "load_closeout_db_run_states",
    "load_registry_referenced_closeout_run_ids",
    "load_repo_referenced_closeout_run_ids",
]
