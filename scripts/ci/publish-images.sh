#!/usr/bin/env bash
set -euo pipefail

images="${1:?JSON image list is required}"
output="${2:?digest output path is required}"
definitions="$(
	node --input-type=module -e '
		import { IMAGE_DEFINITIONS } from "./scripts/ci/ci-surfaces.mjs";
		process.stdout.write(JSON.stringify(IMAGE_DEFINITIONS));
	'
)"
trivy_cache_dir="${RUNNER_TOOL_CACHE:?RUNNER_TOOL_CACHE is required}/trivy"
temporary_directory="$(mktemp -d)"
trap 'find "$temporary_directory" -depth -delete' EXIT

echo '{}' > "$output"
while IFS= read -r image; do
	definition="$(jq -ce --arg image "$image" '.[$image]' <<< "$definitions")"
	dockerfile="$(jq -r .dockerfile <<< "$definition")"
	target="$(jq -r '.target // empty' <<< "$definition")"
	repository="ghcr.io/${GITHUB_REPOSITORY,,}/${image}"
	tag="${repository}:${GITHUB_SHA}"
	metadata_file="${temporary_directory}/build-metadata-${image}.json"
	inspect_file="${temporary_directory}/inspect-${image}.json"
	inspect_error="${temporary_directory}/inspect-${image}.error"

	if docker buildx imagetools inspect "$tag" --format '{{json .}}' \
		> "$inspect_file" 2> "$inspect_error"; then
		if ! jq -e '
			(.manifest.mediaType == "application/vnd.oci.image.index.v1+json" or
				.manifest.mediaType == "application/vnd.docker.distribution.manifest.list.v2+json") and
			(.manifest.digest | test("^sha256:[0-9a-f]{64}$")) and
			([.manifest.manifests[]? |
				select(.platform.os == "linux" and .platform.architecture == "arm64")] |
				length == 1) and
			([.manifest.manifests[]? |
				select(.platform.os == "linux" and .platform.architecture != "arm64")] |
				length == 0)
		' "$inspect_file" >/dev/null; then
			echo "Existing immutable tag is incomplete or invalid: ${tag}." >&2
			exit 1
		fi
		digest="$(jq -er '.manifest.digest' "$inspect_file")"
		echo "Reusing ${tag}@${digest}."
	else
		if ! rg -qi 'manifest unknown|not found' "$inspect_error"; then
			cat "$inspect_error" >&2
			exit 1
		fi
		build_args=(
			--file "$dockerfile"
			--platform linux/arm64
			--pull
			--push
			--sbom=true
			--cache-from "type=registry,ref=${repository}:buildcache-arm64"
			--cache-to "type=registry,ref=${repository}:buildcache-arm64,mode=max,image-manifest=true,oci-mediatypes=true,ignore-error=true"
			--label "org.opencontainers.image.source=https://github.com/${GITHUB_REPOSITORY}"
			--label "org.opencontainers.image.revision=${GITHUB_SHA}"
			--metadata-file "$metadata_file"
			--tag "$tag"
		)
		if [[ -n "$target" ]]; then
			build_args+=(--target "$target")
		fi
		docker buildx build "${build_args[@]}" .
		digest="$(
			jq -er \
				'."containerimage.digest" | select(test("^sha256:[0-9a-f]{64}$"))' \
				"$metadata_file"
		)"
	fi

	trivy image \
		--cache-dir "$trivy_cache_dir" \
		--platform linux/arm64 \
		--scanners vuln \
		--ignore-unfixed \
		--pkg-types os,library \
		--severity HIGH,CRITICAL \
		--exit-code 1 \
		"${repository}@${digest}"
	jq --arg image "$image" --arg digest "$digest" \
		'. + {($image): $digest}' "$output" > "${output}.tmp"
	mv "${output}.tmp" "$output"
done < <(jq -er '.[]' <<< "$images")
