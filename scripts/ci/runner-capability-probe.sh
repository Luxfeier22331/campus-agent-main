#!/usr/bin/env bash

set -euo pipefail

: "${BUILDX_BUILDER:?BUILDX_BUILDER must name the runner-owned Buildx builder}"

required_free_space_bytes=$((25 * 1000 * 1000 * 1000))
probe_directory="$(mktemp -d "${TMPDIR:-/tmp}/campus-agent-runner-probe.XXXXXX")"
cleanup() {
	rm -rf "$probe_directory"
}
trap cleanup EXIT

docker version --format '{{.Server.Version}}' >/dev/null
docker buildx inspect --bootstrap "$BUILDX_BUILDER" >/dev/null

builder_json="$({ docker buildx ls --format '{{json .}}'; } | jq -s --arg builder "$BUILDX_BUILDER" '
	[ .[] | select(.Name == $builder and .Driver == "docker-container") | (.Nodes // []) ] as $node_sets
	| if ($node_sets | length) > 0 then {Nodes: ($node_sets | add)} else error("runner-owned Buildx builder was not found") end
')"

jq -e '
	.Nodes | length > 0 and all(.[];
		.Status == "running" and (.Platforms | index("linux/arm64") != null)
	)
' <<<"$builder_json" >/dev/null

while IFS= read -r node; do
	node_name="$(jq -r '.Name' <<<"$node")"
	if ! config="$(jq -er '.Files["buildkitd.toml"] | select(type == "string") | @base64d' <<<"$node")"; then
		echo "builder node $node_name has no readable buildkitd.toml" >&2
		exit 1
	fi
	if ! awk '
		{ sub(/#.*/, "") }
		/^[[:space:]]*\[/ { oci = ($0 ~ /^[[:space:]]*\[worker\.oci\][[:space:]]*$/) }
		oci && /^[[:space:]]*max-parallelism[[:space:]]*=/ {
			count++
			valid = ($0 ~ /^[[:space:]]*max-parallelism[[:space:]]*=[[:space:]]*2[[:space:]]*$/)
		}
		END { exit !(count == 1 && valid) }
	' <<<"$config"; then
		echo "builder node $node_name must configure [worker.oci] max-parallelism = 2" >&2
		exit 1
	fi
done < <(jq -c '.Nodes | unique_by(.Name)[]' <<<"$builder_json")

available_bytes="$(df -P -B1 / | awk 'NR == 2 { print $4 }')"
if [[ -z "$available_bytes" || "$available_bytes" -lt "$required_free_space_bytes" ]]; then
	echo "runner root filesystem has less than 25GB available" >&2
	exit 1
fi

printf 'FROM scratch\nCOPY probe /probe\n' >"$probe_directory/Dockerfile"
printf 'runner cache export probe\n' >"$probe_directory/probe"
docker buildx build \
	--builder "$BUILDX_BUILDER" \
	--platform linux/arm64 \
	--file "$probe_directory/Dockerfile" \
	--output "type=oci,dest=$probe_directory/probe.tar" \
	--cache-to "type=local,dest=$probe_directory/cache,mode=max" \
	"$probe_directory" >/dev/null

test -s "$probe_directory/cache/index.json"

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
