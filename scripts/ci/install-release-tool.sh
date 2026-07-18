#!/usr/bin/env bash
set -euo pipefail

tool="${1:?tool name is required}"
version="${2:?tool version is required}"
repository="${3:?GitHub repository is required}"
asset_prefix="${4:?asset prefix is required}"
binary_name="${5:?binary name is required}"
x64_arch="${6:-amd64}"
arm64_arch="${7:-arm64}"

case "$(uname -s)/$(uname -m)" in
	Linux/x86_64) platform="linux_${x64_arch}" ;;
	Linux/aarch64 | Linux/arm64) platform="linux_${arm64_arch}" ;;
	*) echo "Unsupported ${tool} platform: $(uname -s)/$(uname -m)" >&2; exit 1 ;;
esac

tool_cache="${RUNNER_TOOL_CACHE:-${XDG_CACHE_HOME:-${HOME}/.cache}/campus-agent-tools}"
install_dir="${tool_cache}/${tool}/${version}/${platform}"
binary="${install_dir}/${binary_name}"
if [[ ! -x "$binary" ]]; then
	temporary_directory="$(mktemp -d)"
	trap 'find "$temporary_directory" -depth -delete' EXIT
	asset="${asset_prefix}_${version}_${platform}.tar.gz"
	base_url="https://github.com/${repository}/releases/download/v${version}"
	curl --fail --location --silent --show-error "${base_url}/${asset}" --output "${temporary_directory}/${asset}"
	curl --fail --location --silent --show-error \
		"${base_url}/${asset_prefix}_${version}_checksums.txt" \
		--output "${temporary_directory}/checksums.txt"
	awk -v asset="$asset" '$2 == asset || $2 == "*" asset { print }' \
		"${temporary_directory}/checksums.txt" > "${temporary_directory}/${asset}.sha256"
	test -s "${temporary_directory}/${asset}.sha256"
	(cd "$temporary_directory" && sha256sum --check "${asset}.sha256") >&2
	tar -xzf "${temporary_directory}/${asset}" -C "$temporary_directory" "$binary_name"
	mkdir -p "$install_dir"
	install -m 0755 "${temporary_directory}/${binary_name}" "$binary"
fi

printf '%s\n' "$binary"
