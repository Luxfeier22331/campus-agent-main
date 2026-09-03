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
		"ragas",
		"app-api-migration",
		"app-api-product-db",
		"execution-control-postgres",
		"model-config-postgres",
		"ops-web-postgres",
		"ops-web-postgres-legacy",
		"infra",
		"otel",
	]);
	assert.deepEqual(validationProfileMetadata("ragas"), {
		lane: "manual",
		name: "ragas",
		requiresDocker: false,
		requiresUv: true,
	});
	assert.deepEqual(validationProfileMetadata("ops-web-postgres-legacy"), {
		lane: "manual",
		name: "ops-web-postgres-legacy",
		requiresDocker: true,
		requiresUv: false,
	});
	assert.deepEqual(validationProfileMetadata("container-build"), {
		lane: "pull-request",
		name: "container-build",
		requiresDocker: true,
		requiresUv: false,
	});
	assert.deepEqual(validationProfileMetadata("image-build"), {
		lane: "pull-request",
		name: "image-build",
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
	const plan = validationPlanFromScope(scope(["docs/architecture/system/product-runtime.md"]), {
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

test("keeps database, infrastructure, OTel, and browser checks manual", () => {
	for (const file of [
		"packages/ragas-runner/tests/test_runner.py",
		"apps/app-api/drizzle/0001.sql",
		"apps/ops-web/src/server/internal-portal-credential-store.ts",
		"infra/k8s/data-postgres/base/service.yaml",
		"infra/otel/collector-local-debug.yaml",
		"apps/campus-web/src/routes/index.tsx",
		"apps/campus-web/e2e/conversation-lifecycle.spec.ts",
		"apps/ops-web/src/app/overview-page.tsx",
	]) {
		assert.deepEqual(profiles([file]), [], file);
	}
	assert.deepEqual(profiles(["apps/execution-control/internal/server/server.go"]), [
		"container-build",
		"image-build",
	]);
});

test("selects container and image evidence for Node dependency inputs", () => {
	assert.deepEqual(profiles(["pnpm-lock.yaml"]), ["container-build", "image-build"]);
	assert.deepEqual(profiles(["pnpm-workspace.yaml"]), ["container-build", "image-build"]);
	assert.deepEqual(profiles(["uv.lock"]), []);
	assert.deepEqual(profiles(["apps/execution-control/go.sum"]), ["container-build", "image-build"]);
});

test("selects container contract evidence for release adapter changes", () => {
	const plan = validationPlanFromScope(scope(["scripts/release/images.mts"]), {
		mode: "pull-request",
	});
	assert.deepEqual(plan.lightSurfaces, []);
	assert.deepEqual(plan.validationProfiles, ["container-build"]);
});

test("Dockerfiles select contract and real image evidence", () => {
	assert.deepEqual(profiles(["apps/agent-runtime/Dockerfile"]), ["container-build", "image-build"]);
	assert.deepEqual(profiles(["docker-bake.hcl"]), ["container-build", "image-build"]);
});

test("CI control files stay in hosted checks while image inputs select image evidence", () => {
	for (const [file, lightSurfaces, validationProfiles] of [
		["package.json", [], ["container-build", "image-build"]],
		["turbo.json", [], ["container-build", "image-build"]],
		["apps/campus-web/turbo.json", [], []],
		["flake.nix", ["config"], []],
		["nix/tools.nix", ["config"], []],
		["scripts/ci/validation.mts", [], []],
		[".github/workflows/pr.yml", ["config"], []],
	] as const) {
		const plan = validationPlanFromScope(scope([file]), { mode: "pull-request" });
		assert.deepEqual(plan.lightSurfaces, lightSurfaces, file);
		assert.deepEqual(plan.validationProfiles, validationProfiles, file);
	}
});

test("keeps only separately owned config checks in the validation plan", () => {
	const plan = validationPlanFromScope(
		scope([".github/workflows/old.yml", "config/new.yaml", "removed/check.sh", "schema.sql"]),
		{ mode: "pull-request" },
	);
	assert.deepEqual(plan.lightSurfaces, ["config"]);
});

test("keeps static lint ownership outside the affected validation plan", () => {
	assert.deepEqual(profiles(["infra/k8s/runtime.yaml", "pnpm-lock.yaml"]), [
		"container-build",
		"image-build",
	]);
	assert.deepEqual(
		validationPlanFromScope(scope(["infra/k8s/runtime.yaml", "pnpm-lock.yaml"]), {
			mode: "pull-request",
		}).lightSurfaces,
		[],
	);
});

test("does not select YAML lint for a pnpm lock-only change", () => {
	assert.deepEqual(
		validationPlanFromScope(scope(["pnpm-lock.yaml"]), { mode: "pull-request" }).lightSurfaces,
		[],
	);
});
