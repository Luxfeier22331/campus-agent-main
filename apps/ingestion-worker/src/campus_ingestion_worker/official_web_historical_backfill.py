from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal, Protocol, Sequence

from campus_ingestion_core import (
    DEFAULT_BUCKET_SOURCE,
    ObjectStoreSettings,
    build_official_web_run_artifact_key,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin

from campus_ingestion_worker.env_bootstrap import load_worker_env

OFFICIAL_WEB_HISTORICAL_BACKFILL_REPORT_SCHEMA_VERSION = (
    "official_web_historical_backfill_report.v1"
)
RUN_ARTIFACT_TYPE_BY_NAME = {
    "crawl-run.json": "crawl_run_manifest",
    "host-summary.json": "host_summary",
    "url-results.jsonl": "url_results",
    "failures.jsonl": "failures",
    "source-truth-bundle.json": "source_truth_bundle",
    "quality-audit.json": "quality_audit",
    "page-observations.jsonl": "page_observations",
    "dynamic-shell-discovery-audit.jsonl": "dynamic_shell_discovery_audit",
}
REQUIRED_BUCKET_FILES = ("source-truth-bundle.json",)


class HistoricalBackfillObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None: ...


@dataclass(frozen=True, slots=True)
class OfficialWebHistoricalBackfillSettings:
    inbox_dir: Path = Path("./var/official-web-handoffs")
    local_output_dirs: tuple[Path, ...] = ()
    source_bucket: str = DEFAULT_BUCKET_SOURCE

    @classmethod
    def from_env(
        cls,
        *,
        local_output_dirs: Sequence[Path] = (),
    ) -> "OfficialWebHistoricalBackfillSettings":
        object_store_settings = ObjectStoreSettings.from_env()
        return cls(
            inbox_dir=Path(
                (
                    __import__("os")
                    .getenv(
                        "INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_INBOX_DIR",
                        "./var/official-web-handoffs",
                    )
                    .strip()
                    or "./var/official-web-handoffs"
                )
            ),
            local_output_dirs=tuple(local_output_dirs),
            source_bucket=object_store_settings.bucket_source,
        )


@dataclass(frozen=True, slots=True)
class OfficialWebHistoricalInventoryResult:
    event_id: str
    inventory_status: Literal[
        "bucket_ready", "recoverable_local_output", "unrecoverable_missing_local_output"
    ]
    local_output_dir: str | None
    missing_object_keys: tuple[str, ...]
    record_path: str
    run_id: str
    site_id: str


@dataclass(frozen=True, slots=True)
class OfficialWebHistoricalBackfillResult:
    backfill_status: Literal["uploaded", "already_ready", "unrecoverable_missing_local_output"]
    event_id: str
    local_output_dir: str | None
    record_path: str
    run_artifact_count: int
    run_id: str
    site_id: str
    uploaded_object_keys: tuple[str, ...]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Inventory or backfill historical official_web crawl artifacts into source object storage.",
    )
    parser.add_argument("--event-id")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--local-output-glob", action="append", default=["/tmp/official-web-*"])
    parser.add_argument("--dry-run", action="store_true")
    return parser


def inventory_historical_handoff_record(
    *,
    record_path: Path,
    settings: OfficialWebHistoricalBackfillSettings,
    object_store: HistoricalBackfillObjectStore,
) -> OfficialWebHistoricalInventoryResult:
    record = _read_json(record_path)
    payload = _require_object(record.get("payload"), "payload")
    event_id = _require_text(record.get("eventId"), "eventId")
    site_id = _require_text(payload.get("siteId"), "payload.siteId")
    run_id = _require_text(payload.get("runId"), "payload.runId")
    local_output_dir = _resolve_local_output_dir(payload=payload, settings=settings)

    missing_object_keys: list[str] = []
    bundle_key = _build_run_artifact_key(
        site_id=site_id, run_id=run_id, artifact_name="source-truth-bundle.json"
    )
    if not _object_exists(object_store=object_store, bucket=settings.source_bucket, key=bundle_key):
        missing_object_keys.append(bundle_key)

    if not missing_object_keys:
        status: Literal[
            "bucket_ready", "recoverable_local_output", "unrecoverable_missing_local_output"
        ] = "bucket_ready"
    elif local_output_dir is not None:
        status = "recoverable_local_output"
    else:
        status = "unrecoverable_missing_local_output"

    return OfficialWebHistoricalInventoryResult(
        event_id=event_id,
        inventory_status=status,
        local_output_dir=str(local_output_dir.resolve()) if local_output_dir is not None else None,
        missing_object_keys=tuple(missing_object_keys),
        record_path=str(record_path.resolve()),
        run_id=run_id,
        site_id=site_id,
    )


def backfill_historical_handoff_record(
    *,
    record_path: Path,
    settings: OfficialWebHistoricalBackfillSettings,
    object_store: HistoricalBackfillObjectStore,
) -> OfficialWebHistoricalBackfillResult:
    inventory = inventory_historical_handoff_record(
        record_path=record_path,
        settings=settings,
        object_store=object_store,
    )
    if inventory.inventory_status == "bucket_ready":
        return OfficialWebHistoricalBackfillResult(
            backfill_status="already_ready",
            event_id=inventory.event_id,
            local_output_dir=inventory.local_output_dir,
            record_path=inventory.record_path,
            run_artifact_count=0,
            run_id=inventory.run_id,
            site_id=inventory.site_id,
            uploaded_object_keys=(),
        )
    local_output_dir = Path(inventory.local_output_dir or "")
    if not local_output_dir.exists():
        return OfficialWebHistoricalBackfillResult(
            backfill_status="unrecoverable_missing_local_output",
            event_id=inventory.event_id,
            local_output_dir=inventory.local_output_dir,
            record_path=inventory.record_path,
            run_artifact_count=0,
            run_id=inventory.run_id,
            site_id=inventory.site_id,
            uploaded_object_keys=(),
        )

    bundle = _read_json(local_output_dir / "source-truth-bundle.json")
    uploaded_object_keys: list[str] = []
    artifacts: list[dict[str, object]] = []
    for artifact_name, artifact_type in RUN_ARTIFACT_TYPE_BY_NAME.items():
        source_path = local_output_dir / artifact_name
        if not source_path.exists():
            continue
        key = _build_run_artifact_key(
            site_id=inventory.site_id,
            run_id=inventory.run_id,
            artifact_name=artifact_name,
        )
        data = source_path.read_bytes()
        object_store.put_bytes(
            bucket=settings.source_bucket,
            key=key,
            data=data,
            content_type=_infer_content_type(source_path),
        )
        uploaded_object_keys.append(key)
        artifacts.append(
            {
                "artifactType": artifact_type,
                "byteSize": len(data),
                "contentSha256": hashlib.sha256(data).hexdigest(),
                "objectKey": key,
                "recordCount": _count_records(
                    artifact_name=artifact_name, path=source_path, payload=bundle
                ),
            }
        )

    source_assets_dir = local_output_dir / "source-assets"
    if source_assets_dir.exists():
        for path in sorted(
            candidate for candidate in source_assets_dir.rglob("*") if candidate.is_file()
        ):
            key = _build_source_asset_key(path.relative_to(source_assets_dir))
            object_store.put_bytes(
                bucket=settings.source_bucket,
                key=key,
                data=path.read_bytes(),
                content_type=_infer_content_type(path),
            )
            uploaded_object_keys.append(key)

    record = _read_json(record_path)
    payload = _require_object(record.get("payload"), "payload")
    payload["artifacts"] = artifacts
    _write_json(record_path, record)

    return OfficialWebHistoricalBackfillResult(
        backfill_status="uploaded",
        event_id=inventory.event_id,
        local_output_dir=inventory.local_output_dir,
        record_path=inventory.record_path,
        run_artifact_count=len(artifacts),
        run_id=inventory.run_id,
        site_id=inventory.site_id,
        uploaded_object_keys=tuple(uploaded_object_keys),
    )


def main(argv: Sequence[str] | None = None) -> int:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    local_output_dirs = _expand_local_output_globs(args.local_output_glob)
    settings = OfficialWebHistoricalBackfillSettings.from_env(local_output_dirs=local_output_dirs)
    object_store = S3ObjectStoreAdmin(ObjectStoreSettings.from_env())
    record_paths = _resolve_record_paths(
        inbox_dir=settings.inbox_dir,
        event_id=args.event_id,
        limit=args.limit,
    )
    results = [
        (
            inventory_historical_handoff_record(
                record_path=record_path,
                settings=settings,
                object_store=object_store,
            )
            if args.dry_run
            else backfill_historical_handoff_record(
                record_path=record_path,
                settings=settings,
                object_store=object_store,
            )
        )
        for record_path in record_paths
    ]
    print(
        json.dumps(
            {
                "schemaVersion": OFFICIAL_WEB_HISTORICAL_BACKFILL_REPORT_SCHEMA_VERSION,
                "results": [asdict(result) for result in results],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def _resolve_record_paths(*, inbox_dir: Path, event_id: str | None, limit: int) -> list[Path]:
    if event_id:
        path = inbox_dir / f"{event_id}.json"
        if not path.exists():
            raise FileNotFoundError(f"official_web handoff record not found: {path}")
        return [path]
    return sorted(inbox_dir.glob("*.json"))[:limit]


def _resolve_local_output_dir(
    *,
    payload: dict[str, object],
    settings: OfficialWebHistoricalBackfillSettings,
) -> Path | None:
    run_id = _require_text(payload.get("runId"), "payload.runId")
    scheduler_run_key = _require_text(payload.get("schedulerRunKey"), "payload.schedulerRunKey")
    site_id = _require_text(payload.get("siteId"), "payload.siteId")
    for candidate in settings.local_output_dirs:
        if not candidate.exists() or not candidate.is_dir():
            continue
        crawl_run_path = candidate / "crawl-run.json"
        bundle_path = candidate / "source-truth-bundle.json"
        if not crawl_run_path.exists() or not bundle_path.exists():
            continue
        try:
            crawl_run = _read_json(crawl_run_path)
            bundle = _read_json(bundle_path)
        except ValueError:
            continue
        if (
            _optional_text(crawl_run.get("crawlRunId")) == run_id
            and _optional_text(bundle.get("crawlRunId")) == run_id
            and _optional_text(bundle.get("siteId")) == site_id
        ):
            return candidate
        if scheduler_run_key and scheduler_run_key in candidate.name:
            return candidate
    return None


def _expand_local_output_globs(patterns: Sequence[str]) -> tuple[Path, ...]:
    results: list[Path] = []
    for pattern in patterns:
        for path in sorted(
            Path("/").glob(pattern.lstrip("/"))
            if pattern.startswith("/")
            else Path(".").glob(pattern)
        ):
            if path.is_dir():
                results.append(path)
    return tuple(dict.fromkeys(path.resolve() for path in results))


def _object_exists(
    *,
    object_store: HistoricalBackfillObjectStore,
    bucket: str,
    key: str,
) -> bool:
    try:
        object_store.get_bytes(bucket=bucket, key=key)
        return True
    except Exception:
        return False


def _build_run_artifact_key(*, site_id: str, run_id: str, artifact_name: str) -> str:
    return build_official_web_run_artifact_key(
        site_id=site_id,
        run_id=run_id,
        artifact_name=artifact_name,
    )


def _build_source_asset_key(relative_path: Path) -> str:
    parts = relative_path.parts
    if len(parts) < 3:
        raise ValueError(f"invalid source-assets path: {relative_path}")
    raw_asset_id, raw_version_id = parts[0], parts[1]
    remainder = "/".join(parts[2:])
    return f"official_web/{raw_asset_id}/undated/{raw_version_id}/{remainder}"


def _count_records(*, artifact_name: str, path: Path, payload: dict[str, object]) -> int | None:
    if artifact_name == "source-truth-bundle.json":
        pages = payload.get("pages")
        return len(pages) if isinstance(pages, list) else 1
    if path.suffix == ".jsonl":
        return sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
    return 1


def _infer_content_type(path: Path) -> str:
    if path.suffix == ".html":
        return "text/html; charset=utf-8"
    if path.suffix == ".json":
        return "application/json"
    if path.suffix == ".jsonl":
        return "application/x-ndjson"
    return "application/octet-stream"


def _read_json(path: Path) -> dict[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid JSON file: {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"JSON file must be an object: {path}")
    return payload


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)


def _require_object(value: object, field_name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object.")
    return value


def _require_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty string.")
    return value.strip()


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


if __name__ == "__main__":
    raise SystemExit(main())
