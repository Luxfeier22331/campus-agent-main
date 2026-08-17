import assert from "node:assert/strict";
import test from "node:test";

import type { AffectedScope, ScopeTask } from "./scope.mts";
import {
	MANUAL_VALIDATION_PROFILES,
	VALIDATION_PROFILE_REGISTRY,
	validationPlanFromScope,
	validationProfileMetadata,
} from "./validation.mts";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);

function scope(changedFiles: string[], tasks: ScopeTask[] = []): AffectedScope {
	return { base: BASE, changedFiles, head: HEAD, tasks };
}

function profiles(changedFiles: string[], tasks: ScopeTask[] = []) {
	return validationPlanFromScope(scope(changedFiles, tasks), { mode: "pull-request" })
		.validationProfiles;
}

test("validation profiles have one fail-closed registry", () => {
	assert.deepEqual(MANUAL_VALIDATION_PROFILES, [
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
	]);
	assert.deepEqual(validationProfileMetadata("ragas"), {
		lane: "manual",
		name: "ragas",
		requiresDocker: false,
		requiresUv: true,
	});
	assert.deepEqual(validationProfileMetadata("toolchain"), {
		lane: "pull-request",
		name: "toolchain",
		requiresDocker: true,
		requiresUv: false,
	});
	assert.throws(() => validationProfileMetadata("unknown"), /Unsupported validation profile/u);
	for (const [profile, definition] of Object.entries(VALIDATION_PROFILE_REGISTRY)) {
		if (definition.executor.kind === "commands") {
			assert.ok(definition.executor.commands.length > 0, profile);
		}
	}
});

test("docs-only changes keep automatic evidence empty", () => {
	const plan = validationPlanFromScope(scope(["docs/architecture/current.md"]), {
		mode: "pull-request",
	});
	assert.deepEqual(plan.affectedPackages, []);
	assert.deepEqual(plan.lightSurfaces, []);
	assert.deepEqual(plan.validationProfiles, []);
});

test("selects affected Node and Worker evidence from Turbo tasks", () => {
	const plan = validationPlanFromScope(
		scope(
			[],
			[
				{ package: "campus-contracts", task: "typecheck" },
				{ package: "app-api", task: "test:worker" },
				{ package: "app-api", task: "typecheck" },
			],
		),
		{ mode: "pull-request" },
	);
	assert.deepEqual(plan.affectedPackages, ["app-api", "campus-contracts"]);
	assert.deepEqual(plan.validationProfiles, ["affected-node"]);
});

test("keeps native, database, infrastructure, OTel, and browser checks manual", () => {
	for (const file of [
		"apps/execution-control/internal/server/server.go",
		"packages/ingestion-kernels-rs/src/lib.rs",
		"packages/ragas-runner/tests/test_runner.py",
		"apps/app-api/drizzle/0001.sql",
		"apps/ingestion-control/src/postgres-store.ts",
		"infra/k8s/data-postgres/base/service.yaml",
		"infra/otel/collector-local-debug.yaml",
		"apps/campus-web/src/routes/index.tsx",
		"apps/campus-web/e2e/chat.spec.ts",
		"apps/ops-web/src/app/overview-page.tsx",
	]) {
		assert.deepEqual(profiles([file]), [], file);
	}
});

test("keeps mutable vulnerability scans out of pull request profiles", () => {
	assert.deepEqual(profiles(["pnpm-lock.yaml"]), ["toolchain"]);
	assert.deepEqual(profiles(["pnpm-workspace.yaml"]), ["toolchain"]);
	assert.deepEqual(profiles(["uv.lock"]), []);
	assert.deepEqual(profiles(["Cargo.lock"]), []);
	assert.deepEqual(profiles(["apps/execution-control/go.sum"]), []);
});

test("selects toolchain evidence for release adapter changes", () => {
	const plan = validationPlanFromScope(scope(["scripts/release/images.mts"]), {
		mode: "pull-request",
	});
	assert.deepEqual(plan.lightSurfaces, []);
	assert.deepEqual(plan.validationProfiles, ["toolchain"]);
});

test("Dockerfiles select release tooling without pretending to build images", () => {
	assert.deepEqual(profiles(["apps/agent-runtime/Dockerfile"]), ["toolchain"]);
	assert.deepEqual(profiles(["docker-bake.hcl"]), ["toolchain"]);
});

test("CI control files stay in hosted checks instead of selecting heavy profiles", () => {
	for (const [file, lightSurfaces] of [
		["package.json", []],
		["turbo.json", []],
		["apps/campus-web/turbo.json", []],
		["flake.nix", ["config"]],
		["nix/tools.nix", ["config"]],
		["scripts/ci/validation.mts", []],
		[".github/workflows/pr.yml", ["config", "yaml"]],
	] as const) {
		const plan = validationPlanFromScope(scope([file]), { mode: "pull-request" });
		assert.deepEqual(plan.lightSurfaces, lightSurfaces, file);
		assert.deepEqual(plan.validationProfiles, [], file);
	}
});

test("selects static surfaces from renamed and deleted paths", () => {
	const plan = validationPlanFromScope(
		scope([".github/workflows/old.yml", "config/new.yaml", "removed/check.sh", "schema.sql"]),
		{ mode: "pull-request" },
	);
	assert.deepEqual(plan.lightSurfaces, ["config", "yaml", "sql", "shell"]);
});
