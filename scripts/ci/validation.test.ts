import assert from "node:assert/strict";
import test from "node:test";

import type { AffectedScope, ScopeTask } from "./scope.mts";
import { validationPlanFromScope } from "./validation.mts";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);

function scope(changedFiles: string[], tasks: ScopeTask[] = []): AffectedScope {
	return { base: BASE, changedFiles, head: HEAD, tasks };
}

function profiles(changedFiles: string[], tasks: ScopeTask[] = []) {
	return validationPlanFromScope(scope(changedFiles, tasks), {
		mode: "pull-request",
	}).validationProfiles;
}

test("docs-only changes keep heavy evidence empty", () => {
	const plan = validationPlanFromScope(scope(["docs/architecture/current.md"]), {
		mode: "pull-request",
	});
	assert.deepEqual(plan.lightSurfaces, []);
	assert.deepEqual(plan.validationProfiles, []);
});

test("selects affected Node and Worker evidence from Turbo tasks", () => {
	assert.deepEqual(
		profiles(
			[],
			[
				{ package: "app-api", task: "test:worker" },
				{ package: "campus-contracts", task: "typecheck" },
			],
		),
		["affected-node"],
	);
});

test("selects Go, Rust, and Ragas owners", () => {
	assert.deepEqual(profiles(["apps/execution-control/internal/server/server.go"]), ["go"]);
	assert.deepEqual(profiles(["packages/ingestion-kernels-rs/src/lib.rs"]), ["rust"]);
	assert.deepEqual(profiles(["packages/ragas-runner/tests/test_runner.py"]), ["ragas"]);
});

test("selects every disposable PostgreSQL owner", () => {
	const cases: [string, string[]][] = [
		["apps/app-api/drizzle/0001.sql", ["app-api-migration", "app-api-product-db"]],
		["apps/app-api/src/db/schema/chat.ts", ["app-api-product-db"]],
		[
			"apps/execution-control/internal/schemamigrations/migrator.go",
			["go", "execution-control-postgres"],
		],
		["apps/ingestion-control/src/postgres-store.ts", ["ingestion-control-postgres"]],
		["apps/ops-web/ops/db/schema.ts", ["ops-web-postgres"]],
	];
	for (const [file, expected] of cases) {
		assert.deepEqual(profiles([file]), expected, file);
	}
});

test("selects infrastructure and OTel evidence independently", () => {
	assert.deepEqual(profiles(["infra/k8s/data-postgres/base/service.yaml"]), ["infra"]);
	assert.deepEqual(profiles(["infra/otel/collector-local-debug.yaml"]), ["otel"]);
	assert.deepEqual(profiles(["infra/k8s/observability-otel-collector/base/configmap.yaml"]), [
		"infra",
		"otel",
	]);
});

test("uses smoke for Campus product changes and full coverage for browser contracts", () => {
	assert.deepEqual(profiles(["apps/campus-web/src/routes/index.tsx"]), ["campus-browser-smoke"]);
	assert.deepEqual(profiles(["apps/campus-web/e2e/chat.spec.ts"]), ["campus-browser-full"]);
	assert.deepEqual(profiles(["apps/ops-web/src/app/overview-page.tsx"]), ["ops-web-browser"]);
	assert.deepEqual(profiles(["packages/ui/src/button.tsx"]), [
		"campus-browser-smoke",
		"ops-web-browser",
	]);
	assert.deepEqual(profiles([], [{ package: "campus-web", task: "test:e2e:smoke" }]), [
		"campus-browser-smoke",
	]);
	assert.deepEqual(profiles([], [{ package: "ops-web", task: "test:browser" }]), [
		"ops-web-browser",
	]);
	assert.deepEqual(
		profiles(
			["apps/campus-web/test/staging-config.test.ts"],
			[{ package: "campus-web", task: "test" }],
		),
		["affected-node"],
	);
});

test("partitions browser and non-browser evidence into separate lanes", () => {
	const plan = validationPlanFromScope(
		scope(["packages/ui/src/button.tsx"], [{ package: "app-api", task: "test:worker" }]),
		{ mode: "pull-request" },
	);
	assert.deepEqual(plan.browserProfiles, ["campus-browser-smoke", "ops-web-browser"]);
	assert.deepEqual(plan.nonBrowserProfiles, ["affected-node"]);
	assert.deepEqual(
		[...plan.nonBrowserProfiles, ...plan.browserProfiles].sort(),
		[...plan.validationProfiles].sort(),
	);
});

test("maps ecosystem lockfiles to their owners and dependency scanning", () => {
	assert.deepEqual(profiles(["pnpm-lock.yaml"]), ["dependencies", "toolchain"]);
	assert.deepEqual(profiles(["uv.lock"]), ["ragas", "dependencies"]);
	assert.deepEqual(profiles(["Cargo.lock"]), ["rust", "dependencies"]);
	assert.deepEqual(profiles(["apps/execution-control/go.sum"]), [
		"go",
		"execution-control-postgres",
		"dependencies",
	]);
});

test("Dockerfiles select release tooling without pretending to build images", () => {
	assert.deepEqual(profiles(["apps/agent-runtime/Dockerfile"]), ["toolchain"]);
	assert.deepEqual(profiles(["docker-bake.hcl"]), ["toolchain"]);
});

test("CI control files stay in hosted checks instead of selecting every heavy profile", () => {
	for (const [file, lightSurfaces] of [
		["package.json", ["release"]],
		["turbo.json", ["release"]],
		["apps/campus-web/turbo.json", ["release"]],
		["flake.nix", ["config"]],
		["nix/tools.nix", ["config"]],
		["scripts/ci/validation.mts", ["release"]],
		[".github/workflows/pr.yml", ["config", "release", "yaml"]],
	] as const) {
		const plan = validationPlanFromScope(scope([file]), { mode: "pull-request" });
		assert.deepEqual(plan.lightSurfaces, lightSurfaces, file);
		assert.deepEqual(plan.validationProfiles, [], file);
	}
});

test("consumes normalized tasks even when the cumulative diff includes Turbo configuration", () => {
	const plan = validationPlanFromScope(
		scope(
			[
				"turbo.json",
				"apps/campus-web/turbo.json",
				"infra/k8s/data-object-store/base/bootstrap.yaml",
			],
			[{ package: "campus-web", task: "build:worker" }],
		),
		{ mode: "pull-request" },
	);
	assert.deepEqual(plan.lightSurfaces, ["release", "yaml"]);
	assert.deepEqual(plan.validationProfiles, ["affected-node", "infra"]);
});

test("selects static surfaces from renamed and deleted paths", () => {
	const plan = validationPlanFromScope(
		scope([".github/workflows/old.yml", "config/new.yaml", "removed/check.sh", "schema.sql"]),
		{ mode: "pull-request" },
	);
	assert.deepEqual(plan.lightSurfaces, ["config", "release", "yaml", "sql", "shell"]);
});
