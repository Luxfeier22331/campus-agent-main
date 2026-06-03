from __future__ import annotations


class _OcrProviderResponseCache:
    def __init__(self, *, enabled: bool, max_entries: int, max_bytes: int) -> None:
        self._enabled = enabled
        self._max_entries = max_entries
        self._max_bytes = max_bytes
        self._cache: dict[str, bytes] = {}
        self._order: list[str] = []
        self._total_bytes = 0

    def get(self, key: str) -> bytes | None:
        if not self._enabled:
            return None
        payload = self._cache.get(key)
        if payload is None:
            return None
        if key in self._order:
            self._order.remove(key)
        self._order.append(key)
        return payload

    def put(self, key: str, payload: bytes) -> None:
        if not self._enabled:
            return
        payload_size = len(payload)
        if payload_size > self._max_bytes:
            return
        existing = self._cache.get(key)
        if existing is not None:
            self._total_bytes -= len(existing)
        self._cache[key] = payload
        if key in self._order:
            self._order.remove(key)
        self._order.append(key)
        self._total_bytes += payload_size
        self._evict_if_needed()

    def _evict_if_needed(self) -> None:
        while self._order and (
            len(self._cache) > self._max_entries or self._total_bytes > self._max_bytes
        ):
            oldest = self._order.pop(0)
            removed = self._cache.pop(oldest, None)
            if removed is not None:
                self._total_bytes -= len(removed)


def _build_ocr_provider_response_cache(*, env: dict[str, str]) -> _OcrProviderResponseCache | None:
    enabled = _read_bool_env(
        env=env,
        key="INGESTION_OCR_PROVIDER_RESPONSE_CACHE_ENABLED",
        default=True,
    )
    max_entries = _read_non_negative_env_int(
        env=env,
        key="INGESTION_OCR_PROVIDER_RESPONSE_CACHE_MAX_ENTRIES",
        default=1,
    )
    max_bytes = _read_non_negative_env_int(
        env=env,
        key="INGESTION_OCR_PROVIDER_RESPONSE_CACHE_MAX_BYTES",
        default=4 * 1024 * 1024,
    )
    if not enabled or max_entries <= 0 or max_bytes <= 0:
        return None
    return _OcrProviderResponseCache(
        enabled=enabled,
        max_entries=max_entries,
        max_bytes=max_bytes,
    )


def _read_positive_env_int(*, env: dict[str, str], key: str, default: int) -> int:
    raw = str(env.get(key) or "").strip()
    if not raw:
        return default
    value = int(raw)
    if value <= 0:
        raise ValueError(f"{key} must be a positive integer")
    return value


def _read_non_negative_env_int(*, env: dict[str, str], key: str, default: int) -> int:
    raw = str(env.get(key) or "").strip()
    if not raw:
        return default
    value = int(raw)
    if value < 0:
        raise ValueError(f"{key} must be a non-negative integer")
    return value


def _read_bool_env(*, env: dict[str, str], key: str, default: bool) -> bool:
    raw = str(env.get(key) or "").strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{key} must be a boolean value")
