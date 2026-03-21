from __future__ import annotations

import json

from campus_agent.context.store import JsonDict

try:
    import psycopg  # type: ignore[import-untyped]
except ImportError:
    psycopg = None  # type: ignore[assignment]


_CREATE_USER_PROFILES_SQL = """\
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY,
    profile_json JSONB NOT NULL,
    source_system TEXT NOT NULL,
    profile_version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

_CREATE_USER_PREFERENCES_SQL = """\
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY,
    preferences_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

_CREATE_USER_MEMORIES_SQL = """\
CREATE TABLE IF NOT EXISTS user_memories (
    memory_id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    memory_kind TEXT NOT NULL,
    memory_json JSONB NOT NULL,
    source TEXT NOT NULL,
    confidence TEXT NOT NULL,
    expires_at TIMESTAMPTZ NULL,
    status TEXT NOT NULL DEFAULT 'active',
    last_used_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

_CREATE_CONVERSATION_CONTEXTS_SQL = """\
CREATE TABLE IF NOT EXISTS conversation_contexts (
    conversation_id TEXT PRIMARY KEY,
    user_id TEXT NULL,
    context_json JSONB NOT NULL,
    last_response_id TEXT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

_SELECT_PROFILE_SQL = """\
SELECT profile_json FROM user_profiles WHERE user_id = %s;
"""

_SELECT_PREFERENCES_SQL = """\
SELECT preferences_json FROM user_preferences WHERE user_id = %s;
"""

_SELECT_MEMORIES_SQL = """\
SELECT memory_json
FROM user_memories
WHERE user_id = %s
  AND status = 'active'
  AND (expires_at IS NULL OR expires_at > now())
ORDER BY updated_at DESC
LIMIT %s;
"""

_SELECT_CONVERSATION_CONTEXT_SQL = """\
SELECT context_json FROM conversation_contexts WHERE conversation_id = %s;
"""


class PostgresContextStore:
    """Postgres-backed persistence for profiles, preferences, memories, and conversation context."""

    def __init__(self, *, conninfo: str) -> None:
        if psycopg is None:
            raise ImportError(
                "psycopg is required for PostgresContextStore. "
                "Install with: pip install psycopg[binary]"
            )
        self._conninfo = conninfo
        self._conn: psycopg.Connection | None = None  # type: ignore[type-arg]

    def _get_connection(self) -> psycopg.Connection:  # type: ignore[type-arg]
        if self._conn is None or self._conn.closed:
            self._conn = psycopg.connect(self._conninfo, autocommit=True)  # type: ignore[attr-defined]
        return self._conn

    def create_tables_if_not_exists(self) -> None:
        conn = self._get_connection()
        for sql in (
            _CREATE_USER_PROFILES_SQL,
            _CREATE_USER_PREFERENCES_SQL,
            _CREATE_USER_MEMORIES_SQL,
            _CREATE_CONVERSATION_CONTEXTS_SQL,
        ):
            conn.execute(sql)

    def get_user_profile(self, user_id: str) -> JsonDict | None:
        return _fetch_json(self._get_connection().execute(_SELECT_PROFILE_SQL, (user_id,)).fetchone())

    def get_user_preferences(self, user_id: str) -> JsonDict | None:
        return _fetch_json(self._get_connection().execute(_SELECT_PREFERENCES_SQL, (user_id,)).fetchone())

    def select_memories(self, user_id: str, *, query: str, limit: int) -> list[JsonDict]:
        del query
        cursor = self._get_connection().execute(_SELECT_MEMORIES_SQL, (user_id, max(1, int(limit))))
        memories: list[JsonDict] = []
        for row in cursor.fetchall() or []:
            raw = row[0]
            payload = raw if isinstance(raw, dict) else json.loads(raw)
            memories.append(dict(payload))
        return memories

    def get_conversation_context(self, conversation_id: str) -> JsonDict | None:
        return _fetch_json(
            self._get_connection().execute(
                _SELECT_CONVERSATION_CONTEXT_SQL,
                (conversation_id,),
            ).fetchone()
        )

    def close(self) -> None:
        if self._conn is not None and not self._conn.closed:
            self._conn.close()


def _fetch_json(row: object) -> JsonDict | None:
    if row is None:
        return None
    raw = row[0]  # type: ignore[index]
    payload = raw if isinstance(raw, dict) else json.loads(raw)
    return dict(payload)
