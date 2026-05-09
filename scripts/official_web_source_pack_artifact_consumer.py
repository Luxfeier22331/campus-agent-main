from __future__ import annotations

import json
import os
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.in_memory_registries import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
)
from campus_ingestion_core.official_web_release_task_store import (
    build_official_web_release_task_store_from_env,
)
from campus_ingestion_worker.official_web_handoff_consumer import (
    OfficialWebHandoffConsumerSettings,
    consume_official_web_handoffs,
)
from campus_ingestion_worker.official_web_handoff_consumer_models import (
    DEFAULT_BUCKET_SOURCE,
    HttpOfficialWebExecutionStatusReporter,
    OfficialWebExecutionStatusReporter,
)

from scripts.official_web_live_seam_no_promotion import load_env_file


class ArtifactBackedOfficialWebSourceObjectStore:
    def __init__(
        self,
        *,
        collector_output_dir: Path,
        site_id: str,
        run_id: str,
    ) -> None:
        self._collector_output_dir = collector_output_dir
        self._site_id = site_id
        self._run_id = run_id
        self._derived_root = collector_output_dir.parent / "_derived-object-store"

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        path = self._path_for_key(key)
        try:
            return path.read_bytes()
        except FileNotFoundError as exc:
            raise FileNotFoundError(f"artifact-backed object not found: {bucket}/{key}") from exc

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        path = self._derived_root / bucket / Path(*key.split("/"))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        _ = content_type

    def _path_for_key(self, key: str) -> Path:
        normalized = key.strip().strip("/")
        if normalized == self._bundle_key:
            return self._collector_output_dir / "source-truth-bundle.json"
        segments = normalized.split("/")
        if len(segments) < 5 or segments[0] != "official_web":
            raise FileNotFoundError(f"unsupported artifact-backed key: {key}")
        raw_asset_id = segments[1]
        year_label = segments[2]
        raw_version_id = segments[3]
        remainder = segments[4:]
        if year_label != "undated":
            raise FileNotFoundError(f"unsupported official_web year label for local seam: {key}")
        if not remainder:
            raise FileNotFoundError(f"unsupported official_web artifact key: {key}")
        return (
            self._collector_output_dir
            / "source-assets"
            / raw_asset_id
            / raw_version_id
            / Path(*remainder)
        )

    @property
    def _bundle_key(self) -> str:
        return f"official_web/{self._site_id}/runs/{self._run_id}/source-truth-bundle.json"


def build_local_artifact_backed_consumer_result(
    *,
    repo_root: Path,
    output_root: Path,
    site_id: str,
    run_id: str,
    event_id: str,
    app_api_base_url: str,
    internal_shared_secret: str,
    status_reporter: OfficialWebExecutionStatusReporter | None = None,
) -> dict[str, object]:
    collector_output_dir = output_root / "collector-output"
    object_store = ArtifactBackedOfficialWebSourceObjectStore(
        collector_output_dir=collector_output_dir,
        site_id=site_id,
        run_id=run_id,
    )
    settings = OfficialWebHandoffConsumerSettings(
        inbox_dir=output_root / "handoffs",
        execution_root_dir=output_root / "executions",
        source_bucket=_resolve_source_bucket(repo_root),
        promote_import=False,
    )
    runtime_status_reporter = status_reporter
    if runtime_status_reporter is None and internal_shared_secret.strip():
        runtime_status_reporter = HttpOfficialWebExecutionStatusReporter(
            base_url=app_api_base_url,
            internal_shared_secret=internal_shared_secret,
        )
    release_task_env = {
        **os.environ,
        **load_env_file(repo_root / ".env"),
        **load_env_file(repo_root / "apps" / "app-api" / ".env"),
        **load_env_file(repo_root / "apps" / "app-api" / ".dev.vars"),
    }
    release_task_store = build_official_web_release_task_store_from_env(release_task_env)
    report = consume_official_web_handoffs(
        settings=settings,
        object_store=object_store,
        derived_object_store=object_store,
        document_registry=InMemoryDocumentRegistry(),
        raw_asset_registry=InMemoryRawAssetRegistry(),
        event_id=event_id,
        limit=1,
        force=True,
        promote_import=False,
        status_reporter=runtime_status_reporter,
        release_task_store=release_task_store,
    )
    result = asdict(report)
    (output_root / "consumer.log").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return result


def _resolve_source_bucket(repo_root: Path) -> str:
    bucket = (
        load_env_file(repo_root / ".env").get("OBJECT_STORE_BUCKET_SOURCE")
        or os.environ.get("OBJECT_STORE_BUCKET_SOURCE")
        or DEFAULT_BUCKET_SOURCE
    )
    normalized = str(bucket).strip()
    return normalized or DEFAULT_BUCKET_SOURCE
