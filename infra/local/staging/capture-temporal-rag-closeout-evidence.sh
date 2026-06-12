#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/local/staging/execution-control-staging-common.sh
source "${script_dir}/execution-control-staging-common.sh"

usage() {
  cat >&2 <<'USAGE'
Usage:
  capture-temporal-rag-closeout-evidence.sh --request-id <request_id> [--scenario <scenario>] [--output-dir <dir>]

Writes sanitized Temporal/RAG closeout evidence for a staging request. The script never prints
runtime env files, database URLs, API keys, provider keys, or Qdrant keys.
USAGE
}

request_id=""
scenario="normal-answer"
output_dir=""
original_command="$0 $*"
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --request-id)
      request_id="${2:-}"
      shift 2
      ;;
    --scenario)
      scenario="${2:-}"
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
case "${scenario}" in
  normal-answer | cancel-during-synthesis | activity-timeout-late-completion)
    ;;
  *)
    echo "--scenario must be normal-answer, cancel-during-synthesis, or activity-timeout-late-completion." >&2
    usage
    exit 1
    ;;
esac

execution_control_staging_load_env
execution_control_staging_require_status_env

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -z "${output_dir}" ]]; then
  output_dir="${execution_control_staging_repo_root}/var/staging-evidence/${timestamp}-${scenario}-temporal-rag-closeout"
fi
mkdir -p "${output_dir}"

git -C "${execution_control_staging_repo_root}" rev-parse HEAD >"${output_dir}/git-sha.txt"
hostname >"${output_dir}/host.txt"
printf 'request_id=%s\nscenario=%s\ncaptured_at=%s\n' "${request_id}" "${scenario}" "${timestamp}" >"${output_dir}/capture.txt"

write_pass_fail() {
  local result="$1"
  local failure_reason="$2"
  local git_sha
  local evidence_host
  git_sha="$(cat "${output_dir}/git-sha.txt" 2>/dev/null || true)"
  evidence_host="$(cat "${output_dir}/host.txt" 2>/dev/null || hostname)"
  cat >"${output_dir}/PASS_FAIL.md" <<EOF
# Temporal RAG Closeout Evidence

- Scenario: ${scenario}
- Result: ${result}
- Failure Reason: ${failure_reason:-none}
- Request ID: ${request_id}
- Captured At: ${timestamp}
- Host: ${evidence_host}
- Git SHA: ${git_sha}
- Command: ${original_command}
EOF
}

trap 'trap - ERR; write_pass_fail "failed" "command failed before closeout completed"; exit 1' ERR

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
    sh -ceu "printf '%s\n' \"\${CAMPUS_EVIDENCE_SQL}\" | psql \"\${CAMPUS_RUN_PROJECTION_DATABASE_URL}\" \
      --set \"ON_ERROR_STOP=1\" \
      --set \"request_id=\${CAMPUS_EVIDENCE_REQUEST_ID}\" \
      --csv \
      --no-align \
      --field-separator \",\"" >"${output_file}"
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
  event_id,
  run_id,
  conversation_id,
  event_type,
  occurred_at,
  sequence,
  visibility,
  payload_json
from runtime.agent_run_events
where run_id in (select run_id from request_runs)
order by sequence;
" "${output_dir}/run-events.csv"

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

csv_has_data() {
  local csv_file="$1"
  [[ -s "${csv_file}" ]] && [[ "$(wc -l <"${csv_file}")" -gt 1 ]]
}

failures=()
if ! grep -q "status_check=passed" "${output_dir}/status-check.result"; then
  failures+=("status check failed")
fi
if ! csv_has_data "${output_dir}/run-projection.csv"; then
  failures+=("run projection missing")
fi
if ! csv_has_data "${output_dir}/run-events.csv"; then
  failures+=("run events missing")
fi
if ! csv_has_data "${output_dir}/step-trajectory.csv"; then
  failures+=("step trajectory missing")
fi
if grep -q "semantic.rag" "${output_dir}/step-trajectory.csv"; then
  failures+=("semantic.rag appeared in step trajectory")
fi

case "${scenario}" in
  normal-answer)
    grep -q ",completed," "${output_dir}/run-projection.csv" || failures+=("normal answer run did not complete")
    grep -q "synthesis" "${output_dir}/step-trajectory.csv" || failures+=("normal answer missing synthesis step")
    grep -q "finalization.write" "${output_dir}/step-trajectory.csv" || failures+=("normal answer missing finalization.write step")
    csv_has_data "${output_dir}/finalization-contract.csv" || failures+=("normal answer finalization contract missing")
    csv_has_data "${output_dir}/provider-token-cost.csv" || failures+=("normal answer provider token/cost missing")
    ;;
  cancel-during-synthesis)
    grep -q ",canceled," "${output_dir}/run-projection.csv" || failures+=("cancel scenario run is not canceled")
    grep -q "synthesis" "${output_dir}/step-trajectory.csv" || failures+=("cancel scenario missing synthesis step")
    grep -q "provider_connection_aborted" "${output_dir}/step-trajectory.csv" || failures+=("cancel scenario missing provider_connection_aborted")
    if csv_has_data "${output_dir}/finalization-contract.csv"; then
      failures+=("cancel scenario wrote finalization contract")
    fi
    ;;
  activity-timeout-late-completion)
    grep -q ",failed," "${output_dir}/run-projection.csv" || failures+=("timeout scenario run is not failed")
    grep -q "synthesis" "${output_dir}/step-trajectory.csv" || failures+=("timeout scenario missing synthesis step")
    grep -Eq "activity_timeout|provider_timeout" "${output_dir}/step-trajectory.csv" || failures+=("timeout scenario missing timeout outcome")
    if csv_has_data "${output_dir}/finalization-contract.csv"; then
      failures+=("timeout scenario wrote finalization contract")
    fi
    ;;
esac

if [[ "${#failures[@]}" -eq 0 ]]; then
  write_pass_fail "passed" "none"
else
  failure_reason="$(IFS='; '; echo "${failures[*]}")"
  write_pass_fail "failed" "${failure_reason}"
  printf 'evidence_dir=%s\n' "${output_dir}"
  exit 1
fi

printf 'evidence_dir=%s\n' "${output_dir}"
