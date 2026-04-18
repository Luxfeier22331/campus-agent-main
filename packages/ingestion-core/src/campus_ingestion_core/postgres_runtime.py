from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from threading import RLock
from typing import Literal
from urllib.parse import parse_qsl, parse_qs, urlencode, urlparse, urlunparse

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
POSTGRES_CONNECTION_MODE_QUERY_KEY = "__campus_connection_mode"
PERSISTENT_RUNTIME_CONNECTION_MODE = "persistent_runtime"
OPERATOR_SESSION_CONNECTION_MODE = "operator_session"
MANAGEMENT_DIRECT_CONNECTION_MODE = "management_direct"


@dataclass(frozen=True, slots=True)
class ResolvedPostgresConnection:
    database_url: str
    connection_mode: Literal[
        "persistent_runtime", "operator_session", "management_direct"
    ]


@dataclass(frozen=True, slots=True)
class _PersistentPostgresPoolKey:
    database_url: str
    autocommit: bool


_PERSISTENT_POSTGRES_POOLS: dict[_PersistentPostgresPoolKey, object] = {}
_PERSISTENT_POSTGRES_POOLS_LOCK = RLock()


def validate_persistent_postgres_runtime_url(database_url: str) -> str:
    normalized, parsed, hostname, port = _parse_postgres_runtime_url(database_url)
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


def validate_management_postgres_url(database_url: str) -> str:
    normalized, parsed, hostname, port = _parse_postgres_runtime_url(database_url)
    if _is_supabase_session_pooler_host(hostname):
        raise ValueError(
            "Supabase management direct connection must use db.<project-ref>.supabase.co, not session pooler"
        )
    if _is_supabase_direct_host(hostname):
        if (port or SUPABASE_SESSION_POOLER_PORT) != SUPABASE_SESSION_POOLER_PORT:
            raise ValueError(
                "Supabase management direct connection must use port 5432, not transaction pooler"
            )
        return _with_sslmode_require(parsed)
    return normalized


def validate_operator_postgres_url(database_url: str) -> str:
    return validate_persistent_postgres_runtime_url(database_url)


def build_operator_postgres_connection_url(database_url: str) -> str:
    return _with_connection_mode(
        validate_operator_postgres_url(database_url),
        OPERATOR_SESSION_CONNECTION_MODE,
    )


def build_management_postgres_connection_url(database_url: str) -> str:
    return _with_connection_mode(
        validate_management_postgres_url(database_url),
        MANAGEMENT_DIRECT_CONNECTION_MODE,
    )


def normalize_postgres_connection_url(database_url: str) -> str:
    resolved = resolve_postgres_connection(database_url)
    if resolved.connection_mode == MANAGEMENT_DIRECT_CONNECTION_MODE:
        return build_management_postgres_connection_url(resolved.database_url)
    if resolved.connection_mode == OPERATOR_SESSION_CONNECTION_MODE:
        return build_operator_postgres_connection_url(resolved.database_url)
    return resolved.database_url


def resolve_postgres_connection(database_url: str) -> ResolvedPostgresConnection:
    normalized = database_url.strip()
    if not normalized:
        raise ValueError("database url is required")
    parsed = urlparse(normalized)
    query_pairs = parse_qsl(parsed.query, keep_blank_values=True)
    connection_mode = PERSISTENT_RUNTIME_CONNECTION_MODE
    filtered_query_pairs: list[tuple[str, str]] = []
    for key, value in query_pairs:
        if key == POSTGRES_CONNECTION_MODE_QUERY_KEY:
            connection_mode = value or PERSISTENT_RUNTIME_CONNECTION_MODE
            continue
        filtered_query_pairs.append((key, value))
    stripped_url = urlunparse(parsed._replace(query=urlencode(filtered_query_pairs, doseq=True)))
    if connection_mode == MANAGEMENT_DIRECT_CONNECTION_MODE:
        return ResolvedPostgresConnection(
            database_url=validate_management_postgres_url(stripped_url),
            connection_mode=MANAGEMENT_DIRECT_CONNECTION_MODE,
        )
    if connection_mode == OPERATOR_SESSION_CONNECTION_MODE:
        return ResolvedPostgresConnection(
            database_url=validate_operator_postgres_url(stripped_url),
            connection_mode=OPERATOR_SESSION_CONNECTION_MODE,
        )
    if connection_mode != PERSISTENT_RUNTIME_CONNECTION_MODE:
        raise ValueError(f"unsupported postgres connection mode: {connection_mode}")
    return ResolvedPostgresConnection(
        database_url=validate_persistent_postgres_runtime_url(stripped_url),
        connection_mode=PERSISTENT_RUNTIME_CONNECTION_MODE,
    )


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


@contextmanager
def direct_postgres_connection(database_url: str, *, autocommit: bool = True):
    validated_database_url = validate_management_postgres_url(database_url)
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("psycopg is required to use direct Postgres connections") from exc
    conn = psycopg.connect(validated_database_url, autocommit=bool(autocommit))
    try:
        yield conn
    except BaseException:
        if not autocommit:
            conn.rollback()
        raise
    else:
        if not autocommit:
            conn.commit()
    finally:
        conn.close()


@contextmanager
def open_postgres_connection(database_url: str, *, autocommit: bool = True):
    resolved = resolve_postgres_connection(database_url)
    if resolved.connection_mode == MANAGEMENT_DIRECT_CONNECTION_MODE:
        with direct_postgres_connection(resolved.database_url, autocommit=autocommit) as conn:
            yield conn
        return
    with pooled_postgres_connection(resolved.database_url, autocommit=autocommit) as conn:
        yield conn


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


def _is_supabase_managed_host(hostname: str) -> bool:
    return _is_supabase_direct_host(hostname) or _is_supabase_session_pooler_host(hostname)


def _resolved_sslmode(query: str) -> str:
    values = parse_qs(query).get("sslmode") or ()
    if not values:
        return ""
    return str(values[-1]).strip().lower()


def _parse_postgres_runtime_url(database_url: str) -> tuple[str, object, str, int | None]:
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
    return normalized, parsed, hostname, port


def _with_sslmode_require(parsed) -> str:
    query_pairs = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key != "sslmode"
    ]
    query_pairs.append(("sslmode", "require"))
    return urlunparse(parsed._replace(query=urlencode(query_pairs, doseq=True)))


def _with_connection_mode(database_url: str, connection_mode: str) -> str:
    parsed = urlparse(database_url)
    query_pairs = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key != POSTGRES_CONNECTION_MODE_QUERY_KEY
    ]
    query_pairs.append((POSTGRES_CONNECTION_MODE_QUERY_KEY, connection_mode))
    return urlunparse(parsed._replace(query=urlencode(query_pairs, doseq=True)))


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
    "MANAGEMENT_DIRECT_CONNECTION_MODE",
    "OPERATOR_SESSION_CONNECTION_MODE",
    "POSTGRES_CONNECTION_MODE_QUERY_KEY",
    "PERSISTENT_RUNTIME_CONNECTION_MODE",
    "ResolvedPostgresConnection",
    "SUPABASE_SESSION_POOLER_PORT",
    "SUPABASE_SESSION_POOLER_RUNTIME_POOL_MAX_SIZE",
    "SUPABASE_SESSION_POOLER_RUNTIME_POOL_MIN_SIZE",
    "build_operator_postgres_connection_url",
    "build_management_postgres_connection_url",
    "close_persistent_postgres_pools",
    "direct_postgres_connection",
    "normalize_postgres_connection_url",
    "open_postgres_connection",
    "resolve_postgres_connection",
    "validate_operator_postgres_url",
    "validate_management_postgres_url",
    "pooled_postgres_connection",
    "validate_persistent_postgres_runtime_url",
]
