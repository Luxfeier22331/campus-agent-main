from __future__ import annotations

import os
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass

from campus_ingestion_core.authenticated_notice_source_run_retention import (
    AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX,
)
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    open_postgres_connection,
)
from campus_ingestion_core.registry import SHARED_POSTGRES_OPERATOR_ENV_KEY


@dataclass(frozen=True, slots=True)
class SourceRunReferenceQuery:
    table_name: str
    text_expressions: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.table_name:
            raise ValueError("table_name is required")
        if not self.text_expressions:
            raise ValueError("text_expressions must not be empty")


CURRENT_SOURCE_RUN_REFERENCE_QUERIES = (
    SourceRunReferenceQuery(
        table_name="ingestion_queue.notice_ingest_jobs",
        text_expressions=(
            "capture_manifest_object_ref::text",
            "source_object_refs::text",
            "job_payload::text",
            "run_id::text",
            "capture_id::text",
        ),
    ),
    SourceRunReferenceQuery(
        table_name="ingestion_registry.document_registry_records",
        text_expressions=("record::text",),
    ),
    SourceRunReferenceQuery(
        table_name="ingestion_registry.raw_asset_registry_records",
        text_expressions=("record::text",),
    ),
    SourceRunReferenceQuery(
        table_name="ingestion_projection.authenticated_notice_collector_run",
        text_expressions=(
            "run_id::text",
            "bundle_object_key::text",
            "manifest_object_key::text",
            "record::text",
        ),
    ),
    SourceRunReferenceQuery(
        table_name="ingestion_projection.authenticated_notice_file_release_inventory",
        text_expressions=("released_file_object_key::text", "record::text"),
    ),
    SourceRunReferenceQuery(
        table_name="ingestion_projection.authenticated_notice_source_truth_inventory",
        text_expressions=(
            "notice_manifest_key::text",
            "content_blocks_key::text",
            "attachment_refs_key::text",
            "record::text",
        ),
    ),
    SourceRunReferenceQuery(
        table_name="operator.authenticated_notice_processing_projection",
        text_expressions=(
            "run_id::text",
            "job_id::text",
            "downstream_json::text",
            "timeline_json::text",
        ),
    ),
    SourceRunReferenceQuery(
        table_name="operator.authenticated_notice_run_processing_projection",
        text_expressions=(
            "run_id::text",
            "source_truth_json::text",
            "downstream_json::text",
            "job_summaries_json::text",
            "timeline_json::text",
        ),
    ),
)


def load_db_referenced_source_run_ids(
    *,
    candidate_run_ids: set[str],
    env: Mapping[str, str] | None = None,
) -> frozenset[str]:
    if not candidate_run_ids:
        return frozenset()
    source = dict(env if env is not None else os.environ)
    database_url = (source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY) or "").strip()
    if not database_url:
        raise ValueError(f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} is required")
    pattern = f"%{AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX}%"
    run_ids: set[str] = set()
    with (
        open_postgres_connection(build_operator_postgres_connection_url(database_url)) as conn,
        conn.cursor() as cursor,
    ):
        for query in CURRENT_SOURCE_RUN_REFERENCE_QUERIES:
            where_clause = " or ".join(f"{expr} like %s" for expr in query.text_expressions)
            select_clause = " || '\n' || ".join(
                f"coalesce({expr}, '')" for expr in query.text_expressions
            )
            cursor.execute(
                f"select {select_clause} from {query.table_name} where {where_clause}",
                tuple(pattern for _ in query.text_expressions),
            )
            for (record_text,) in cursor.fetchall():
                run_ids.update(extract_source_run_ids_from_text(str(record_text)))
    return frozenset(run_ids & candidate_run_ids)


def load_repo_referenced_source_run_ids(
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


def extract_source_run_ids_from_text(text: str) -> frozenset[str]:
    run_ids: set[str] = set()
    start = 0
    while True:
        index = text.find(AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX, start)
        if index < 0:
            break
        suffix = text[index + len(AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX) :]
        run_id = suffix.split("/", 1)[0].strip()
        if run_id:
            run_ids.add(run_id)
        start = index + len(AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX)
    return frozenset(run_ids)


__all__ = [
    "CURRENT_SOURCE_RUN_REFERENCE_QUERIES",
    "SourceRunReferenceQuery",
    "extract_source_run_ids_from_text",
    "load_db_referenced_source_run_ids",
    "load_repo_referenced_source_run_ids",
]
