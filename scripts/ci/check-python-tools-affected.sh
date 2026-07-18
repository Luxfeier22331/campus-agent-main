#!/usr/bin/env bash
set -euo pipefail

base="${1:?base revision is required}"
head="${2:-HEAD}"
python_files=()
yaml_files=()
sql_files=()

while IFS= read -r -d '' file; do
	[[ -f "$file" ]] || continue
	case "$file" in
		*.py) python_files+=("$file") ;;
		*.yaml|*.yml) yaml_files+=("$file") ;;
		*.sql) sql_files+=("$file") ;;
	esac
done < <(git diff --name-only --diff-filter=ACMR -z "$base" "$head")

if (( ${#python_files[@]} > 0 )); then
	uv run --no-sync ruff check "${python_files[@]}"
	uv run --no-sync ruff format --check "${python_files[@]}"
fi
if (( ${#yaml_files[@]} > 0 )); then
	uv run --no-sync yamllint -c .yamllint.yml "${yaml_files[@]}"
fi
if (( ${#sql_files[@]} > 0 )); then
	uv run --no-sync sqlfluff lint --config .sqlfluff "${sql_files[@]}"
fi
