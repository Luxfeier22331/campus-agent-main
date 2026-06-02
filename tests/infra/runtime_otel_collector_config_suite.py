from __future__ import annotations

import re
import unittest
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
LOCAL_CONFIG = REPO_ROOT / "infra/otel/collector-local-debug.yaml"
STAGING_CONFIG = REPO_ROOT / "infra/otel/collector-staging-template.yaml"
ENV_EXAMPLE = REPO_ROOT / "infra/otel/collector.env.example"

COMMON_PROCESSORS = [
    "memory_limiter",
    "resource/campus",
    "attributes/drop_forbidden",
    "filter/drop_marked",
]

FORBIDDEN_FIELDS = {
    "raw.prompt",
    "raw.query",
    "raw.answer",
    "raw.chat_transcript",
    "raw.retrieved_snippet",
    "chunk.body",
    "canonical.body",
    "ocr.raw_text",
    "authorization",
    "cookie",
    "jwt",
    "api.key",
    "database.url",
    "object_store.secret",
    "provider.secret",
}


class RuntimeOtelCollectorConfigTest(unittest.TestCase):
    def test_local_debug_collector_config_has_safe_debug_pipeline(self) -> None:
        config = _load_yaml(LOCAL_CONFIG)

        self.assertIn("otlp", config["receivers"])
        self.assertIn("health_check", config["extensions"])
        self.assertEqual(config["service"]["extensions"], ["health_check"])
        self.assertIn("debug", config["exporters"])
        self.assert_processor_chain(config)
        self.assert_pipeline(
            config,
            "traces",
            processors=[*COMMON_PROCESSORS, "batch"],
            exporters={"debug"},
        )
        self.assert_pipeline(
            config,
            "metrics",
            processors=[*COMMON_PROCESSORS, "batch"],
            exporters={"debug"},
        )
        self.assert_pipeline(
            config,
            "logs",
            processors=[*COMMON_PROCESSORS, "batch"],
            exporters={"debug"},
        )

    def test_staging_collector_config_fans_out_to_sentry_axiom_and_debug(self) -> None:
        config = _load_yaml(STAGING_CONFIG)

        exporters = set(config["exporters"])
        self.assertIn("otlphttp/sentry", exporters)
        self.assertIn("otlphttp/axiom", exporters)
        self.assertNotIn("otlphttp/axiom_metrics", exporters)
        self.assertIn("debug", exporters)
        self.assertIn("health_check", config["extensions"])
        self.assertEqual(config["service"]["extensions"], ["health_check"])
        self.assert_processor_chain(config)
        self.assertIn("probabilistic_sampler/traces", config["processors"])
        self.assertIn("probabilistic_sampler/logs", config["processors"])
        self.assert_pipeline(
            config,
            "traces",
            processors=[
                *COMMON_PROCESSORS,
                "probabilistic_sampler/traces",
                "batch",
            ],
            exporters={"otlphttp/sentry", "otlphttp/axiom", "debug"},
        )
        self.assert_pipeline(
            config,
            "metrics",
            processors=[*COMMON_PROCESSORS, "batch"],
            exporters={"debug"},
        )
        self.assert_pipeline(
            config,
            "logs",
            processors=[
                *COMMON_PROCESSORS,
                "probabilistic_sampler/logs",
                "batch",
            ],
            exporters={"otlphttp/axiom", "debug"},
        )
        self.assert_env_only_secret_values(config)

    def test_collector_configs_delete_forbidden_attributes(self) -> None:
        for config in (_load_yaml(LOCAL_CONFIG), _load_yaml(STAGING_CONFIG)):
            actions = config["processors"]["attributes/drop_forbidden"]["actions"]
            delete_keys = {
                str(action["key"]) for action in actions if action.get("action") == "delete"
            }
            self.assertTrue(FORBIDDEN_FIELDS.issubset(delete_keys))

    def test_env_example_documents_required_sink_secrets_without_values(self) -> None:
        content = ENV_EXAMPLE.read_text(encoding="utf-8")

        for name in (
            "OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT",
            "OTEL_COLLECTOR_SENTRY_AUTH_VALUE",
            "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT",
            "OTEL_COLLECTOR_AXIOM_AUTH_HEADER",
            "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET",
        ):
            self.assertIsNotNone(
                re.search(rf"^{name}=$", content, re.MULTILINE),
                msg=f"{name} must be blank",
            )
        self.assertNotIn("Bearer ", content)
        self.assertNotIn("dsn=", content.lower())

    def assert_processor_chain(
        self,
        config: dict[str, object],
    ) -> None:
        processors = set(config["processors"])
        for processor in COMMON_PROCESSORS:
            self.assertIn(processor, processors)
        self.assertIn("batch", processors)

    def assert_pipeline(
        self,
        config: dict[str, object],
        signal: str,
        *,
        processors: list[str],
        exporters: set[str],
    ) -> None:
        pipeline = config["service"]["pipelines"][signal]
        self.assertEqual(pipeline["receivers"], ["otlp"])
        self.assertEqual(pipeline["processors"], processors)
        self.assertTrue(exporters.issubset(set(pipeline["exporters"])))

    def assert_env_only_secret_values(self, config: dict[str, object]) -> None:
        rendered = STAGING_CONFIG.read_text(encoding="utf-8")
        secretish_literals = re.findall(
            r"(?i)(bearer\s+[a-z0-9._-]+|dsn=[a-z0-9._:/?-]+|apikey=[a-z0-9._-]+)",
            rendered,
        )
        self.assertEqual(secretish_literals, [])
        self.assertIn("${env:OTEL_COLLECTOR_SENTRY_AUTH_VALUE}", rendered)
        self.assertIn("${env:OTEL_COLLECTOR_AXIOM_AUTH_HEADER}", rendered)
        self.assertIn("${env:OTEL_COLLECTOR_AXIOM_EVENTS_DATASET}", rendered)
        self.assertNotIn("OTEL_COLLECTOR_AXIOM_METRICS_DATASET", rendered)

    def test_sentry_exporter_uses_official_otlp_auth_header(self) -> None:
        config = _load_yaml(STAGING_CONFIG)
        sentry_exporter = config["exporters"]["otlphttp/sentry"]

        self.assertEqual(
            sentry_exporter["headers"],
            {"x-sentry-auth": "${env:OTEL_COLLECTOR_SENTRY_AUTH_VALUE}"},
        )
        self.assertEqual(sentry_exporter["compression"], "gzip")
        self.assertEqual(sentry_exporter["encoding"], "proto")


def _load_yaml(path: Path) -> dict[str, object]:
    with path.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle)
    if not isinstance(payload, dict):
        raise AssertionError(f"{path} did not parse to a YAML mapping")
    return payload


if __name__ == "__main__":
    unittest.main()
