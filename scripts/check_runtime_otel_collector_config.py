from __future__ import annotations

import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass

_LANGFUSE_REQUIRED_ENV_KEYS = (
    "OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT",
    "OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER",
    "OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION",
)


@dataclass(frozen=True, slots=True)
class RuntimeOtelCollectorConfigCheck:
    passed: bool
    errors: tuple[str, ...]


def validate_langfuse_collector_env(
    env: Mapping[str, str] | None = None,
) -> RuntimeOtelCollectorConfigCheck:
    source = env if env is not None else os.environ
    errors: list[str] = []
    for key in _LANGFUSE_REQUIRED_ENV_KEYS:
        if not str(source.get(key) or "").strip():
            errors.append(f"{key} is required")

    endpoint = str(source.get("OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT") or "").strip()
    if endpoint and not endpoint.endswith("/api/public/otel"):
        errors.append("OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT must end with /api/public/otel")

    auth_header = str(source.get("OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER") or "").strip()
    if auth_header and not auth_header.startswith("Basic "):
        errors.append("OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER must use Basic auth")

    ingestion_version = str(source.get("OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION") or "").strip()
    if ingestion_version and ingestion_version != "4":
        errors.append("OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION must be 4")

    return RuntimeOtelCollectorConfigCheck(passed=not errors, errors=tuple(errors))


def main() -> int:
    result = validate_langfuse_collector_env()
    if result.passed:
        return 0
    for error in result.errors:
        print(error, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
