from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from threading import Lock

_LOGGER = logging.getLogger(__name__)

INGESTION_RUN_TELEMETRY_JSONL_PATH_ENV = "INGESTION_RUN_TELEMETRY_JSONL_PATH"

IngestionRunEventEmitter = Callable[[str, dict[str, object]], None]

_ALLOWED_SCALAR_FIELDS = frozenset(
    {
        "schema_version",
        "operation",
        "stage",
        "run_id",
        "corpus",
        "collection",
        "surface",
        "source_family",
        "import_source",
        "status",
        "failure_kind",
        "duration_ms",
        "document_count",
        "document_unit_count",
        "chunk_count",
        "point_count",
        "qdrant_upsert_count",
        "embedding_model",
        "embedding_call_count",
        "embedding_cache_hit_count",
        "embedding_cache_miss_count",
        "embedding_provider_call_count",
        "cost_estimate_microusd",
        "release_id",
        "preparation_run_id",
        "profile_hash",
        "validation_status",
        "quality_gate_status",
        "retrieval_acceptance_status",
        "post_publish_audit_status",
        "audit_result",
        "publish_alias",
        "published",
        "reset_index",
        "selection_mode",
        "success_count",
        "skipped_count",
        "failed_count",
    }
)


@dataclass(frozen=True, slots=True)
class IngestionRunTelemetryEmission:
    status: str
    event_name: str
    failure_kind: str = ""

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def build_ingestion_run_event_emitter(
    env: Mapping[str, str] | None = None,
) -> IngestionRunEventEmitter | None:
    source = env if env is not None else os.environ
    path = str(source.get(INGESTION_RUN_TELEMETRY_JSONL_PATH_ENV) or "").strip()
    if not path:
        return None
    return build_ingestion_run_event_jsonl_emitter(path)


def build_ingestion_run_event_jsonl_emitter(path: str | Path) -> IngestionRunEventEmitter:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_lock = Lock()

    def emit_event(event_name: str, attributes: dict[str, object]) -> None:
        record = {
            "event_name": event_name,
            "attributes": sanitize_ingestion_run_attributes(attributes),
        }
        line = json.dumps(record, ensure_ascii=False, sort_keys=True, default=str)
        with write_lock, output_path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")

    return emit_event


def emit_ingestion_run_telemetry(
    *,
    event_name: str,
    attributes: Mapping[str, object],
    emit_event: IngestionRunEventEmitter | None,
) -> IngestionRunTelemetryEmission:
    if emit_event is None:
        return IngestionRunTelemetryEmission(status="disabled", event_name=event_name)
    try:
        emit_event(event_name, sanitize_ingestion_run_attributes(attributes))
        return IngestionRunTelemetryEmission(status="emitted", event_name=event_name)
    except Exception:
        _LOGGER.warning(
            "ingestion run telemetry sink failed for event_name=%s run_id=%s operation=%s",
            event_name,
            attributes.get("run_id"),
            attributes.get("operation"),
            exc_info=True,
        )
        return IngestionRunTelemetryEmission(
            status="degraded",
            event_name=event_name,
            failure_kind="telemetry_export_failed",
        )


def summarize_ingestion_run_telemetry(
    *emissions: IngestionRunTelemetryEmission,
) -> dict[str, object]:
    event_names = tuple(emission.event_name for emission in emissions if emission.event_name)
    degraded = next((emission for emission in emissions if emission.status == "degraded"), None)
    if degraded is not None:
        return {
            "status": "degraded",
            "event_names": event_names,
            "failure_kind": degraded.failure_kind,
        }
    if any(emission.status == "emitted" for emission in emissions):
        return {"status": "emitted", "event_names": event_names}
    return {"status": "disabled", "event_names": event_names}


def sanitize_ingestion_run_attributes(attributes: Mapping[str, object]) -> dict[str, object]:
    sanitized: dict[str, object] = {}
    for field in _ALLOWED_SCALAR_FIELDS:
        if field in attributes:
            sanitized[field] = _sanitize_scalar(attributes[field])
    return {key: value for key, value in sanitized.items() if value is not None}


def _sanitize_scalar(value: object) -> object:
    if value is None:
        return None
    if isinstance(value, bool | int | float):
        return value
    return str(value)
