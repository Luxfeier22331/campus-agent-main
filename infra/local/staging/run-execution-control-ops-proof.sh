#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/local/staging/execution-control-staging-common.sh
source "${script_dir}/execution-control-staging-common.sh"

execution_control_staging_ensure_runtime_dirs
execution_control_staging_acquire_lock "${execution_control_staging_lock_wait_seconds}"
execution_control_staging_require_deploy_checkout_clean
execution_control_staging_load_env
execution_control_staging_require_runtime_env
execution_control_staging_run_doctor
execution_control_staging_run_ops_proof
