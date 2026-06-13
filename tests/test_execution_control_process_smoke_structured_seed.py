from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from scripts import execution_control_process_smoke_runtime as runtime


class ExecutionControlProcessSmokeStructuredSeedTest(unittest.TestCase):
    def test_structured_seed_publishes_selected_collection_without_worker_cli(self) -> None:
        publisher = _RecordingPublisher()

        with TemporaryDirectory() as temp_dir:
            log_path = Path(temp_dir) / "structured-seed.log"
            with (
                patch.object(
                    runtime,
                    "build_structured_projection_publisher_from_env",
                    return_value=publisher,
                    create=True,
                ) as build_publisher,
                patch.object(
                    runtime, "close_persistent_postgres_pools", create=True
                ) as close_pools,
                patch("subprocess.run") as subprocess_run,
            ):
                subprocess_run.side_effect = AssertionError(
                    "structured process smoke seed must not invoke ingestion-worker CLI"
                )

                runtime._seed_structured_projection_smoke(
                    repo_root=Path(temp_dir),
                    runtime_database_url="postgresql://process-smoke/runtime",
                    log_path=log_path,
                    timeout_seconds=1.0,
                    collections=("transport_schedule",),
                    generated_at="2026-04-24T20:30:00+08:00",
                )
            payload = json.loads(log_path.read_text(encoding="utf-8"))

        build_publisher.assert_called_once_with(
            {"CAMPUS_SHARED_POSTGRES_URL": "postgresql://process-smoke/runtime"},
            bootstrap_collections=("transport_schedule",),
        )
        close_pools.assert_called_once_with()
        subprocess_run.assert_not_called()
        self.assertEqual(
            [call["collection"] for call in publisher.publish_calls],
            ["transport_schedule"],
        )
        call = publisher.publish_calls[0]
        self.assertEqual(call["corpus"], "campus_services")
        self.assertEqual(call["release_id"], "execution-control-process-smoke-transport-schedule")
        bundle = call["bundle"]
        assert isinstance(bundle, dict)
        self.assertEqual(len(bundle["transport_routes"]), 2)
        self.assertEqual(len(bundle["scheduled_departures"]), 2)
        self.assertEqual(bundle["transport_operational_notices"][0]["notice_id"], "353903")
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["collections"], ["transport_schedule"])


class _RecordingPublisher:
    def __init__(self) -> None:
        self.publish_calls: list[dict[str, object]] = []
        self.current_release_by_collection: dict[str, str] = {}

    def publish_release(self, **kwargs: object) -> SimpleNamespace:
        self.publish_calls.append(dict(kwargs))
        collection = str(kwargs["collection"])
        release_id = str(kwargs["release_id"])
        self.current_release_by_collection[collection] = release_id
        bundle = kwargs["bundle"]
        if not isinstance(bundle, dict):
            raise AssertionError("bundle must be a dict")
        counts = {
            "snapshots": len(bundle.get("transport_schedule_snapshots", [])),
            "routes": len(bundle.get("transport_routes", [])),
            "scheduled_departures": len(bundle.get("scheduled_departures", [])),
            "operational_notices": len(bundle.get("transport_operational_notices", [])),
        }
        return SimpleNamespace(release_id=release_id, counts=counts)

    def get_current_release(self, *, corpus: str, collection: str) -> str:
        return self.current_release_by_collection[collection]


if __name__ == "__main__":
    unittest.main()
