#!/usr/bin/env bash

set -euo pipefail

: "${BUILDX_BUILDER:?BUILDX_BUILDER must name the runner-owned Buildx builder}"

required_free_space_bytes=$((25 * 1000 * 1000 * 1000))
probe_directory="$(mktemp -d "${TMPDIR:-/tmp}/campus-agent-runner-probe.XXXXXX")"
cleanup() {
	rm -rf "$probe_directory"
}
trap cleanup EXIT

docker info >/dev/null
docker buildx inspect --bootstrap "$BUILDX_BUILDER" >/dev/null

builder_json="$({ docker buildx ls --format '{{json .}}'; } | jq -s --arg builder "$BUILDX_BUILDER" '
	[ .[] | select(.Name == $builder) | (.Nodes // []) ] as $node_sets
	| if ($node_sets | length) > 0 then {Nodes: ($node_sets | add)} else error("runner-owned Buildx builder was not found") end
')"

jq -e '
	.Nodes | length > 0 and all(.[];
		.Status == "running" and (.Platforms | index("linux/arm64") != null)
	)
' <<<"$builder_json" >/dev/null

available_bytes="$(df -P -B1 / | awk 'NR == 2 { print $4 }')"
if [[ -z "$available_bytes" || "$available_bytes" -lt "$required_free_space_bytes" ]]; then
	echo "runner root filesystem has less than 25GB available" >&2
	exit 1
fi

printf 'FROM scratch\n' >"$probe_directory/Dockerfile"
docker buildx build \
	--builder "$BUILDX_BUILDER" \
	--platform linux/arm64 \
	--file "$probe_directory/Dockerfile" \
	--output "type=oci,dest=$probe_directory/probe.tar" \
	"$probe_directory" >/dev/null

tar -xOf "$probe_directory/probe.tar" index.json \
	| jq -e '
		.manifests | length == 1 and .[0].platform.os == "linux" and
		.[0].platform.architecture == "arm64"
	' >/dev/null

jq -n \
	--arg builder "$BUILDX_BUILDER" \
	--argjson available_bytes "$available_bytes" \
	--argjson required_free_space_bytes "$required_free_space_bytes" \
	'{builder: $builder, platform: "linux/arm64", available_bytes: $available_bytes, required_free_space_bytes: $required_free_space_bytes}'
