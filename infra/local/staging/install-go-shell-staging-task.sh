#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "${script_dir}/../../.." && pwd)"
task_name="${GO_SHELL_STAGING_TASK_NAME:-CampusAgent-GoShellStaging}"
wsl_distro_name="${WSL_DISTRO_NAME:-}"
linux_user="$(id -un)"

if [[ -z "${wsl_distro_name}" ]]; then
  echo "WSL_DISTRO_NAME is required. Run this installer from inside WSL." >&2
  exit 1
fi

if ! command -v powershell.exe >/dev/null 2>&1; then
  echo "powershell.exe is required to install the Windows scheduled task." >&2
  exit 1
fi

ps_script_windows_path="$(wslpath -w "${script_dir}/install-go-shell-staging-task.ps1")"

powershell.exe \
  -NoProfile \
  -ExecutionPolicy Bypass \
  -File "${ps_script_windows_path}" \
  -TaskName "${task_name}" \
  -WslDistroName "${wsl_distro_name}" \
  -LinuxUser "${linux_user}" \
  -RepoPath "${repo_root}"
