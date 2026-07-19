#!/usr/bin/env bash
set -euo pipefail

version="${SHELLCHECK_VERSION:-0.11.0}"
case "$(uname -s)/$(uname -m)" in
	Linux/x86_64)
		architecture="x86_64"
		sha256="b7af85e41cc99489dcc21d66c6d5f3685138f06d34651e6d34b42ec6d54fe6f6"
		;;
	Linux/aarch64 | Linux/arm64)
		architecture="aarch64"
		sha256="68a8133197a50beb8803f8d42f9908d1af1c5540d4bb05fdfca8c1fa47decefc"
		;;
	*) echo "Unsupported shellcheck platform: $(uname -s)/$(uname -m)" >&2; exit 1 ;;
esac

if [[ "$version" != "0.11.0" ]]; then
	echo "Unsupported shellcheck version: ${version}" >&2
	exit 1
fi

tool_cache="${RUNNER_TOOL_CACHE:-${XDG_CACHE_HOME:-${HOME}/.cache}/campus-agent-tools}"
install_dir="${tool_cache}/shellcheck/${version}/linux_${architecture}"
binary="${install_dir}/shellcheck"
if [[ ! -x "$binary" ]]; then
	temporary_directory="$(mktemp -d)"
	trap 'find "$temporary_directory" -depth -delete' EXIT
	asset="shellcheck-v${version}.linux.${architecture}.tar.gz"
	curl --fail --location --silent --show-error \
		"https://github.com/koalaman/shellcheck/releases/download/v${version}/${asset}" \
		--output "${temporary_directory}/${asset}"
	printf '%s  %s\n' "$sha256" "$asset" > "${temporary_directory}/${asset}.sha256"
	(cd "$temporary_directory" && sha256sum --check "${asset}.sha256") >&2
	tar -xzf "${temporary_directory}/${asset}" \
		-C "$temporary_directory" "shellcheck-v${version}/shellcheck"
	mkdir -p "$install_dir"
	install -m 0755 "${temporary_directory}/shellcheck-v${version}/shellcheck" "$binary"
fi

exec "$binary" "$@"
