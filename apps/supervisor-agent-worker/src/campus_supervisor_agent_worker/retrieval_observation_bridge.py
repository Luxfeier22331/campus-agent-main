from __future__ import annotations

import json
import logging
from collections.abc import Callable, Mapping
from pathlib import Path
from threading import Lock

try:
    from opentelemetry import metrics
    from opentelemetry._logs import set_logger_provider
    from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
    from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    OTEL_AVAILABLE = True
except Exception:  # pragma: no cover - dependency absence is handled at runtime
    metrics = None
    set_logger_provider = None
    OTLPLogExporter = None
    OTLPMetricExporter = None
    OTLPSpanExporter = None
    LoggerProvider = None
    LoggingHandler = None
    BatchLogRecordProcessor = None
    MeterProvider = None
    PeriodicExportingMetricReader = None
    Resource = None
    TracerProvider = None
    BatchSpanProcessor = None
    OTEL_AVAILABLE = False

_LOGGER = logging.getLogger(__name__)

RetrievalObservationSink = Callable[[dict[str, object]], None]
RuntimeEventEmitter = Callable[[str, dict[str, object]], None]

_ALLOWED_SCALAR_FIELDS = frozenset(
    {
        "schema_version",
        "request_id",
        "plan_id",
        "step_id",
        "query_mode",
        "retrieval_mode",
        "terminal_state",
        "failure_kind",
        "candidate_count",
        "reference_count",
        "latency_ms",
        "query_sha256",
        "canonical_index_truth",
        "top_score",
        "score_gap",
        "as_of",
        "reranker_failure_kind",
    }
)


def sanitize_retrieval_observation(observation: Mapping[str, object]) -> dict[str, object]:
    sanitized: dict[str, object] = {}
    for field in _ALLOWED_SCALAR_FIELDS:
        if field in observation:
            sanitized[field] = _sanitize_scalar(observation[field])

    scope = observation.get("scope")
    if isinstance(scope, Mapping):
        corpus = _sanitize_scalar(scope.get("corpus"))
        collection = _sanitize_scalar(scope.get("collection"))
        if corpus:
            sanitized["scope.corpus"] = corpus
        if collection:
            sanitized["scope.collection"] = collection

    for source_field, count_field in (
        ("target_document_ids", "target_document_ids_count"),
        ("target_version_ids", "target_version_ids_count"),
        ("top_source_ids", "top_source_ids_count"),
        ("source_timestamps", "source_timestamps_count"),
    ):
        if source_field in observation:
            sanitized[count_field] = _bounded_count(observation[source_field])

    has_reference_count = "reference_count" in sanitized
    reference_count = _as_int(sanitized.get("reference_count"))
    terminal_state = str(sanitized.get("terminal_state") or "")
    failure_kind = str(sanitized.get("failure_kind") or "")
    sanitized["no_hit"] = has_reference_count and reference_count == 0
    sanitized["low_confidence"] = (
        has_reference_count and terminal_state == "completed" and reference_count == 0
    )
    sanitized["release_metadata_drift"] = failure_kind == "release_metadata_drift"

    return {key: value for key, value in sanitized.items() if value is not None}


def build_retrieval_runtime_event_sink(
    emit_event: RuntimeEventEmitter,
) -> RetrievalObservationSink:
    def sink(observation: dict[str, object]) -> None:
        emit_event(
            "retrieval.runtime_observation",
            sanitize_retrieval_observation(observation),
        )

    return sink


def build_runtime_event_jsonl_emitter(path: str | Path) -> RuntimeEventEmitter:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_lock = Lock()

    def emit_event(event_name: str, attributes: dict[str, object]) -> None:
        record = {"event_name": event_name, "attributes": dict(attributes)}
        line = json.dumps(record, ensure_ascii=False, sort_keys=True, default=str)
        with write_lock, output_path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")

    return emit_event


def build_runtime_event_emitter_status(
    *,
    otel_enabled: bool,
    traces_endpoint: str,
    metrics_endpoint: str,
    logs_endpoint: str,
) -> dict[str, object]:
    return {
        "enabled": otel_enabled,
        "configured": bool(traces_endpoint or metrics_endpoint or logs_endpoint),
        "transport": "otlp_http" if otel_enabled else "jsonl",
        "traces_configured": bool(traces_endpoint),
        "metrics_configured": bool(metrics_endpoint),
        "logs_configured": bool(logs_endpoint),
    }


def build_runtime_event_otlp_emitter(
    *,
    enabled: bool,
    service_name: str,
    allowed_attributes_version: str,
    traces_endpoint: str,
    metrics_endpoint: str,
    logs_endpoint: str,
    export_timeout_seconds: float,
    export_interval_seconds: float,
    headers: str,
) -> RuntimeEventEmitter:
    if not enabled:
        raise ValueError("OTLP runtime event emitter requires enabled=true")
    if not traces_endpoint.strip():
        raise ValueError("OTLP runtime event emitter requires a traces endpoint")
    if not OTEL_AVAILABLE:
        raise ValueError("OpenTelemetry Python dependencies are not installed")

    header_map = _parse_otlp_headers(headers)
    resource = Resource.create(
        {
            "service.name": service_name,
            "service.namespace": "campus-agent",
            "telemetry.allowed_attributes_version": allowed_attributes_version,
        }
    )
    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(
        BatchSpanProcessor(
            OTLPSpanExporter(
                endpoint=traces_endpoint,
                headers=header_map,
                timeout=export_timeout_seconds,
            )
        )
    )
    tracer = tracer_provider.get_tracer("campus-supervisor-agent-worker")

    meter = None
    counter = None
    if metrics_endpoint.strip():
        meter_provider = MeterProvider(
            metric_readers=[
                PeriodicExportingMetricReader(
                    OTLPMetricExporter(
                        endpoint=metrics_endpoint,
                        headers=header_map,
                        timeout=export_timeout_seconds,
                    ),
                    export_interval_millis=int(export_interval_seconds * 1000),
                    export_timeout_millis=int(export_timeout_seconds * 1000),
                )
            ],
            resource=resource,
        )
        metrics.set_meter_provider(meter_provider)
        meter = meter_provider.get_meter("campus-supervisor-agent-worker")
        counter = meter.create_counter("campus.supervisor_agent_worker.runtime_events")

    otel_logger = None
    if logs_endpoint.strip():
        logger_provider = LoggerProvider(resource=resource)
        logger_provider.add_log_record_processor(
            BatchLogRecordProcessor(
                OTLPLogExporter(
                    endpoint=logs_endpoint,
                    headers=header_map,
                    timeout=export_timeout_seconds,
                )
            )
        )
        set_logger_provider(logger_provider)
        otel_logger = logging.getLogger("campus_supervisor_agent_worker.runtime_event_otlp")
        if not any(isinstance(handler, LoggingHandler) for handler in otel_logger.handlers):
            otel_logger.addHandler(
                LoggingHandler(level=logging.INFO, logger_provider=logger_provider)
            )
        otel_logger.setLevel(logging.INFO)
        otel_logger.propagate = False

    def emit_event(event_name: str, attributes: dict[str, object]) -> None:
        sanitized_attributes = dict(attributes)
        sanitized_attributes["event_name"] = event_name
        if counter is not None:
            counter.add(1, sanitized_attributes)
        with tracer.start_as_current_span(f"supervisor_agent_worker.{event_name}") as span:
            for key, value in sanitized_attributes.items():
                span.set_attribute(key, value)
        if otel_logger is not None:
            otel_logger.info(
                "runtime_event",
                extra={"event_name": event_name, "attributes": sanitized_attributes},
            )

    return emit_event


def compose_retrieval_observation_sinks(
    *sinks: RetrievalObservationSink | None,
) -> RetrievalObservationSink | None:
    active_sinks = tuple(sink for sink in sinks if sink is not None)
    if not active_sinks:
        return None

    def sink(observation: dict[str, object]) -> None:
        for active_sink in active_sinks:
            active_sink(observation)

    return sink


def _sanitize_scalar(value: object) -> object:
    if value is None:
        return None
    if isinstance(value, bool | int | float):
        return value
    return str(value)


def _bounded_count(value: object) -> int:
    if value is None:
        return 0
    if isinstance(value, str | bytes):
        return 1 if value else 0
    try:
        return len(value)  # type: ignore[arg-type]
    except TypeError:
        return 1


def _as_int(value: object) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return 0
    return 0


def _parse_otlp_headers(value: str) -> dict[str, str]:
    headers: dict[str, str] = {}
    for part in value.split(","):
        key, _, raw_value = part.partition("=")
        key = key.strip()
        raw_value = raw_value.strip()
        if key and raw_value:
            headers[key] = raw_value
    return headers
