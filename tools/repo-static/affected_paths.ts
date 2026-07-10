import { basename } from "node:path";

export function isBiomePath(path: string): boolean {
	if ([".markdownlint-cli2.jsonc", "biome.jsonc", "package.json", "turbo.json"].includes(path)) {
		return true;
	}
	return ["apps/", "packages/", "configs/", "scripts/", "tests/"].some((prefix) =>
		path.startsWith(prefix),
	);
}

export function isMarkdownPath(path: string): boolean {
	return path.endsWith(".md") || path === ".markdownlint-cli2.jsonc";
}

export function isLintCoveragePath(path: string): boolean {
	return (
		path === "tools/repo-static/checks/check_lint_coverage_tracked.ts" ||
		path === "tools/repo-static/checks/lint-coverage.ts" ||
		["apps/", "packages/", "configs/", "infra/", "scripts/", "tests/", "docs/"].some((prefix) =>
			path.startsWith(prefix),
		)
	);
}

export function isDecompositionPath(path: string): boolean {
	return (
		[".cjs", ".go", ".js", ".jsx", ".mjs", ".py", ".ts", ".tsx"].some((suffix) =>
			path.endsWith(suffix),
		) ||
		[
			"configs/lint/decomposition-baseline.json",
			"tools/repo-static/check_repo_policy.ts",
			"tools/repo-static/checks/lint-coverage.ts",
		].includes(path)
	);
}

export function isIngestionTaskExecutabilityPath(path: string): boolean {
	return (
		path === "tools/repo-static/check_ingestion_policy.ts" ||
		path.startsWith("configs/ingestion/") ||
		path.startsWith("apps/ingestion-control/") ||
		path.startsWith("packages/ingestion-kernels-rs/")
	);
}

export function isIngestionAssertionNamingPath(path: string): boolean {
	return (
		path === "tools/repo-static/check_ingestion_policy.ts" ||
		path.startsWith("configs/ingestion/") ||
		path.startsWith("apps/ingestion-control/") ||
		path.startsWith("apps/source-collector/") ||
		path.startsWith("packages/ingestion-contracts/") ||
		path === "docs/architecture/system/data-plane.md" ||
		path === "docs/runbooks/ingestion-control-clean-target.md"
	);
}

export function isPackageScriptPolicyPath(path: string): boolean {
	return (
		path === "tools/repo-static/check_repo_policy.ts" ||
		path === "tools/repo-static/checks/check_package_script_policy.ts" ||
		path === "tools/repo-static/checks/check_package_test_layout.ts" ||
		path.includes("/test/") ||
		path.includes("/tests/") ||
		path.endsWith("package.json")
	);
}

export function isProjectionSyncHelperPath(path: string): boolean {
	return (
		path === "tools/repo-static/check_observability_policy.ts" ||
		path === "apps/execution-control/scripts/sync-provider-config-projection.ts" ||
		path === "apps/execution-control/scripts/sync-observability-config-projection.ts"
	);
}

export function isTemporalStagingPreflightPath(path: string): boolean {
	return (
		path === "tools/repo-static/checks/check_temporal_staging_preflight.ts" ||
		path === "docs/runbooks/temporal-self-host-operations.md"
	);
}

export function isDoctorEnvPath(path: string): boolean {
	return (
		path === "scripts/deploy/doctor-env.ts" ||
		path.startsWith("scripts/deploy/doctor-env/") ||
		path.startsWith("scripts/deploy/lib/") ||
		path === "scripts/deploy/check-worker-secret-presence.ts" ||
		path === "scripts/deploy/check-worker-secret-presence.self-test.ts" ||
		path === "docs/environment/readiness.md" ||
		path === "docs/runbooks/provider-secret-governance.md"
	);
}

export function isLangfuseEvalAuditPath(path: string): boolean {
	return (
		path === "packages/eval-langfuse/src/cli.ts" ||
		path.startsWith("packages/eval-langfuse/src/audit/langfuse-eval-audit/") ||
		path === "docs/runbooks/rag-release.md" ||
		path === "docs/runbooks/eval-ragas.md" ||
		path === "docs/runbooks/eval-operations-governance.md" ||
		path === "docs/decisions/adr-0061-eval-runtime.md"
	);
}

export function isContractScriptPath(path: string): boolean {
	return (
		path === "packages/contracts/package.json" ||
		path === "packages/contracts/scripts/check_contract_schemas.ts" ||
		path === "packages/contracts/scripts/generate_tool_execution_contracts.ts" ||
		path === "tools/repo-static/check_runtime_policy.ts" ||
		path === "configs/runtime/tools.v4.json" ||
		path === "configs/runtime/tool-function-schemas.v1.json" ||
		path === "apps/app-api/src/modules/integration/generated/tool-execution-contract.ts" ||
		path.startsWith("packages/contracts/scripts/contracts/") ||
		path === "docs/contracts/schemas/tool-execution.openapi.yaml" ||
		path.startsWith("packages/contracts/schemas/") ||
		path.startsWith("packages/contracts/fixtures/") ||
		path === "packages/contracts/README.md" ||
		path === "docs/contracts/tool-execution.md"
	);
}

export function isEditorconfigPath(path: string): boolean {
	const name = basename(path);
	return [".editorconfig", ".gitattributes", ".gitignore"].includes(name);
}

export function isEnvPath(path: string): boolean {
	return [".env.example", ".local.example", ".dev.vars.example"].some((suffix) =>
		path.endsWith(suffix),
	);
}

export function isWorkerConfigSurfacePath(path: string): boolean {
	const parts = path.split("/");
	if (parts.length !== 3 || parts[0] !== "apps") {
		return false;
	}
	const name = parts[2];
	return name === ".dev.vars.example" || (name.startsWith("wrangler") && name.endsWith(".toml"));
}

export function isSqlPath(path: string): boolean {
	return path.endsWith(".sql") || path === ".sqlfluff";
}

export function isDockerPath(path: string): boolean {
	const name = basename(path);
	return name.startsWith("Dockerfile") || path.endsWith(".dockerfile") || path === ".hadolint.yaml";
}
