#!/usr/bin/env bash
set -euo pipefail

base="${1:?base revision is required}"
head="${2:?head revision is required}"
output="${3:?output path is required}"
temporary_directory="$(mktemp -d)"
trap 'find "$temporary_directory" -depth -delete' EXIT

TURBO_SCM_BASE="$base" TURBO_SCM_HEAD="$head" \
	pnpm exec turbo ls --affected --output=json > "$temporary_directory/affected-packages.json"
TURBO_SCM_BASE="$base" TURBO_SCM_HEAD="$head" \
	pnpm exec turbo run \
		build:app build:worker check test test:eval test:ingest test:worker typecheck \
		--affected --dry=json > "$temporary_directory/affected-tasks.json"
node scripts/ci/change-plan.mjs \
	--base "$base" \
	--head "$head" \
	--affected-packages "$temporary_directory/affected-packages.json" \
	--affected-tasks "$temporary_directory/affected-tasks.json" \
	> "$output"
jq -e '.schemaVersion == "change_plan.v1"' "$output" >/dev/null
