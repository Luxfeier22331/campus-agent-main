#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
cd "$repository_root"

run_check() {
	local name="$1"
	shift
	printf '\n==> %s\n' "$name"
	"$@"
}

run_python_lint() {
	rg --null --hidden --files -g '!.git/**' -g '*.py' | xargs -0 --no-run-if-empty uv run --no-sync ruff check
	rg --null --hidden --files -g '!.git/**' -g '*.py' | xargs -0 --no-run-if-empty uv run --no-sync ruff format --check
}

run_yaml_lint() {
	rg --null --hidden --files -g '!.git/**' -g '*.yaml' -g '*.yml' -g '!pnpm-lock.yaml' |
		xargs -0 --no-run-if-empty uv run --no-sync yamllint -c .yamllint.yml
}

run_sql_lint() {
	rg --null --hidden --files -g '!.git/**' -g '*.sql' | xargs -0 --no-run-if-empty uv run --no-sync sqlfluff lint --config .sqlfluff
}

run_shell_lint() {
	rg --null --hidden --files -g '!.git/**' -g '*.sh' | xargs -0 --no-run-if-empty shellcheck -x -s bash
}

run_bake_check() {
	NODE_VERSION="$(<.node-version)" docker buildx bake --file docker-bake.hcl --print >/dev/null
}

run_check "repository checks" pnpm check
run_check "Python dependencies" uv sync --locked --all-packages --dev
run_check "contracts" pnpm --dir packages/contracts check
run_check "Python lint" run_python_lint
run_check "YAML lint" run_yaml_lint
run_check "SQL lint" run_sql_lint
run_check "Shell lint" run_shell_lint
run_check "GitHub Actions lint" actionlint
run_check "GitHub Actions security lint" zizmor --min-severity=medium .github

run_check "Node tests, typechecks, and worker tests" pnpm exec turbo run \
	test test:worker typecheck --summarize
run_check "native format" pnpm exec turbo run \
	native:format --concurrency=1 --summarize
run_check "native lint" pnpm exec turbo run \
	native:lint --concurrency=1 --summarize
run_check "native typecheck" pnpm exec turbo run \
	native:typecheck --concurrency=1 --summarize
run_check "native tests" pnpm exec turbo run \
	native:test --concurrency=1 --summarize
run_check "Ragas runner unit tests" pnpm exec turbo run \
	test:eval --filter=ragas-runner --concurrency=1 --summarize
run_check "database integration tests" pnpm exec turbo run \
	test:migration-integration test:database-integration test:shared-db-integration \
	--concurrency=1 --summarize

run_check "infrastructure validation" scripts/infra/validate.sh
run_check "OTEL configuration validation" scripts/otel/validate-config.sh
run_check "Docker Bake configuration" run_bake_check

printf '\nRepository verification passed.\n'
