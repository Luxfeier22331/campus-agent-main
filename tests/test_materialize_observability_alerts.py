from __future__ import annotations

import unittest

from scripts.materialize_observability_alerts import materialize_alert_artifact


class ObservabilityAlertMaterializerTest(unittest.TestCase):
    def test_materializes_enabled_alert_rules_to_axiom_monitor_specs(self) -> None:
        artifact = {
            "alert_version": "observability-alerts-test",
            "rules": [
                {
                    "id": "stage.stream_ttft.p95.warn",
                    "signal": "stage_latency_p95",
                    "severity": "ticket",
                    "window": "15m",
                    "stage_field": "stream.browser_ttft_ms",
                    "threshold": {"operator": "gte", "value": 2500, "unit": "ms"},
                    "runbook_anchor": "#stage-latency",
                    "enabled": True,
                },
                {
                    "id": "requests.error_rate.page",
                    "signal": "request_error_rate",
                    "severity": "page",
                    "window": "15m",
                    "threshold": {"operator": "gte", "value": 0.02, "unit": "ratio"},
                    "runbook_anchor": "#request-errors",
                    "enabled": True,
                },
                {
                    "id": "disabled.rule",
                    "signal": "telemetry_export_failure",
                    "severity": "ticket",
                    "window": "15m",
                    "threshold": {"operator": "gte", "value": 1, "unit": "count"},
                    "runbook_anchor": "#telemetry-export",
                    "enabled": False,
                },
            ],
        }

        result = materialize_alert_artifact(artifact)

        self.assertEqual(result["schema_version"], "axiom-monitor-materialization-v1")
        self.assertEqual(result["source_alert_version"], "observability-alerts-test")
        monitors = result["monitors"]
        self.assertEqual(len(monitors), 2)
        stage_monitor = monitors[0]
        self.assertEqual(stage_monitor["dataset"], "campus-agent-runtime-metrics")
        self.assertIn("campus.app_api.stage_duration_ms", stage_monitor["query"])
        self.assertIn("stream.browser_ttft_ms", stage_monitor["query"])
        self.assertIn("percentile", stage_monitor["query"])
        request_monitor = monitors[1]
        self.assertEqual(request_monitor["severity"], "page")
        self.assertIn("campus.app_api.request_error_ratio", request_monitor["query"])

    def test_rejects_stage_latency_rule_without_stage_field(self) -> None:
        artifact = {
            "alert_version": "observability-alerts-test",
            "rules": [
                {
                    "id": "stage.invalid",
                    "signal": "stage_latency_p95",
                    "severity": "ticket",
                    "window": "15m",
                    "threshold": {"operator": "gte", "value": 2500, "unit": "ms"},
                    "runbook_anchor": "#stage-latency",
                    "enabled": True,
                }
            ],
        }

        with self.assertRaisesRegex(ValueError, "requires stage_field"):
            materialize_alert_artifact(artifact)


if __name__ == "__main__":
    unittest.main()
