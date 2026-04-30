from __future__ import annotations


def read_bool_env(env: dict[str, str], key: str) -> bool:
    value = env.get(key, "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def read_capability_set(raw_value: str) -> set[str]:
    return {value.strip() for value in raw_value.split(",") if value.strip()}


__all__ = ["read_bool_env", "read_capability_set"]
