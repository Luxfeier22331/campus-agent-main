from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from campus_ingestion_core.structured_projection_postgres import (
    projection_artifact_checksum,
)
from campus_ingestion_core.transport_schedule_projection import (
    TRANSPORT_SCHEDULE_COLLECTION,
    TRANSPORT_SCHEDULE_CORPUS,
)

from campus_ingestion_worker.build_transport_schedule_projection_contracts import (
    _ProjectionReleaseReport,
    _StructuredProjectionPublisher,
)
from campus_ingestion_worker.build_transport_schedule_projection_io import _required_text

_PUBLISH_MODE_PREVIEW = "preview"
_PUBLISH_MODE_STAGE = "stage"
_PUBLISH_MODE_PROMOTE = "promote"
_PUBLISH_MODES = frozenset(
    {
        _PUBLISH_MODE_PREVIEW,
        _PUBLISH_MODE_STAGE,
        _PUBLISH_MODE_PROMOTE,
    }
)


def _publish_structured_projection_release(
    *,
    structured_projection_publisher: _StructuredProjectionPublisher | None,
    bundle: Mapping[str, Any],
    report: _ProjectionReleaseReport,
    generated_at: str,
    promote_current: bool,
    enabled: bool,
) -> None:
    if structured_projection_publisher is None or not enabled:
        return
    schema_version = _required_text(bundle.get("schema_version"))
    if schema_version is None:
        raise ValueError("transport schedule projection bundle schema_version is required")
    structured_projection_publisher.publish_release(
        corpus=TRANSPORT_SCHEDULE_CORPUS,
        collection=TRANSPORT_SCHEDULE_COLLECTION,
        release_id=report.release_id,
        generated_at=generated_at,
        schema_version=schema_version,
        artifact_object_key=report.release_object_key,
        artifact_checksum=projection_artifact_checksum(bundle),
        bundle=bundle,
        validation_status="valid",
        promote_current=promote_current,
    )


def _normalize_publish_mode(value: str) -> str:
    normalized = str(value or _PUBLISH_MODE_PROMOTE).strip().lower()
    if normalized not in _PUBLISH_MODES:
        raise ValueError(f"unsupported transport schedule publish mode: {value!r}")
    return normalized


def _writes_versioned_artifacts(publish_mode: str) -> bool:
    return publish_mode in {_PUBLISH_MODE_STAGE, _PUBLISH_MODE_PROMOTE}


def _writes_structured_projection(publish_mode: str) -> bool:
    return publish_mode in {_PUBLISH_MODE_STAGE, _PUBLISH_MODE_PROMOTE}


def _promotes_current(publish_mode: str) -> bool:
    return publish_mode == _PUBLISH_MODE_PROMOTE
