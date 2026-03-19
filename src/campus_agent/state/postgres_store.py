from __future__ import annotations

import json
from copy import deepcopy

from campus_agent.state.models import WorkflowState

try:
    import psycopg  # type: ignore[import-untyped]
except ImportError:
    psycopg = None  # type: ignore[assignment]


_CREATE_TABLE_SQL = """\
CREATE TABLE IF NOT EXISTS workflow_states (
    workflow_run_id TEXT PRIMARY KEY,
    state_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

_UPSERT_SQL = """\
INSERT INTO workflow_states (workflow_run_id, state_json, updated_at)
VALUES (%s, %s, now())
ON CONFLICT (workflow_run_id)
DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = now();
"""

_SELECT_SQL = """\
SELECT state_json FROM workflow_states WHERE workflow_run_id = %s;
"""


class PostgresWorkflowStateStore:
    """Postgres-backed workflow state persistence for Supabase/Postgres deployments."""

    def __init__(self, *, conninfo: str) -> None:
        if psycopg is None:
            raise ImportError(
                "psycopg is required for PostgresWorkflowStateStore. "
                "Install with: pip install psycopg[binary]"
            )
        self._conninfo = conninfo
        self._conn: psycopg.Connection | None = None  # type: ignore[type-arg]

    def _get_connection(self) -> psycopg.Connection:  # type: ignore[type-arg]
        if self._conn is None or self._conn.closed:
            self._conn = psycopg.connect(self._conninfo, autocommit=True)  # type: ignore[attr-defined]
        return self._conn

    def create_table_if_not_exists(self) -> None:
        conn = self._get_connection()
        conn.execute(_CREATE_TABLE_SQL)

    def save(self, state: WorkflowState) -> None:
        conn = self._get_connection()
        payload = deepcopy(state.to_dict())
        conn.execute(
            _UPSERT_SQL,
            (state.workflow_run_id, json.dumps(payload)),
        )

    def load(self, workflow_run_id: str) -> WorkflowState:
        conn = self._get_connection()
        row = conn.execute(_SELECT_SQL, (workflow_run_id,)).fetchone()
        if row is None:
            raise KeyError(workflow_run_id)
        raw = row[0]
        payload = raw if isinstance(raw, dict) else json.loads(raw)
        return WorkflowState.from_dict(deepcopy(payload))

    def close(self) -> None:
        if self._conn is not None and not self._conn.closed:
            self._conn.close()
