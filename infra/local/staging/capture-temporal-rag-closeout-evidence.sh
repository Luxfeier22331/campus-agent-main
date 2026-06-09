#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/local/staging/execution-control-staging-common.sh
source "${script_dir}/execution-control-staging-common.sh"

usage() {
  cat >&2 <<'USAGE'
Usage:
  capture-temporal-rag-closeout-evidence.sh --request-id <request_id> [--output-dir <dir>]

Writes sanitized Temporal/RAG closeout evidence for a staging request. The script never prints
runtime env files, database URLs, API keys, provider keys, or Qdrant keys.
USAGE
}

request_id=""
output_dir=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --request-id)
      request_id="${2:-}"
      shift 2
      ;;
    --output-dir)
      output_dir="${2:-}"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${request_id}" ]]; then
  echo "--request-id is required." >&2
  usage
  exit 1
fi

execution_control_staging_load_env
execution_control_staging_require_status_env

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -z "${output_dir}" ]]; then
  output_dir="${execution_control_staging_repo_root}/var/staging-evidence/${timestamp}-temporal-rag-closeout"
fi
mkdir -p "${output_dir}"

git -C "${execution_control_staging_repo_root}" rev-parse HEAD >"${output_dir}/git-sha.txt"
hostname >"${output_dir}/host.txt"
printf 'request_id=%s\ncaptured_at=%s\n' "${request_id}" "${timestamp}" >"${output_dir}/capture.txt"

if "${script_dir}/status-execution-control-staging.sh" --check >"${output_dir}/status-check.txt" 2>&1; then
  printf 'status_check=passed\n' >"${output_dir}/status-check.result"
else
  printf 'status_check=failed\n' >"${output_dir}/status-check.result"
fi

run_psql() {
  local sql="$1"
  local output_file="$2"
  local docker_bin
  docker_bin="$(execution_control_staging_require_command docker)"
  # shellcheck disable=SC2016
  "${docker_bin}" run --rm --network host \
    -e "PGCONNECT_TIMEOUT=10" \
    -e "CAMPUS_RUN_PROJECTION_DATABASE_URL=${EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL:?EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL is required}" \
    -e "CAMPUS_EVIDENCE_REQUEST_ID=${request_id}" \
    -e "CAMPUS_EVIDENCE_SQL=${sql}" \
    postgres:16-alpine \
    sh -ceu 'psql "$CAMPUS_RUN_PROJECTION_DATABASE_URL" \
      --set "ON_ERROR_STOP=1" \
      --set "request_id=$CAMPUS_EVIDENCE_REQUEST_ID" \
      --csv \
      --no-align \
      --field-separator "," \
      --command "$CAMPUS_EVIDENCE_SQL"' >"${output_file}"
}

run_psql "
select
  run_id,
  request_id,
  conversation_id,
  status,
  terminal_reason,
  trace_id,
  created_at,
  updated_at,
  completed_at
from runtime.agent_runs
where request_id = :'request_id'
order by created_at desc;
" "${output_dir}/run-projection.csv"

run_psql "
with request_runs as (
  select run_id from runtime.agent_runs where request_id = :'request_id'
)
select
  s.run_id,
  s.step_id,
  s.step_kind,
  s.status as step_status,
  s.task_queue,
  s.worker_id,
  s.started_at as step_started_at,
  s.completed_at as step_completed_at,
  a.attempt,
  a.status as attempt_status,
  a.activity_type,
  a.activity_attempt,
  a.schedule_to_start_ms,
  a.duration_ms,
  a.provider_request_ref,
  a.provider_response_id,
  a.model_provider,
  a.model_name,
  a.input_tokens,
  a.output_tokens,
  a.cached_input_tokens,
  a.estimated_cost_microusd,
  a.pricing_version,
  a.cancel_outcome,
  a.timeout_outcome,
  a.terminal_reason
from runtime.agent_run_steps s
left join runtime.agent_step_attempts a
  on a.run_id = s.run_id and a.step_id = s.step_id
where s.run_id in (select run_id from request_runs)
order by s.started_at, s.step_id, a.attempt;
" "${output_dir}/step-trajectory.csv"

run_psql "
with request_runs as (
  select run_id from runtime.agent_runs where request_id = :'request_id'
)
select
  result_id,
  run_id,
  step_id,
  status,
  result_kind,
  projection_ref,
  sanitized_payload_json -> 'finalized_response' as finalized_response
from runtime.agent_step_results
where run_id in (select run_id from request_runs)
  and step_id = 'finalization.write'
order by created_at desc;
" "${output_dir}/finalization-contract.csv"

run_psql "
with request_runs as (
  select run_id from runtime.agent_runs where request_id = :'request_id'
)
select
  run_id,
  step_id,
  attempt,
  provider_request_ref,
  provider_response_id,
  model_provider,
  model_name,
  input_tokens,
  output_tokens,
  cached_input_tokens,
  estimated_cost_microusd,
  pricing_version,
  cancel_outcome,
  timeout_outcome,
  terminal_reason
from runtime.agent_step_attempts
where run_id in (select run_id from request_runs)
  and provider_request_ref <> ''
order by started_at, step_id, attempt;
" "${output_dir}/provider-token-cost.csv"

printf 'evidence_dir=%s\n' "${output_dir}"
