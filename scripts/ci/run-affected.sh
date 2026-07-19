#!/usr/bin/env bash
set -euo pipefail

profile="${CI_AFFECTED_PROFILE:-code}"
base="${1:?base revision is required}"
head="${2:-HEAD}"
temporary_directory="$(mktemp -d)"
trap 'find "$temporary_directory" -depth -delete' EXIT

case "$profile" in
	fast | code | docker | database | browser) ;;
	*) echo "unsupported affected profile: ${profile}" >&2; exit 1 ;;
esac

scripts/ci/write-change-plan.sh "$base" "$head" "$temporary_directory/change-plan.json"
jq . "$temporary_directory/change-plan.json"

if jq -e '.unresolved[0] != null' "$temporary_directory/change-plan.json" >/dev/null; then
	echo "change plan contains unresolved deployment inputs" >&2
	exit 1
fi

has_lane() {
	jq -e --arg lane "$1" '.lanes | index($lane) != null' "$temporary_directory/change-plan.json" >/dev/null
}

has_preflight_check() {
	jq -e --arg check "$1" '.preflightChecks | index($check) != null' "$temporary_directory/change-plan.json" >/dev/null
}

has_suite() {
	jq -e --arg suite "$1" '.verification.database | index($suite) != null' "$temporary_directory/change-plan.json" >/dev/null
}

run_turbo_filters() {
	local tasks="$1"
	local field="$2"
	local -a args=()
	while IFS= read -r filter; do
		[[ -n "$filter" ]] && args+=(--filter "$filter")
	done < <(jq -r "${field}[]" "$temporary_directory/change-plan.json")
	if (( ${#args[@]} > 0 )); then
		# shellcheck disable=SC2086
		pnpm exec turbo run $tasks "${args[@]}" --concurrency=1 --summarize
	fi
}

run_fast() {
	scripts/ci/check-static-affected.sh "$base" "$head"
	node --test \
		scripts/ci/change-plan.test.mjs \
		scripts/ci/check-docker-affected.test.mjs \
		scripts/ci/workflow-contract.test.mjs
	has_preflight_check planner && node --test scripts/ci/change-plan.integration.test.mjs
	scripts/ci/gitleaks.sh "$base" "$head"

	if has_lane python || has_lane sql || has_lane yaml; then
		test "$(uv --version | awk '{print $2}')" = "0.11.28"
		uv sync --only-dev --no-install-workspace
		scripts/ci/check-python-tools-affected.sh "$base" "$head"
	fi
	if has_lane shell; then
		mapfile -d '' shell_files < <(
			git diff --name-only --diff-filter=ACMR -z "$base" "$head" -- '*.sh'
		)
		if (( ${#shell_files[@]} > 0 )); then
			scripts/ci/shellcheck.sh -x -s bash "${shell_files[@]}"
		fi
	fi
	if has_preflight_check actions; then
		pnpm ci:config
	fi
	if has_lane contracts; then
		pnpm ci:contracts
	fi
	local dependency_ecosystems
	dependency_ecosystems="$(jq -r '.dependencyEcosystems | join(" ")' "$temporary_directory/change-plan.json")"
	if [[ -n "$dependency_ecosystems" ]]; then
		read -r -a ecosystems <<< "$dependency_ecosystems"
		scripts/ci/osv-scan.sh "${ecosystems[@]}"
	fi
}

case "$profile" in
	fast)
		run_fast
		;;
	code)
		run_fast
		run_turbo_filters "typecheck test" '.verification.nodeFilters'
		run_turbo_filters "typecheck test:ingest" '.verification.ingestFilters'
		run_turbo_filters "typecheck test:eval" '.verification.evalFilters'
		run_turbo_filters "test:worker build:worker build:app" '.verification.workerFilters'
		has_lane otel && pnpm ci:otel
		jq -e '.verification.go' "$temporary_directory/change-plan.json" >/dev/null && pnpm ci:go
		jq -e '.verification.rust' "$temporary_directory/change-plan.json" >/dev/null && pnpm ci:rust
		jq -e '.verification.infra' "$temporary_directory/change-plan.json" >/dev/null && scripts/ci/infra-check.sh
		;;
	docker)
		docker_checks="$(jq -c '.verification.docker' "$temporary_directory/change-plan.json")"
		if [[ "$docker_checks" != '[]' ]]; then
			node scripts/ci/check-docker-affected.mjs "$docker_checks"
			node scripts/ci/check-docker-affected.mjs --build "$docker_checks"
		fi
		;;
	database)
		has_suite app-api-migration && pnpm ci:app-api-migration
		has_suite app-api-product && pnpm ci:app-api-product-db
		has_suite execution-control && pnpm ci:execution-control-postgres
		has_suite ops-web && pnpm ci:ops-web-postgres
		;;
	browser)
		if jq -e '.verification.browser[0] != null' "$temporary_directory/change-plan.json" >/dev/null; then
			pnpm turbo run build:docs:fixture build:app --filter=campus-web --concurrency=1
			CI=1 \
				CAMPUS_WEB_E2E_DOCS_PREBUILT=1 \
				CAMPUS_WEB_E2E_PREBUILT=1 \
				CAMPUS_WEB_E2E_PORT="${CAMPUS_WEB_E2E_PORT:-27114}" \
				CAMPUS_WEB_E2E_WORKER_PORT="${CAMPUS_WEB_E2E_WORKER_PORT:-27116}" \
				pnpm --dir apps/campus-web test:e2e:smoke
		fi
		;;
esac
