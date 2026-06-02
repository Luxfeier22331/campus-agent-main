#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2154

supervisor_api_staging_capture_compose_logs() {
  supervisor_api_staging_compose logs --no-color otel-collector >"${supervisor_api_staging_otel_collector_log_file}" 2>&1 || true
  supervisor_api_staging_compose logs --no-color supervisor-api >"${supervisor_api_staging_supervisor_api_log_file}" 2>&1 || true
  supervisor_api_staging_compose logs --no-color supervisor-agent-worker >"${supervisor_api_staging_supervisor_agent_worker_log_file}" 2>&1 || true
}

supervisor_api_staging_collector_logs_have_export_errors() {
  local log_file="${supervisor_api_staging_otel_collector_log_file}"

  if [[ ! -f "${log_file}" ]]; then
    return 1
  fi

  grep -Eq 'Exporting failed\. Dropping data\.|not retryable error:|Permanent error:' "${log_file}"
}

supervisor_api_staging_validate_axiom_collector_endpoint() {
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
