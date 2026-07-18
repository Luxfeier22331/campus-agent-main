#!/usr/bin/env bash
set -euo pipefail

base="${1:?base revision is required}"
head="${2:-HEAD}"

changed=()
while IFS= read -r -d '' file; do
	if [[ -f "$file" ]]; then
		changed+=("$file")
	fi
done < <(git diff --name-only --diff-filter=ACMR -z "$base" "$head")

if (( ${#changed[@]} == 0 )); then
	exit 0
fi

pnpm exec biome check --files-ignore-unknown=true "${changed[@]}"
pnpm exec editorconfig-checker \
	-no-color \
	-disable-indentation \
	-disable-indent-size \
	-exclude '(^|/)(dist|node_modules|vendor|\.tmp|\.worktrees|public/vendor|drizzle/meta)(/|$)' \
	"${changed[@]}"

markdown=()
for file in "${changed[@]}"; do
	if [[ "$file" == *.md ]]; then
		markdown+=(":$file")
	fi
done
if (( ${#markdown[@]} > 0 )); then
	pnpm exec markdownlint-cli2 "${markdown[@]}"
	pnpm docs:check
fi
