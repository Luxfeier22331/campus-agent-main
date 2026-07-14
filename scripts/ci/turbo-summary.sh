#!/usr/bin/env bash
set -euo pipefail

summary_root="${1:-.turbo/runs}"
output="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
summary="$(find "$summary_root" -type f -name '*.json' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2- || true)"

if [[ -z "$summary" ]]; then
	printf '### Turbo run summary\n\nNo run summary was produced.\n' >> "$output"
	exit 0
fi

attempted="$(jq -r '.execution.attempted // 0' "$summary")"
cached="$(jq -r '.execution.cached // 0' "$summary")"
failed="$(jq -r '.execution.failed // 0' "$summary")"
duration_ms="$(jq -r '(.execution.endTime // 0) - (.execution.startTime // 0)' "$summary")"

{
	printf '### Turbo run summary\n\n'
	printf '| Attempted | Cached | Executed | Failed | Duration |\n'
	printf '| ---: | ---: | ---: | ---: | ---: |\n'
	printf '| %s | %s | %s | %s | %.1fs |\n\n' \
		"$attempted" "$cached" "$((attempted - cached))" "$failed" "$(awk "BEGIN { print $duration_ms / 1000 }")"
	printf '#### Slow executed tasks\n\n'
	printf '| Task | Cache | Duration | Review |\n'
	printf '| --- | --- | ---: | --- |\n'
	jq -r '
		[
			.tasks[]
			| select((.cache.status // "MISS") != "HIT")
			| . + { duration_ms: ((.execution.endTime // 0) - (.execution.startTime // 0)) }
		]
		| sort_by(-.duration_ms)
		| .[:10][]
		| "| `\(.taskId)` | \(.cache.status // "MISS") | \((.duration_ms / 1000 * 10 | round) / 10)s | \(if .duration_ms >= 30000 then "over 30s" else "" end) |"
	' "$summary"
} >> "$output"
