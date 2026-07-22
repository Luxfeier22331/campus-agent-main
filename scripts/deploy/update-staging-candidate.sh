#!/usr/bin/env bash
set -euo pipefail

image_digests="${1:?image digest file is required}"
worker_candidates="${2:?worker candidate directory is required}"
gitops_root="${3:?GitOps checkout directory is required}"
source_repository="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
source_sha="${GITHUB_SHA:?GITHUB_SHA is required}"

if [[ ! -f "$image_digests" ]]; then
	echo "Image digest file does not exist: ${image_digests}." >&2
	exit 1
fi
if [[ ! -d "$worker_candidates" ]]; then
	echo "Worker candidate directory does not exist: ${worker_candidates}." >&2
	exit 1
fi
if [[ ! -d "$gitops_root/cloudflare/staging" ]]; then
	echo "GitOps Cloudflare staging directory does not exist: ${gitops_root}/cloudflare/staging." >&2
	exit 1
fi

short_sha="$(printf '%.12s' "$source_sha")"
image_root="ghcr.io/${source_repository,,}"

docker_args=(--rm)
if [[ -n "${CI_DOCKER_CGROUP_PARENT:-}" ]]; then
	docker_args+=(
		--cgroup-parent "$CI_DOCKER_CGROUP_PARENT"
		--cpus "${CI_DOCKER_CPUS:-2}"
		--memory "${CI_DOCKER_MEMORY:-2g}"
		--memory-swap "${CI_DOCKER_MEMORY:-2g}"
		--pids-limit "${CI_DOCKER_PIDS_LIMIT:-1024}"
	)
fi

docker run "${docker_args[@]}" \
	--user "$(id -u):$(id -g)" \
	--env IMAGE_ROOT="$image_root" \
	--env K8S_CHANGED="${K8S_CHANGED:?K8S_CHANGED is required}" \
	--env REQUIRE_ALL_IMAGE_CONSUMERS="${REQUIRE_ALL_IMAGE_CONSUMERS:-false}" \
	--env SHORT_SHA="$short_sha" \
	--env SOURCE_REPOSITORY="$source_repository" \
	--env SOURCE_SHA="$source_sha" \
	--volume "${PWD}:/workdir" \
	--workdir /workdir \
	--entrypoint sh \
	mikefarah/yq:4.53.3@sha256:11a1f0b604b13dbbdc662260d8db6f644b22d8553122a25c1b5b2e8713ca6977 -c '
		set -eu
		overlay_root="'"${gitops_root}"'/clusters/staging/overlays"
		image_digests="'"${image_digests}"'"

		if [ "${K8S_CHANGED}" = "true" ]; then
			source_matches=0
			for kustomization in "${overlay_root}"/*/kustomization.yaml; do
				count="$(yq "[
					.resources[]? | select(test(
						\"^https://github.com/\" + strenv(SOURCE_REPOSITORY) +
						\"//infra/k8s/.+\\\\?ref=[0-9a-f]{40}$\"
					))
				] | length" "${kustomization}")"
				if [ "${count}" -gt 0 ]; then
					yq -i "(
						.resources[]? |
						select(test(
							\"^https://github.com/\" + strenv(SOURCE_REPOSITORY) +
							\"//infra/k8s/.+\\\\?ref=[0-9a-f]{40}$\"
						))
					) |= sub(
						\"ref=[0-9a-f]{40}$\";
						\"ref=\" + strenv(SOURCE_SHA)
					)" "${kustomization}"
					source_matches="$((source_matches + count))"
				fi
			done
			if [ "${source_matches}" -eq 0 ]; then
				echo "No GitOps source ref matched ${SOURCE_REPOSITORY}." >&2
				exit 1
			fi
		fi

		execution_control_written=false
		for image in $(yq -r "keys | .[]" "${image_digests}"); do
			digest="$(IMAGE_KEY="${image}" yq -r ".[strenv(IMAGE_KEY)]" "${image_digests}")"
			full_image="${IMAGE_ROOT}/${image}"
			matches=0
			export DIGEST="${digest}" IMAGE="${full_image}"
			for kustomization in "${overlay_root}"/*/kustomization.yaml; do
				count="$(yq "[
					.images[]? | select(.name == strenv(IMAGE))
				] | length" "${kustomization}")"
				if [ "${count}" -gt 0 ]; then
					yq -i "(
						.images[] | select(.name == strenv(IMAGE))
					).digest = strenv(DIGEST)" "${kustomization}"
					matches="$((matches + count))"
				fi
			done
			if [ "${matches}" -eq 0 ]; then
				if [ "${REQUIRE_ALL_IMAGE_CONSUMERS}" = "true" ]; then
					echo "No GitOps consumer for ${image}." >&2
					exit 1
				fi
				echo "Published ${image} without a GitOps consumer."
			elif [ "${image}" = "execution-control" ]; then
				execution_control_written=true
			fi
		done

		if [ "${execution_control_written}" = "true" ]; then
			runtime_config="${overlay_root}/execution-runtime/configmap.yaml"
			if [ ! -f "${runtime_config}" ]; then
				echo "Missing execution runtime release config: ${runtime_config}." >&2
				exit 1
			fi
			yq -i ".data.EXECUTION_CONTROL_RUNTIME_RELEASE =
				(\"execution-runtime@\" + strenv(SHORT_SHA)) |
				.data.LANGFUSE_RELEASE =
				(\"execution-runtime@\" + strenv(SHORT_SHA))" "${runtime_config}"
		fi
	'

for candidate in "$worker_candidates"/*.json; do
	[[ -e "$candidate" ]] || continue
	worker_name="$(jq -er '.workerName' "$candidate")"
	case "$worker_name" in
		app-api-staging|campus-web-staging) ;;
		*) echo "Unsupported Worker candidate: ${worker_name}." >&2; exit 1 ;;
	esac
	version_id="$(jq -er '.versionId | select(test("^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$"))' "$candidate")"
	candidate_sha="$(jq -er '.sourceSha | select(test("^[0-9a-f]{40}$"))' "$candidate")"
	if [[ "$candidate_sha" != "$source_sha" ]]; then
		echo "Worker candidate ${worker_name} was built from ${candidate_sha}, expected ${source_sha}." >&2
		exit 1
	fi
	worker_selection="${gitops_root}/cloudflare/staging/worker-versions.json"
	if [[ "$worker_name" == campus-web-staging ]]; then
		docs_release_id="$(jq -er '.docsReleaseId | select(test("^sha256:[0-9a-f]{64}$"))' "$candidate")"
		build_identity="$(jq -er '.buildIdentity | select(test("^sha256:[0-9a-f]{64}$"))' "$candidate")"
		expected_identity="sha256:$(printf '%s\n%s\n' "$candidate_sha" "$docs_release_id" | sha256sum | cut -d ' ' -f 1)"
		if [[ "$build_identity" != "$expected_identity" ]]; then
			echo "Campus Web candidate build identity does not match its source and docs release." >&2
			exit 1
		fi
	fi
	jq \
		--arg worker "$worker_name" \
		--arg version "$version_id" \
		--arg source "$candidate_sha" \
		'.workers[$worker] = {versionId: $version, sourceSha: $source}' \
		"$worker_selection" > "${worker_selection}.tmp"
	mv "${worker_selection}.tmp" "$worker_selection"
done

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
	echo "short_sha=${short_sha}" >> "$GITHUB_OUTPUT"
fi
