from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
RUN_SCRIPT = REPO_ROOT / "scripts/run-internal-notice-multimodal-drain.sh"
SERVICE_UNIT = REPO_ROOT / "infra/local/systemd/campus-ingestion-internal-notice.service"
TIMER_UNIT = REPO_ROOT / "infra/local/systemd/campus-ingestion-internal-notice.timer"


class IngestionWorkerOnDemandOpsTest(unittest.TestCase):
    def test_internal_notice_drain_script_runs_bounded_batch_without_promotion(self) -> None:
        script = RUN_SCRIPT.read_text(encoding="utf-8")

        self.assertTrue(script.startswith("#!/usr/bin/env bash\n"))
        self.assertIn("set -euo pipefail", script)
        self.assertIn("campus_ingestion_worker.on_demand_batch_runner", script)
        self.assertIn("internal-notice-multimodal-drain", script)
        self.assertIn("INGESTION_ON_DEMAND_DRAIN_LIMIT:-100", script)
        self.assertIn("INGESTION_ON_DEMAND_DRAIN_BATCH_SIZE:-20", script)
        self.assertIn("INGESTION_ON_DEMAND_DRAIN_MAX_ATTEMPTS:-3", script)
        self.assertIn("INGESTION_ON_DEMAND_REPORT_DIR:-.tmp/ingestion-reports", script)
        self.assertIn("date -u +%Y%m%dT%H%M%SZ", script)
        self.assertNotIn("--promote", script)

    def test_systemd_units_call_tracked_script_as_oneshot_daily_timer(self) -> None:
        service = SERVICE_UNIT.read_text(encoding="utf-8")
        timer = TIMER_UNIT.read_text(encoding="utf-8")

        self.assertIn("Type=oneshot", service)
        self.assertIn("WorkingDirectory=/srv/campus-agent", service)
        self.assertIn(
            "ExecStart=/srv/campus-agent/scripts/run-internal-notice-multimodal-drain.sh",
            service,
        )
        self.assertNotIn("--promote", service)
        self.assertIn("OnCalendar=*-*-* 03:30:00", timer)
        self.assertIn("Persistent=true", timer)
        self.assertIn("WantedBy=timers.target", timer)


if __name__ == "__main__":
    unittest.main()
