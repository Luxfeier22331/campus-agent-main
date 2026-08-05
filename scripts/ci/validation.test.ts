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
	return validationPlanFromScope(scope(changedFiles, tasks), { mode: "pull-request" })
		.validationProfiles;
}

test("docs-only changes keep automatic evidence empty", () => {
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

test("maps lockfiles to dependency and toolchain checks only", () => {
	assert.deepEqual(profiles(["pnpm-lock.yaml"]), ["dependencies", "toolchain"]);
	assert.deepEqual(profiles(["uv.lock"]), ["dependencies"]);
	assert.deepEqual(profiles(["Cargo.lock"]), ["dependencies"]);
	assert.deepEqual(profiles(["apps/execution-control/go.sum"]), ["dependencies"]);
});

test("keeps release and toolchain overlap explicit for release adapter changes", () => {
	const plan = validationPlanFromScope(scope(["scripts/release/images.mts"]), {
		mode: "pull-request",
	});
	assert.deepEqual(plan.lightSurfaces, ["release"]);
	assert.deepEqual(plan.validationProfiles, ["toolchain"]);
});

test("Dockerfiles select release tooling without pretending to build images", () => {
	assert.deepEqual(profiles(["apps/agent-runtime/Dockerfile"]), ["toolchain"]);
	assert.deepEqual(profiles(["docker-bake.hcl"]), ["toolchain"]);
});

test("CI control files stay in hosted checks instead of selecting heavy profiles", () => {
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

test("selects static surfaces from renamed and deleted paths", () => {
	const plan = validationPlanFromScope(
		scope([".github/workflows/old.yml", "config/new.yaml", "removed/check.sh", "schema.sql"]),
		{ mode: "pull-request" },
	);
	assert.deepEqual(plan.lightSurfaces, ["config", "release", "yaml", "sql", "shell"]);
});
