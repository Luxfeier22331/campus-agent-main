from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_export,
)
from campus_ingestion_core.authenticated_notice_source_truth import (
    build_authenticated_notice_raw_asset_id,
)
from campus_ingestion_core.registry import (
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.smoke_authenticated_notice_bootstrap import build_smoke_summary

DEFAULT_CLOSEOUT_CHECKPOINT_SIZES = (240, 1000, 3000)
DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30.0
SAMPLE_LIMIT = 20


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run authenticated notice historical backfill closeout"
    )
    parser.add_argument("--bundle-path", required=True)
    parser.add_argument("--manifest-path")
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--source-home-url", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--entitlement-group", action="append", default=[])
    parser.add_argument("--visibility-scope", default="campus")
    parser.add_argument("--checkpoint-size", action="append", type=int, default=[])
    parser.add_argument("--expected-notice-count", type=int)
    parser.add_argument("--skip-existing", action="store_true")
    parser.add_argument("--final-rerun", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)

    output_dir = Path(args.output_dir)
    bundle_path = Path(args.bundle_path)
    manifest_path = Path(args.manifest_path) if args.manifest_path else None
    entitlement_groups = tuple(
        str(item).strip() for item in args.entitlement_group if str(item).strip()
    )
    bundle_records = _load_bundle_records(bundle_path)
    export_manifest = _load_optional_json(manifest_path)
    bundle_notice_count = len(bundle_records)
    expected_notice_count = args.expected_notice_count or bundle_notice_count
    if bundle_notice_count != expected_notice_count:
        raise ValueError(
            f"bundle notice count mismatch: expected {expected_notice_count}, got {bundle_notice_count}"
        )

    checkpoint_sizes = resolve_checkpoint_sizes(
        total_count=bundle_notice_count,
        requested_sizes=tuple(args.checkpoint_size),
    )
    request_kwargs = {
        "site_id": args.site_id,
        "source_home_url": args.source_home_url,
        "corpus": args.corpus,
        "collection": args.collection,
        "default_entitlement_groups": (entitlement_groups or ("campus_members",)),
        "visibility_scope": args.visibility_scope,
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    frozen_input = build_frozen_input(
        bundle_path=bundle_path,
        manifest_path=manifest_path,
        export_manifest=export_manifest,
        bundle_notice_count=bundle_notice_count,
        checkpoint_sizes=checkpoint_sizes,
        request_kwargs=request_kwargs,
    )
    _write_json(output_dir / "frozen-input.json", frozen_input)
    emit_runtime_log(
        event="closeout_started",
        output_dir=str(output_dir),
        bundle_path=str(bundle_path),
        manifest_path=(str(manifest_path) if manifest_path is not None else None),
        checkpoint_sizes=list(checkpoint_sizes),
        final_rerun_requested=args.final_rerun,
    )

    checkpoint_runs: list[dict[str, Any]] = []
    closeout_started_at = datetime.now(UTC).isoformat()
    for checkpoint_size in checkpoint_sizes:
        checkpoint_runs.append(
            run_closeout_checkpoint(
                bundle_records=bundle_records,
                full_bundle_path=bundle_path,
                manifest_path=manifest_path,
                checkpoint_size=checkpoint_size,
                total_count=bundle_notice_count,
                output_dir=output_dir,
                request_kwargs=request_kwargs,
                skip_existing=args.skip_existing,
            )
        )
        if not checkpoint_runs[-1]["summary"]["ok"]:
            closeout_summary = build_closeout_summary(
                frozen_input=frozen_input,
                checkpoint_runs=checkpoint_runs,
                final_rerun=None,
                reconciliation=build_reconciliation(
                    bundle_records=bundle_records,
                    site_id=args.site_id,
                    corpus=args.corpus,
                    collection=args.collection,
                    env_source=dict(os.environ),
                ),
                closeout_started_at=closeout_started_at,
            )
            _write_json(output_dir / "closeout-summary.json", closeout_summary)
            emit_runtime_log(
                event="closeout_failed",
                output_dir=str(output_dir),
                failed_checkpoint_size=checkpoint_size,
                checkpoint_failure_sizes=closeout_summary["checkpoint_failure_sizes"],
            )
            print(json.dumps(closeout_summary, ensure_ascii=False, indent=2))
            raise SystemExit(1)

    final_rerun: dict[str, Any] | None = None
    if args.final_rerun:
        final_rerun = run_full_rerun(
            full_bundle_path=bundle_path,
            manifest_path=manifest_path,
            total_count=bundle_notice_count,
            output_dir=output_dir,
            request_kwargs=request_kwargs,
            skip_existing=args.skip_existing,
        )

    closeout_summary = build_closeout_summary(
        frozen_input=frozen_input,
        checkpoint_runs=checkpoint_runs,
        final_rerun=final_rerun,
        reconciliation=build_reconciliation(
            bundle_records=bundle_records,
            site_id=args.site_id,
            corpus=args.corpus,
            collection=args.collection,
            env_source=dict(os.environ),
        ),
        closeout_started_at=closeout_started_at,
    )
    _write_json(output_dir / "closeout-summary.json", closeout_summary)
    emit_runtime_log(
        event="closeout_finished",
        output_dir=str(output_dir),
        ok=closeout_summary["ok"],
        checkpoint_failure_sizes=closeout_summary["checkpoint_failure_sizes"],
        missing_document_id_count=closeout_summary["reconciliation"]["missing_document_id_count"],
        missing_raw_asset_id_count=closeout_summary["reconciliation"]["missing_raw_asset_id_count"],
    )
    print(json.dumps(closeout_summary, ensure_ascii=False, indent=2))
    if not closeout_summary["ok"]:
        raise SystemExit(1)


def resolve_checkpoint_sizes(
    *,
    total_count: int,
    requested_sizes: Sequence[int],
) -> tuple[int, ...]:
    if total_count <= 0:
        raise ValueError("total_count must be positive")
    source = requested_sizes or DEFAULT_CLOSEOUT_CHECKPOINT_SIZES
    sizes = {int(size) for size in source if int(size) > 0 and int(size) < total_count}
    sizes.add(total_count)
    return tuple(sorted(sizes))


def build_frozen_input(
    *,
    bundle_path: Path,
    manifest_path: Path | None,
    export_manifest: dict[str, Any] | None,
    bundle_notice_count: int,
    checkpoint_sizes: Sequence[int],
    request_kwargs: dict[str, Any],
) -> dict[str, Any]:
    manifest_counts = export_manifest.get("counts") if isinstance(export_manifest, dict) else None
    manifest_run = export_manifest.get("run") if isinstance(export_manifest, dict) else None
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "bundle_path": str(bundle_path),
        "manifest_path": str(manifest_path) if manifest_path is not None else None,
        "bundle_notice_count": bundle_notice_count,
        "manifest_schema_version": (
            str(export_manifest.get("schema_version"))
            if isinstance(export_manifest, dict)
            and export_manifest.get("schema_version") is not None
            else None
        ),
        "manifest_export_scope": (
            str(export_manifest.get("export_scope"))
            if isinstance(export_manifest, dict) and export_manifest.get("export_scope") is not None
            else None
        ),
        "manifest_notice_count": (
            int(manifest_counts.get("notices"))
            if isinstance(manifest_counts, dict) and manifest_counts.get("notices") is not None
            else None
        ),
        "manifest_run": (
            {
                "id": manifest_run.get("id"),
                "mode": manifest_run.get("mode"),
                "status": manifest_run.get("status"),
                "pages_fetched": manifest_run.get("pages_fetched"),
                "items_seen": manifest_run.get("items_seen"),
                "items_inserted": manifest_run.get("items_inserted"),
                "items_updated": manifest_run.get("items_updated"),
            }
            if isinstance(manifest_run, dict)
            else None
        ),
        "checkpoint_sizes": list(checkpoint_sizes),
        "request": {
            "site_id": request_kwargs["site_id"],
            "source_home_url": request_kwargs["source_home_url"],
            "corpus": request_kwargs["corpus"],
            "collection": request_kwargs["collection"],
            "default_entitlement_groups": list(request_kwargs["default_entitlement_groups"]),
            "visibility_scope": request_kwargs["visibility_scope"],
        },
        "slice_rule": "cumulative_prefix_only",
        "scope_refresh_risk": "disjoint shards are unsafe because authenticated notice import refreshes the whole collection scope",
        "raw_asset_reconciliation_mode": "expected_coverage_only",
        "raw_asset_reconciliation_reason": "raw asset registry retains scope history and is not replaced by authenticated notice scope refresh",
    }


def run_closeout_checkpoint(
    *,
    bundle_records: list[dict[str, Any]],
    full_bundle_path: Path,
    manifest_path: Path | None,
    checkpoint_size: int,
    total_count: int,
    output_dir: Path,
    request_kwargs: dict[str, Any],
    skip_existing: bool,
) -> dict[str, Any]:
    width = max(4, len(str(total_count)))
    checkpoint_dir = output_dir / f"checkpoint-{checkpoint_size:0{width}d}"
    summary_path = checkpoint_dir / "summary.json"
    checkpoint_kind = "full" if checkpoint_size == total_count else "cumulative_prefix"
    bundle_path = full_bundle_path
    if checkpoint_size < total_count:
        bundle_path = checkpoint_dir / f"notices-bundle-slice-{checkpoint_size}.json"
        if not bundle_path.exists():
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            _write_json(bundle_path, bundle_records[:checkpoint_size])

    if skip_existing and summary_path.exists():
        emit_runtime_log(
            event="checkpoint_reused",
            checkpoint_size=checkpoint_size,
            checkpoint_kind=checkpoint_kind,
            bundle_path=str(bundle_path),
            summary_path=str(summary_path),
        )
        summary = _load_json(summary_path)
    else:
        emit_runtime_log(
            event="checkpoint_started",
            checkpoint_size=checkpoint_size,
            checkpoint_kind=checkpoint_kind,
            bundle_path=str(bundle_path),
            summary_path=str(summary_path),
        )
        summary = run_with_heartbeat(
            operation=lambda: _run_import_summary(
                bundle_path=bundle_path,
                manifest_path=manifest_path,
                expected_notice_count=checkpoint_size,
                summary_path=summary_path,
                execution_extra={
                    "checkpoint_size": checkpoint_size,
                    "checkpoint_kind": checkpoint_kind,
                },
                request_kwargs=request_kwargs,
            ),
            logger=emit_runtime_log,
            heartbeat_event="checkpoint_heartbeat",
            heartbeat_interval_seconds=DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
            heartbeat_fields={
                "checkpoint_size": checkpoint_size,
                "checkpoint_kind": checkpoint_kind,
                "bundle_path": str(bundle_path),
                "summary_path": str(summary_path),
            },
        )
    emit_runtime_log(
        event="checkpoint_finished",
        checkpoint_size=checkpoint_size,
        checkpoint_kind=checkpoint_kind,
        bundle_path=str(bundle_path),
        summary_path=str(summary_path),
        ok=bool(summary.get("ok")),
        elapsed_seconds=_extract_elapsed_seconds(summary),
    )

    return {
        "checkpoint_size": checkpoint_size,
        "bundle_path": str(bundle_path),
        "summary_path": str(summary_path),
        "summary": summary,
    }


def run_full_rerun(
    *,
    full_bundle_path: Path,
    manifest_path: Path | None,
    total_count: int,
    output_dir: Path,
    request_kwargs: dict[str, Any],
    skip_existing: bool,
) -> dict[str, Any]:
    rerun_dir = output_dir / "final-rerun"
    summary_path = rerun_dir / "summary.json"
    if skip_existing and summary_path.exists():
        emit_runtime_log(
            event="final_rerun_reused",
            bundle_path=str(full_bundle_path),
            summary_path=str(summary_path),
        )
        summary = _load_json(summary_path)
    else:
        emit_runtime_log(
            event="final_rerun_started",
            bundle_path=str(full_bundle_path),
            summary_path=str(summary_path),
        )
        summary = run_with_heartbeat(
            operation=lambda: _run_import_summary(
                bundle_path=full_bundle_path,
                manifest_path=manifest_path,
                expected_notice_count=total_count,
                summary_path=summary_path,
                execution_extra={
                    "checkpoint_size": total_count,
                    "checkpoint_kind": "final_rerun",
                },
                request_kwargs=request_kwargs,
            ),
            logger=emit_runtime_log,
            heartbeat_event="final_rerun_heartbeat",
            heartbeat_interval_seconds=DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
            heartbeat_fields={
                "checkpoint_size": total_count,
                "checkpoint_kind": "final_rerun",
                "bundle_path": str(full_bundle_path),
                "summary_path": str(summary_path),
            },
        )
    emit_runtime_log(
        event="final_rerun_finished",
        bundle_path=str(full_bundle_path),
        summary_path=str(summary_path),
        ok=bool(summary.get("ok")),
        elapsed_seconds=_extract_elapsed_seconds(summary),
    )
    return {
        "bundle_path": str(full_bundle_path),
        "summary_path": str(summary_path),
        "summary": summary,
    }


def emit_runtime_log(*, event: str, **fields: object) -> None:
    payload = {
        "ts": datetime.now(UTC).isoformat(),
        "event": event,
        **fields,
    }
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr, flush=True)


def run_with_heartbeat[T](
    *,
    operation: Callable[[], T],
    logger: Callable[..., None],
    heartbeat_event: str,
    heartbeat_interval_seconds: float,
    heartbeat_fields: dict[str, object],
) -> T:
    if heartbeat_interval_seconds <= 0:
        return operation()

    started = time.monotonic()
    stop_event = threading.Event()

    def _heartbeat() -> None:
        while not stop_event.wait(heartbeat_interval_seconds):
            logger(
                event=heartbeat_event,
                elapsed_seconds=round(time.monotonic() - started, 2),
                **heartbeat_fields,
            )

    heartbeat_thread = threading.Thread(
        target=_heartbeat,
        name=f"authenticated-notice-{heartbeat_event}",
        daemon=True,
    )
    heartbeat_thread.start()
    try:
        return operation()
    finally:
        stop_event.set()
        heartbeat_thread.join(timeout=max(heartbeat_interval_seconds, 0.1))


def build_reconciliation(
    *,
    bundle_records: Sequence[dict[str, Any]],
    site_id: str,
    corpus: str,
    collection: str,
    env_source: dict[str, str],
) -> dict[str, Any]:
    expected_document_ids = {
        f"notice:{site_id}:{_extract_notice_id(record)}" for record in bundle_records
    }
    expected_raw_asset_ids = {
        build_authenticated_notice_raw_asset_id(site_id, _extract_notice_id(record))
        for record in bundle_records
    }
    document_registry = build_document_registry_from_env(env_source)
    raw_asset_registry = build_raw_asset_registry_from_env(env_source)
    document_records = tuple(document_registry.list_by_scope(corpus, collection))
    raw_records = tuple(raw_asset_registry.list_by_scope(corpus, collection))

    latest_documents = _latest_document_records(document_records)
    observed_document_ids = set(latest_documents)
    observed_raw_asset_ids = {
        str(getattr(record, "raw_asset_id", "")).strip()
        for record in raw_records
        if str(getattr(record, "raw_asset_id", "")).strip()
    }

    missing_document_ids = sorted(expected_document_ids - observed_document_ids)
    unexpected_document_ids = sorted(observed_document_ids - expected_document_ids)
    missing_raw_asset_ids = sorted(expected_raw_asset_ids - observed_raw_asset_ids)
    unexpected_raw_asset_ids = sorted(observed_raw_asset_ids - expected_raw_asset_ids)

    missing_document_units: list[str] = []
    missing_notice_manifest: list[str] = []
    non_restricted_document_ids: list[str] = []
    restricted_document_count = 0
    for document_id, record in latest_documents.items():
        if document_id not in expected_document_ids:
            continue
        if str(getattr(record, "visibility_level", "")).strip() == "restricted":
            restricted_document_count += 1
        else:
            non_restricted_document_ids.append(document_id)
        processed_keys = tuple(
            str(item).strip()
            for item in tuple(getattr(record, "processed_object_keys", ()) or ())
            if str(item).strip()
        )
        document_units_key = str(getattr(record, "document_units_object_key", "") or "").strip()
        if not document_units_key and not any(
            key.endswith("/document-units.jsonl") for key in processed_keys
        ):
            missing_document_units.append(document_id)
        if not any(key.endswith("/source-truth/notice-manifest.json") for key in processed_keys):
            missing_notice_manifest.append(document_id)

    return {
        "expected_notice_count": len(bundle_records),
        "expected_document_id_count": len(expected_document_ids),
        "expected_raw_asset_id_count": len(expected_raw_asset_ids),
        "observed_document_record_count": len(document_records),
        "observed_document_id_count": len(observed_document_ids),
        "observed_raw_record_count": len(raw_records),
        "observed_raw_asset_id_count": len(observed_raw_asset_ids),
        "matching_document_id_count": len(expected_document_ids & observed_document_ids),
        "matching_raw_asset_id_count": len(expected_raw_asset_ids & observed_raw_asset_ids),
        "missing_document_id_count": len(missing_document_ids),
        "missing_document_ids_sample": missing_document_ids[:SAMPLE_LIMIT],
        "unexpected_document_id_count": len(unexpected_document_ids),
        "unexpected_document_ids_sample": unexpected_document_ids[:SAMPLE_LIMIT],
        "missing_raw_asset_id_count": len(missing_raw_asset_ids),
        "missing_raw_asset_ids_sample": missing_raw_asset_ids[:SAMPLE_LIMIT],
        "unexpected_raw_asset_id_count": len(unexpected_raw_asset_ids),
        "unexpected_raw_asset_ids_sample": unexpected_raw_asset_ids[:SAMPLE_LIMIT],
        "raw_asset_scope_exact_match_required": False,
        "restricted_document_count": restricted_document_count,
        "non_restricted_document_id_count": len(non_restricted_document_ids),
        "non_restricted_document_ids_sample": non_restricted_document_ids[:SAMPLE_LIMIT],
        "missing_document_units_count": len(missing_document_units),
        "missing_document_units_sample": missing_document_units[:SAMPLE_LIMIT],
        "missing_notice_manifest_count": len(missing_notice_manifest),
        "missing_notice_manifest_sample": missing_notice_manifest[:SAMPLE_LIMIT],
    }


def build_closeout_summary(
    *,
    frozen_input: dict[str, Any],
    checkpoint_runs: Sequence[dict[str, Any]],
    final_rerun: dict[str, Any] | None,
    reconciliation: dict[str, Any],
    closeout_started_at: str,
) -> dict[str, Any]:
    checkpoint_failures = [
        run["checkpoint_size"] for run in checkpoint_runs if not bool(run["summary"].get("ok"))
    ]
    final_rerun_ok = final_rerun is None or bool(final_rerun["summary"].get("ok"))
    ok = (
        not checkpoint_failures
        and final_rerun_ok
        and reconciliation["missing_document_id_count"] == 0
        and reconciliation["missing_raw_asset_id_count"] == 0
        and reconciliation["unexpected_document_id_count"] == 0
        and reconciliation["missing_document_units_count"] == 0
        and reconciliation["missing_notice_manifest_count"] == 0
        and reconciliation["non_restricted_document_id_count"] == 0
    )
    return {
        "ok": ok,
        "generated_at": datetime.now(UTC).isoformat(),
        "closeout_started_at": closeout_started_at,
        "frozen_input": frozen_input,
        "checkpoints": [
            {
                "checkpoint_size": run["checkpoint_size"],
                "bundle_path": run["bundle_path"],
                "summary_path": run["summary_path"],
                "ok": bool(run["summary"].get("ok")),
                "elapsed_seconds": (
                    run["summary"].get("execution", {}).get("elapsed_seconds")
                    if isinstance(run["summary"].get("execution"), dict)
                    else None
                ),
            }
            for run in checkpoint_runs
        ],
        "final_rerun": (
            {
                "bundle_path": final_rerun["bundle_path"],
                "summary_path": final_rerun["summary_path"],
                "ok": bool(final_rerun["summary"].get("ok")),
                "elapsed_seconds": (
                    final_rerun["summary"].get("execution", {}).get("elapsed_seconds")
                    if isinstance(final_rerun["summary"].get("execution"), dict)
                    else None
                ),
            }
            if final_rerun is not None
            else None
        ),
        "checkpoint_failure_sizes": checkpoint_failures,
        "reconciliation": reconciliation,
    }


def _run_import_summary(
    *,
    bundle_path: Path,
    manifest_path: Path | None,
    expected_notice_count: int,
    summary_path: Path,
    execution_extra: dict[str, Any],
    request_kwargs: dict[str, Any],
) -> dict[str, Any]:
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    request = AuthenticatedNoticeImportRequest(
        bundle_path=bundle_path,
        export_manifest_path=manifest_path,
        **request_kwargs,
    )
    started = time.monotonic()
    result = import_authenticated_notice_export(request=request)
    elapsed_seconds = round(time.monotonic() - started, 2)
    summary = build_smoke_summary(
        result=result,
        expected_notice_count=expected_notice_count,
        execution={
            "summary_generated_at": datetime.now(UTC).isoformat(),
            "bundle_path": str(request.bundle_path),
            "manifest_path": (
                str(request.export_manifest_path)
                if request.export_manifest_path is not None
                else None
            ),
            "site_id": request.site_id,
            "source_home_url": request.source_home_url,
            "corpus": request.corpus,
            "collection": request.collection,
            "entitlement_groups": list(request.default_entitlement_groups),
            "visibility_scope": request.visibility_scope,
            "elapsed_seconds": elapsed_seconds,
            **execution_extra,
        },
    )
    _write_json(summary_path, summary)
    return summary


def _extract_notice_id(bundle_record: dict[str, Any]) -> str:
    notice = bundle_record.get("notice") if isinstance(bundle_record, dict) else None
    if isinstance(notice, dict) and notice.get("notice_id") is not None:
        return str(notice["notice_id"]).strip()
    if isinstance(bundle_record, dict) and bundle_record.get("notice_id") is not None:
        return str(bundle_record["notice_id"]).strip()
    raise ValueError("bundle record notice_id is required")


def _latest_document_records(records: Sequence[object]) -> dict[str, object]:
    latest: dict[str, object] = {}
    for record in records:
        document_id = str(getattr(record, "document_id", "")).strip()
        if not document_id:
            continue
        current = latest.get(document_id)
        if current is None or str(getattr(record, "ingestion_timestamp", "")) > str(
            getattr(current, "ingestion_timestamp", "")
        ):
            latest[document_id] = record
    return latest


def _load_bundle_records(path: Path) -> list[dict[str, Any]]:
    payload = _load_json(path)
    if not isinstance(payload, list):
        raise ValueError("authenticated notice bundle must be a JSON list")
    return [dict(item) for item in payload]


def _load_optional_json(path: Path | None) -> dict[str, Any] | None:
    if path is None:
        return None
    payload = _load_json(path)
    if not isinstance(payload, dict):
        raise ValueError("authenticated notice manifest must be a JSON object")
    return payload


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
    )


def _extract_elapsed_seconds(summary: dict[str, Any]) -> float | None:
    execution = summary.get("execution")
    if not isinstance(execution, dict):
        return None
    elapsed = execution.get("elapsed_seconds")
    if elapsed is None:
        return None
    return float(elapsed)


__all__ = [
    "build_closeout_summary",
    "build_frozen_input",
    "build_parser",
    "build_reconciliation",
    "emit_runtime_log",
    "main",
    "resolve_checkpoint_sizes",
    "run_closeout_checkpoint",
    "run_full_rerun",
    "run_with_heartbeat",
]


if __name__ == "__main__":
    main()
