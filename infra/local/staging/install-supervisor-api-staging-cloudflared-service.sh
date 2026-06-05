#!/usr/bin/env bash

set -euo pipefail

service_name="${SUPERVISOR_API_STAGING_CLOUDFLARED_SERVICE_NAME:-cloudflared-supervisor-api-staging}"
env_file="${SUPERVISOR_API_STAGING_CLOUDFLARED_ENV_FILE:-/etc/campus-agent/supervisor-api-staging-cloudflared.env}"
tunnel_token="${SUPERVISOR_API_STAGING_TUNNEL_TOKEN:-${TUNNEL_TOKEN:-}}"
cloudflared_bin="${SUPERVISOR_API_STAGING_CLOUDFLARED_BIN:-/usr/local/bin/cloudflared}"
cloudflared_metrics_address="${SUPERVISOR_API_STAGING_CLOUDFLARED_METRICS_ADDRESS:-127.0.0.1:20245}"
cloudflared_edge_ip_version="${SUPERVISOR_API_STAGING_CLOUDFLARED_EDGE_IP_VERSION:-4}"

if [[ -z "${tunnel_token}" ]]; then
  echo "SUPERVISOR_API_STAGING_TUNNEL_TOKEN is required." >&2
  exit 1
fi

if [[ ! -x "${cloudflared_bin}" ]]; then
  echo "Missing executable cloudflared at ${cloudflared_bin}." >&2
  exit 1
fi

install -d -m 0750 "$(dirname "${env_file}")"
umask 077
cat >"${env_file}" <<EOF
TUNNEL_TOKEN=${tunnel_token}
EOF

cat >"/etc/systemd/system/${service_name}.service" <<EOF
[Unit]
Description=Cloudflare Tunnel for campus-agent supervisor-api staging
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${env_file}
ExecStart=${cloudflared_bin} tunnel --no-autoupdate --edge-ip-version ${cloudflared_edge_ip_version} --metrics ${cloudflared_metrics_address} run
Restart=always
RestartSec=5s
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "${service_name}.service"
systemctl --no-pager --full status "${service_name}.service"
