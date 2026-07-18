#!/usr/bin/env bash
set -euo pipefail

base="${1:-origin/main}"
head="${2:-HEAD}"
temporary_directory="$(mktemp -d)"
trap 'find "$temporary_directory" -depth -delete' EXIT

scripts/ci/write-change-plan.sh "$base" "$head" "$temporary_directory/change-plan.json"

jq . "$temporary_directory/change-plan.json"

has_lane() {
	jq -e --arg lane "$1" '.lanes | index($lane) != null' "$temporary_directory/change-plan.json" >/dev/null
}

has_preflight_check() {
	jq -e --arg check "$1" '.preflightChecks | index($check) != null' "$temporary_directory/change-plan.json" >/dev/null
}

has_suite() {
	jq -e --arg suite "$1" '.databaseSuites | index($suite) != null' "$temporary_directory/change-plan.json" >/dev/null
}

scripts/ci/check-static-affected.sh "$base" "$head"

node --test \
	scripts/ci/change-plan.test.mjs \
	scripts/ci/check-docker-affected.test.mjs \
	scripts/ci/workflow-contract.test.mjs
has_preflight_check planner && node --test scripts/ci/change-plan.integration.test.mjs

if has_lane python || has_lane sql || has_lane yaml; then
	uv sync --only-dev --no-install-workspace
	scripts/ci/check-python-tools-affected.sh "$base" "$head"
fi
if has_lane shell; then
	mapfile -d '' shell_files < <(
		git diff --name-only --diff-filter=ACMR -z "$base" "$head" -- '*.sh'
	)
	if (( ${#shell_files[@]} > 0 )); then
		docker run --rm \
			-v "$PWD:/work" -w /work \
			koalaman/shellcheck:v0.11.0@sha256:61862eba1fcf09a484ebcc6feea46f1782532571a34ed51fedf90dd25f925a8d \
			-x -s bash "${shell_files[@]}"
	fi
fi
dependency_ecosystems="$(jq -r '.dependencyEcosystems | join(" ")' "$temporary_directory/change-plan.json")"
if [[ -n "$dependency_ecosystems" ]]; then
	read -r -a ecosystems <<< "$dependency_ecosystems"
	scripts/ci/osv-scan.sh "${ecosystems[@]}"
fi
has_preflight_check actions && pnpm ci:config
has_lane contracts && pnpm ci:contracts
if has_lane node; then
	pnpm ci:typescript
	pnpm ci:worker:affected
fi
has_lane ingest && pnpm ci:ingest:affected
has_lane eval && pnpm ci:eval:affected
has_lane otel && pnpm ci:otel
has_lane go && pnpm ci:go
has_lane rust && pnpm ci:rust
has_lane infra && scripts/ci/infra-check.sh

has_suite app-api-migration && pnpm ci:app-api-migration
has_suite app-api-product && pnpm ci:app-api-product-db
has_suite execution-control && pnpm ci:execution-control-postgres
has_suite ops-web && pnpm ci:ops-web-postgres

docker_checks="$(jq -c '.dockerChecks' "$temporary_directory/change-plan.json")"
if [[ "$docker_checks" != '[]' ]]; then
	mapfile -d '' dockerfiles < <(
		git diff --name-only --diff-filter=ACMR -z "$base" "$head" -- \
			'**/Dockerfile' '**/Dockerfile.*' '**/*.dockerfile'
	)
	if (( ${#dockerfiles[@]} > 0 )); then
		docker run --rm \
			-v "$PWD:/work" -w /work \
			hadolint/hadolint:v2.14.0-debian@sha256:158cd0184dcaa18bd8ec20b61f4c1cabdf8b32a592d062f57bdcb8e4c1d312e2 \
			hadolint -c /work/.hadolint.yaml "${dockerfiles[@]}"
	fi
	node scripts/ci/check-docker-affected.mjs "$docker_checks"
	node scripts/ci/check-docker-affected.mjs --build "$docker_checks"
fi

if jq -e '.browser' "$temporary_directory/change-plan.json" >/dev/null; then
	pnpm turbo run build:docs:fixture build:app --filter=campus-web --concurrency=1
	CI=1 \
		CAMPUS_WEB_E2E_DOCS_PREBUILT=1 \
		CAMPUS_WEB_E2E_PREBUILT=1 \
		CAMPUS_WEB_E2E_PORT="${CAMPUS_WEB_E2E_PORT:-27114}" \
		CAMPUS_WEB_E2E_WORKER_PORT="${CAMPUS_WEB_E2E_WORKER_PORT:-27116}" \
		pnpm --dir apps/campus-web test:e2e:smoke
fi
