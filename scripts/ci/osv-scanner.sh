#!/usr/bin/env bash
set -euo pipefail

version="${OSV_SCANNER_VERSION:-2.3.8}"
version="${version#v}"
if [[ "$version" != "2.3.8" ]]; then
	echo "Unsupported OSV-Scanner version: ${version}" >&2
	exit 1
fi

case "$(uname -s)/$(uname -m)" in
	Linux/x86_64) architecture="amd64" ;;
	Linux/aarch64 | Linux/arm64) architecture="arm64" ;;
	*) echo "Unsupported OSV-Scanner platform: $(uname -s)/$(uname -m)" >&2; exit 1 ;;
esac

tool_cache="${RUNNER_TOOL_CACHE:-${XDG_CACHE_HOME:-${HOME}/.cache}/campus-agent-tools}"
install_dir="${tool_cache}/osv-scanner/${version}/linux_${architecture}"
binary="${install_dir}/osv-scanner"
if [[ ! -x "$binary" ]]; then
	temporary_directory="$(mktemp -d)"
	trap 'find "$temporary_directory" -depth -delete' EXIT
	asset="osv-scanner_linux_${architecture}"
	base_url="https://github.com/google/osv-scanner/releases/download/v${version}"
	curl --fail --location --silent --show-error \
		"${base_url}/${asset}" --output "${temporary_directory}/${asset}"
	curl --fail --location --silent --show-error \
		"${base_url}/osv-scanner_SHA256SUMS" --output "${temporary_directory}/SHA256SUMS"
	awk -v asset="$asset" '$2 == asset || $2 == "*" asset { print }' \
		"${temporary_directory}/SHA256SUMS" > "${temporary_directory}/${asset}.sha256"
	test -s "${temporary_directory}/${asset}.sha256"
	(cd "$temporary_directory" && sha256sum --check "${asset}.sha256") >&2
	mkdir -p "$install_dir"
	install -m 0755 "${temporary_directory}/${asset}" "$binary"
fi

exec "$binary" "$@"
