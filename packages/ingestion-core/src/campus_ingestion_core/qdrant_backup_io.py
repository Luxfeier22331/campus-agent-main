from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class ObjectExistenceProbeError(RuntimeError):
    pass


def object_exists(*, object_store: Any, bucket: str, key: str) -> bool:
    try:
        object_store.head_object(bucket=bucket, key=key)
    except KeyError:
        return False
    except Exception as exc:
        raise ObjectExistenceProbeError(
            f"object existence probe failed for {bucket}/{key}"
        ) from exc
    return True


def sha256_file(file_path: str) -> str:
    digest = hashlib.sha256()
    with Path(file_path).open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def write_json_object(
    *,
    object_store: Any,
    bucket: str,
    key: str,
    payload: dict[str, Any],
) -> None:
    object_store.put_bytes(
        bucket=bucket,
        key=key,
        data=(json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        content_type="application/json",
    )


__all__ = [
    "ObjectExistenceProbeError",
    "object_exists",
    "sha256_file",
    "utc_now_iso",
    "write_json_object",
]
