from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from threading import RLock
from urllib.parse import parse_qs, urlparse

try:
    from psycopg_pool import ConnectionPool
except ImportError:  # pragma: no cover
    ConnectionPool = None


DEFAULT_PERSISTENT_POSTGRES_POOL_MIN_SIZE = 1
DEFAULT_PERSISTENT_POSTGRES_POOL_MAX_SIZE = 4
DEFAULT_PERSISTENT_POSTGRES_POOL_TIMEOUT_SECONDS = 10.0
DEFAULT_PERSISTENT_POSTGRES_POOL_MAX_IDLE_SECONDS = 300.0
DEFAULT_PERSISTENT_POSTGRES_POOL_MAX_LIFETIME_SECONDS = 1800.0
SUPABASE_SESSION_POOLER_PORT = 5432
SUPABASE_SESSION_POOLER_RUNTIME_POOL_MIN_SIZE = 0
SUPABASE_SESSION_POOLER_RUNTIME_POOL_MAX_SIZE = 1


@dataclass(frozen=True, slots=True)
class _PersistentPostgresPoolKey:
    database_url: str
    autocommit: bool


_PERSISTENT_POSTGRES_POOLS: dict[_PersistentPostgresPoolKey, object] = {}
_PERSISTENT_POSTGRES_POOLS_LOCK = RLock()


def validate_persistent_postgres_runtime_url(database_url: str) -> str:
    normalized = database_url.strip()
    if not normalized:
        raise ValueError("database url is required")
    parsed = urlparse(normalized)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ValueError("database url must use postgres or postgresql scheme")
    hostname = (parsed.hostname or "").strip().lower()
    if not hostname:
        raise ValueError("database url must include a hostname")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("database url contains an invalid port") from exc
    if _is_supabase_session_pooler_host(hostname):
        if (port or SUPABASE_SESSION_POOLER_PORT) != SUPABASE_SESSION_POOLER_PORT:
            raise ValueError(
                "Supabase persistent runtime must use the session pooler on port 5432"
            )
        sslmode = _resolved_sslmode(parsed.query)
        if sslmode != "require":
            raise ValueError(
                "Supabase session pooler database url must include sslmode=require"
            )
        return normalized
    if _is_supabase_direct_host(hostname):
        raise ValueError(
            "Supabase persistent runtime must use the session pooler, not direct connection or transaction pooler"
        )
    return normalized


@contextmanager
def pooled_postgres_connection(database_url: str, *, autocommit: bool = True):
    validated_database_url = validate_persistent_postgres_runtime_url(database_url)
    pool = _persistent_postgres_pool(
        validated_database_url,
        autocommit=autocommit,
    )
    with pool.connection() as conn:
        try:
            yield conn
        except BaseException:
            if not autocommit:
                conn.rollback()
            raise
        else:
            if not autocommit:
                conn.commit()


def close_persistent_postgres_pools() -> None:
    with _PERSISTENT_POSTGRES_POOLS_LOCK:
        pools = tuple(_PERSISTENT_POSTGRES_POOLS.values())
        _PERSISTENT_POSTGRES_POOLS.clear()
    for pool in pools:
        pool.close()


def _persistent_postgres_pool(database_url: str, *, autocommit: bool) -> object:
    key = _PersistentPostgresPoolKey(
        database_url=database_url,
        autocommit=bool(autocommit),
    )
    with _PERSISTENT_POSTGRES_POOLS_LOCK:
        existing = _PERSISTENT_POSTGRES_POOLS.get(key)
        if existing is not None:
            return existing
        if ConnectionPool is None:  # pragma: no cover
            raise RuntimeError(
                "psycopg_pool is required to use pooled Postgres runtime connections"
            )
        min_size, max_size = _persistent_postgres_pool_size(database_url)
        pool = ConnectionPool(
            conninfo=database_url,
            min_size=min_size,
            max_size=max_size,
            timeout=DEFAULT_PERSISTENT_POSTGRES_POOL_TIMEOUT_SECONDS,
            max_idle=DEFAULT_PERSISTENT_POSTGRES_POOL_MAX_IDLE_SECONDS,
            max_lifetime=DEFAULT_PERSISTENT_POSTGRES_POOL_MAX_LIFETIME_SECONDS,
            open=True,
            kwargs={
                "autocommit": bool(autocommit),
            },
        )
        _PERSISTENT_POSTGRES_POOLS[key] = pool
        return pool


def _is_supabase_direct_host(hostname: str) -> bool:
    return hostname.endswith(".supabase.co")


def _is_supabase_session_pooler_host(hostname: str) -> bool:
    return hostname.endswith(".pooler.supabase.com")


def _resolved_sslmode(query: str) -> str:
    values = parse_qs(query).get("sslmode") or ()
    if not values:
        return ""
    return str(values[-1]).strip().lower()


def _persistent_postgres_pool_size(database_url: str) -> tuple[int, int]:
    hostname = (urlparse(database_url).hostname or "").strip().lower()
    if _is_supabase_session_pooler_host(hostname):
        return (
            SUPABASE_SESSION_POOLER_RUNTIME_POOL_MIN_SIZE,
            SUPABASE_SESSION_POOLER_RUNTIME_POOL_MAX_SIZE,
        )
    return (
        DEFAULT_PERSISTENT_POSTGRES_POOL_MIN_SIZE,
        DEFAULT_PERSISTENT_POSTGRES_POOL_MAX_SIZE,
    )


__all__ = [
    "DEFAULT_PERSISTENT_POSTGRES_POOL_MAX_IDLE_SECONDS",
    "DEFAULT_PERSISTENT_POSTGRES_POOL_MAX_LIFETIME_SECONDS",
    "DEFAULT_PERSISTENT_POSTGRES_POOL_MAX_SIZE",
    "DEFAULT_PERSISTENT_POSTGRES_POOL_MIN_SIZE",
    "DEFAULT_PERSISTENT_POSTGRES_POOL_TIMEOUT_SECONDS",
    "SUPABASE_SESSION_POOLER_PORT",
    "SUPABASE_SESSION_POOLER_RUNTIME_POOL_MAX_SIZE",
    "SUPABASE_SESSION_POOLER_RUNTIME_POOL_MIN_SIZE",
    "close_persistent_postgres_pools",
    "pooled_postgres_connection",
    "validate_persistent_postgres_runtime_url",
]
