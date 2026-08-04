import path from "node:path";
import { pathToFileURL } from "node:url";

import { type AffectedScope, type CommandRunner, resolveAffectedScope } from "./scope.mts";

export type LightSurface = "config" | "contracts" | "python" | "release" | "shell" | "sql" | "yaml";

const LIGHT_SURFACES: LightSurface[] = [
	"contracts",
	"config",
	"release",
	"python",
	"yaml",
	"sql",
	"shell",
];

export type ValidationProfile =
	| "affected-node"
	| "go"
	| "rust"
	| "ragas"
	| "app-api-migration"
	| "app-api-product-db"
	| "execution-control-postgres"
	| "ingestion-control-postgres"
	| "ops-web-postgres"
	| "infra"
	| "otel"
	| "campus-browser-smoke"
	| "campus-browser-full"
	| "ops-web-browser"
	| "dependencies"
	| "toolchain";

export const VALIDATION_PROFILES: ValidationProfile[] = [
	"affected-node",
	"go",
	"rust",
	"ragas",
	"app-api-migration",
	"app-api-product-db",
	"execution-control-postgres",
	"ingestion-control-postgres",
	"ops-web-postgres",
	"infra",
	"otel",
	"campus-browser-smoke",
	"campus-browser-full",
	"ops-web-browser",
	"dependencies",
	"toolchain",
];

const BROWSER_PROFILES = new Set<ValidationProfile>([
	"campus-browser-smoke",
	"campus-browser-full",
	"ops-web-browser",
]);

export interface ValidationPlan {
	base: string;
	browserProfiles: ValidationProfile[];
	head: string;
	lightSurfaces: LightSurface[];
	nonBrowserProfiles: ValidationProfile[];
	validationProfiles: ValidationProfile[];
}

export interface ValidationPlanOptions {
	base: string;
	head: string;
	mode: "pull-request";
	repositoryRoot: string;
}

function changesPath(files: readonly string[], prefix: string): boolean {
	return files.some((file) => file === prefix || file.startsWith(`${prefix}/`));
}

function matchesFile(files: readonly string[], pattern: RegExp): boolean {
	return files.some((file) => pattern.test(file));
}

function hasTask(scope: AffectedScope, packageName: string, task: string): boolean {
	return scope.tasks.some(
		(candidate) => candidate.package === packageName && candidate.task === task,
	);
}

function selectLightSurfaces(files: readonly string[]): LightSurface[] {
	const selected = new Set<LightSurface>();
	if (
		changesPath(files, "packages/contracts") ||
		changesPath(files, "configs/runtime") ||
		changesPath(files, "docs/contracts/schemas")
	) {
		selected.add("contracts");
	}
	if (
		changesPath(files, ".github") ||
		files.some((file) => file === "flake.nix" || file === "flake.lock" || file.startsWith("nix/"))
	) {
		selected.add("config");
	}
	if (
		files.some(
			(file) =>
				file === "package.json" ||
				file === "turbo.json" ||
				file.endsWith("/turbo.json") ||
				file.startsWith(".github/workflows/") ||
				file.startsWith("scripts/ci/scope.") ||
				file.startsWith("scripts/ci/validation.") ||
				file.startsWith("scripts/ci/evidence.") ||
				file.startsWith("scripts/ci/workflow-config.") ||
				file.startsWith("scripts/ci/check-ops-web-artifact.") ||
				file.startsWith("scripts/release/"),
		)
	) {
		selected.add("release");
	}
	if (matchesFile(files, /(?:^|\/)\w[^/]*\.py$/u) || files.includes("pyproject.toml")) {
		selected.add("python");
	}
	if (matchesFile(files, /\.ya?ml$/u) && !files.includes("pnpm-lock.yaml")) {
		selected.add("yaml");
	}
	if (
		matchesFile(files, /\.sql$/u) ||
		files.some((file) => file === ".sqlfluff" || file === ".sqlfluffignore")
	) {
		selected.add("sql");
	}
	if (matchesFile(files, /\.sh$/u)) {
		selected.add("shell");
	}
	return LIGHT_SURFACES.filter((surface) => selected.has(surface));
}

function selectValidationProfiles(scope: AffectedScope): ValidationProfile[] {
	const files = scope.changedFiles;
	const selected = new Set<ValidationProfile>();
	if (
		scope.tasks.some(({ task }) =>
			["build", "build:worker", "test", "test:worker", "typecheck"].includes(task),
		)
	) {
		selected.add("affected-node");
	}
	if (
		files.some(
			(file) =>
				file.startsWith("apps/execution-control/") &&
				file !== "apps/execution-control/turbo.json" &&
				!file.endsWith("/README.md"),
		) ||
		scope.tasks.some(
			({ package: packageName, task }) =>
				packageName === "execution-control" && task.startsWith("native:"),
		)
	) {
		selected.add("go");
	}
	if (
		changesPath(files, "apps/execution-control/integration/postgres") ||
		changesPath(files, "apps/execution-control/internal/schemamigrations") ||
		files.some((file) =>
			[
				"scripts/ci/go-postgres-integration.sh",
				"apps/execution-control/go.mod",
				"apps/execution-control/go.sum",
				"apps/execution-control/internal/providerconfig/migration.go",
			].includes(file),
		) ||
		hasTask(scope, "execution-control", "test:database-integration")
	) {
		selected.add("execution-control-postgres");
	}
	if (
		changesPath(files, "packages/ingestion-kernels-rs") ||
		files.some((file) => ["Cargo.lock", "Cargo.toml", "rust-toolchain.toml"].includes(file)) ||
		scope.tasks.some(
			({ package: packageName, task }) =>
				packageName === "ingestion-kernels-rs" && task.startsWith("native:"),
		)
	) {
		selected.add("rust");
	}
	if (
		changesPath(files, "packages/ragas-runner") ||
		files.some((file) => file === "pyproject.toml" || file === "uv.lock") ||
		hasTask(scope, "ragas-runner", "test:eval")
	) {
		selected.add("ragas");
	}
	if (
		changesPath(files, "apps/app-api/drizzle") ||
		changesPath(files, "apps/app-api/ops/db") ||
		changesPath(files, "apps/app-api/src/script-support/shared-db") ||
		changesPath(files, "jobs/app-api-schema") ||
		hasTask(scope, "app-api", "test:migration-integration")
	) {
		selected.add("app-api-migration");
		selected.add("app-api-product-db");
	}
	if (
		changesPath(files, "apps/app-api/src/db") ||
		hasTask(scope, "app-api", "test:shared-db-integration")
	) {
		selected.add("app-api-product-db");
	}
	if (
		changesPath(files, "apps/ingestion-control/migrations") ||
		files.some((file) =>
			[
				"apps/ingestion-control/src/migrate.ts",
				"apps/ingestion-control/src/postgres-config.ts",
				"apps/ingestion-control/src/postgres-store.ts",
				"apps/ingestion-control/src/schema-bootstrap.ts",
			].includes(file),
		) ||
		hasTask(scope, "ingestion-control", "test:database-integration")
	) {
		selected.add("ingestion-control-postgres");
	}
	if (
		changesPath(files, "apps/ops-web/ops/db") ||
		changesPath(files, "apps/ops-web/src/server/dining") ||
		hasTask(scope, "ops-web", "test:database-integration")
	) {
		selected.add("ops-web-postgres");
	}
	if (changesPath(files, "infra/k8s")) {
		selected.add("infra");
	}
	if (
		changesPath(files, "infra/otel") ||
		changesPath(files, "infra/k8s/observability-otel-collector") ||
		files.some((file) => file.startsWith("scripts/ci/check-otel-config."))
	) {
		selected.add("otel");
	}
	const fullBrowserChanged =
		hasTask(scope, "campus-web", "test:e2e:full") ||
		files.some(
			(file) =>
				file.startsWith("apps/campus-web/e2e/") ||
				file.startsWith("apps/campus-web/test/e2e-") ||
				file === "apps/campus-web/e2e.config.ts" ||
				file === "apps/campus-web/e2e.worker.config.ts",
		);
	const campusBrowserChanged =
		fullBrowserChanged ||
		hasTask(scope, "campus-web", "test:e2e:smoke") ||
		changesPath(files, "apps/campus-web/src") ||
		changesPath(files, "apps/campus-web/scripts") ||
		changesPath(files, "configs/branding") ||
		changesPath(files, "packages/ui") ||
		files.some(
			(file) =>
				[
					"apps/campus-web/index.html",
					"apps/campus-web/package.json",
					"apps/campus-web/test/build-browser-test-content.ts",
					"apps/campus-web/test/helpers/docs-source-fixture.ts",
					"apps/campus-web/tsconfig.json",
					"apps/campus-web/vite.config.ts",
				].includes(file) || /^apps\/campus-web\/wrangler.*\.toml$/u.test(file),
		);
	if (campusBrowserChanged) {
		selected.add(fullBrowserChanged ? "campus-browser-full" : "campus-browser-smoke");
	}
	if (
		changesPath(files, "apps/ops-web/src") ||
		changesPath(files, "apps/ops-web/test/browser") ||
		changesPath(files, "packages/ui") ||
		hasTask(scope, "ops-web", "test:browser") ||
		files.some((file) =>
			[
				"apps/ops-web/browser.config.ts",
				"apps/ops-web/package.json",
				"apps/ops-web/vite.config.ts",
				"apps/ops-web/vite.ops.config.ts",
			].includes(file),
		)
	) {
		selected.add("ops-web-browser");
	}
	if (
		files.some(
			(file) =>
				file === "pnpm-lock.yaml" ||
				file === "pnpm-workspace.yaml" ||
				file === "uv.lock" ||
				file === "Cargo.lock" ||
				file.endsWith("/go.mod") ||
				file.endsWith("/go.sum"),
		)
	) {
		selected.add("dependencies");
	}
	if (
		files.some(
			(file) =>
				file === "docker-bake.hcl" ||
				file === "pnpm-lock.yaml" ||
				file === "pnpm-workspace.yaml" ||
				file.endsWith("/Dockerfile") ||
				file.startsWith("scripts/release/") ||
				file.startsWith("scripts/ci/check-ops-web-artifact."),
		)
	) {
		selected.add("toolchain");
	}
	if (selected.has("campus-browser-full")) {
		selected.delete("campus-browser-smoke");
	}
	return VALIDATION_PROFILES.filter((profile) => selected.has(profile));
}

export function partitionValidationProfiles(profiles: readonly ValidationProfile[]): {
	browserProfiles: ValidationProfile[];
	nonBrowserProfiles: ValidationProfile[];
} {
	return {
		browserProfiles: profiles.filter((profile) => BROWSER_PROFILES.has(profile)),
		nonBrowserProfiles: profiles.filter((profile) => !BROWSER_PROFILES.has(profile)),
	};
}

export function validationPlanFromScope(
	scope: AffectedScope,
	_options: Pick<ValidationPlanOptions, "mode">,
): ValidationPlan {
	const validationProfiles = selectValidationProfiles(scope);
	const executionProfiles = partitionValidationProfiles(validationProfiles);
	return {
		base: scope.base,
		browserProfiles: executionProfiles.browserProfiles,
		head: scope.head,
		lightSurfaces: selectLightSurfaces(scope.changedFiles),
		nonBrowserProfiles: executionProfiles.nonBrowserProfiles,
		validationProfiles,
	};
}

export function planValidation(
	options: ValidationPlanOptions,
	runner?: CommandRunner,
): ValidationPlan {
	const scope = resolveAffectedScope(
		{
			base: options.base,
			collectAffected: true,
			head: options.head,
			repositoryRoot: options.repositoryRoot,
		},
		runner,
	);
	return validationPlanFromScope(scope, options);
}

function argumentsMap(args: string[]): Map<string, string> {
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index];
		const value = args[index + 1];
		if (!key?.startsWith("--") || value === undefined) {
			throw new Error("Expected paired --name value arguments");
		}
		values.set(key.slice(2), value);
	}
	return values;
}

function required(values: Map<string, string>, name: string): string {
	const value = values.get(name);
	if (!value) {
		throw new Error(`Missing --${name}`);
	}
	return value;
}

function main(args: string[]): void {
	const values = argumentsMap(args);
	const mode = required(values, "mode");
	if (mode !== "pull-request") {
		throw new Error("--mode must be pull-request");
	}
	const plan = planValidation({
		base: required(values, "base"),
		head: required(values, "head"),
		mode,
		repositoryRoot: values.get("root") ?? process.cwd(),
	});
	process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
