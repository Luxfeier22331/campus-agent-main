#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2154

execution_control_staging_capture_compose_logs() {
  execution_control_staging_compose logs --no-color otel-collector >"${execution_control_staging_otel_collector_log_file}" 2>&1 || true
  execution_control_staging_compose logs --no-color --since 5m otel-collector >"${execution_control_staging_otel_collector_recent_log_file}" 2>&1 || true
  execution_control_staging_compose logs --no-color execution-control >"${execution_control_staging_execution_control_log_file}" 2>&1 || true
}

execution_control_staging_collector_logs_have_export_errors() {
  local log_file="${execution_control_staging_otel_collector_recent_log_file}"

  if [[ ! -f "${log_file}" ]]; then
    return 1
  fi

  grep -Eq 'Exporting failed\. Dropping data\.|not retryable error:|Permanent error:' "${log_file}"
}

execution_control_staging_validate_axiom_collector_endpoint() {
  local endpoint="${OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT:-}"
  local source_endpoint="${AXIOM_ENDPOINT:-}"
  local normalized_endpoint="${endpoint%/}"
  local normalized_source_endpoint="${source_endpoint%/}"

  if [[ -z "${endpoint}" ]]; then
    return 0
  fi

  if [[ ! "${endpoint}" =~ ^https?://[^/]+/?$ ]]; then
    cat >&2 <<EOF
OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT must be the Axiom OTLP base domain, for example
https://us-east-1.aws.edge.axiom.co
Do not include signal paths like /v1/traces or /v1/metrics here because the Collector
otlphttp exporter appends those paths automatically.
Current value: ${endpoint}
EOF
    return 1
  fi

  if [[ -n "${source_endpoint}" && "${normalized_endpoint}" != "${normalized_source_endpoint}" ]]; then
    cat >&2 <<EOF
OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT must match AXIOM_ENDPOINT so Worker and Collector
export to the same Axiom edge deployment.
AXIOM_ENDPOINT=${source_endpoint}
OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=${endpoint}
EOF
    return 1
  fi
}

execution_control_staging_require_observability_sink_env() {
  local missing_keys=()
  local required_key
  for required_key in \
    AXIOM_ENDPOINT \
    OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT \
    OTEL_COLLECTOR_SENTRY_AUTH_VALUE \
    OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT \
    OTEL_COLLECTOR_AXIOM_AUTH_HEADER \
    OTEL_COLLECTOR_AXIOM_EVENTS_DATASET \
    OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT \
    OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER \
    OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION; do
    if [[ -z "${!required_key:-}" ]]; then
      missing_keys+=("${required_key}")
    fi
  done

  if (( ${#missing_keys[@]} > 0 )); then
    echo "execution-control staging observability sink env is incomplete:" >&2
    for required_key in "${missing_keys[@]}"; do
      echo "  - ${required_key} is required" >&2
    done
    return 1
  fi

  if [[ "${OTEL_COLLECTOR_AXIOM_EVENTS_DATASET}" != "campus-agent-runtime" ]]; then
    echo "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET must be campus-agent-runtime." >&2
    return 1
  fi
  if [[ "${OTEL_COLLECTOR_AXIOM_AUTH_HEADER}" != Bearer\ * ]]; then
    echo "OTEL_COLLECTOR_AXIOM_AUTH_HEADER must be a Bearer authorization header." >&2
    return 1
  fi
  if [[ "${OTEL_COLLECTOR_SENTRY_AUTH_VALUE}" != sentry\ sentry_key=* ]]; then
    echo "OTEL_COLLECTOR_SENTRY_AUTH_VALUE must use the Sentry x-sentry-auth value: sentry sentry_key=<public key>." >&2
    return 1
  fi
  if [[ "${OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT}" != */api/public/otel ]]; then
    echo "OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT must end with /api/public/otel." >&2
    return 1
  fi
  if [[ "${OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER}" != Basic\ * ]]; then
    echo "OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER must use Basic auth." >&2
    return 1
  fi
  if [[ "${OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION}" != "4" ]]; then
    echo "OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION must be 4." >&2
    return 1
  fi
}
