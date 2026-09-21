import assert from "node:assert/strict";
import test from "node:test";

import type { AffectedScope, ScopeTask } from "./scope.mts";
import { toolingGroupsForFiles } from "./tooling-tasks.mts";
import {
	checkValidationOutcomes,
	MANUAL_VALIDATION_PROFILES,
	VALIDATION_PROFILE_REGISTRY,
	validationPlanFromScope,
	validationProfileMetadata,
} from "./validation.mts";

test("both Go owners select the same native checks, including lint-only scope", () => {
	for (const owner of ["execution-control", "model-config"]) {
		for (const task of ["native:format", "native:lint", "native:typecheck", "native:test"]) {
			assert(
				profiles([`apps/${owner}/main.go`], [{ package: owner, task }]).includes("affected-native"),
			);
		}
	}
});

test("only unselected checks may be skipped in the repository summary", () => {
	const plan = validationPlanFromScope(
		scope(["apps/model-config/main.go"], [{ package: "model-config", task: "native:lint" }]),
	);
	const outcomes = Object.fromEntries(
		[
			"plan",
			"install-static-dependencies",
			"repository-lint",
			"repository-docs",
			"repository-test",
			"secrets",
			"affected-native",
			"container-build",
		].map((name) => [name, "success"]),
	);
	outcomes["affected-node"] = "skipped";
	checkValidationOutcomes(plan, outcomes);
	for (const status of ["skipped", "failure", "cancelled", ""]) {
		assert.throws(
			() => checkValidationOutcomes(plan, { ...outcomes, "affected-native": status }),
			/affected-native/,
		);
	}
	const docsPlan = validationPlanFromScope(scope(["docs/README.md"]));
	assert.throws(
		() =>
			checkValidationOutcomes(docsPlan, {
				plan: "success",
				"install-static-dependencies": "success",
				"repository-lint": "success",
				"repository-test": "success",
				"repository-docs": "skipped",
				secrets: "success",
			}),
		/repository-docs/,
	);
});

test("manual environments retain actual cross-language dependencies", () => {
	assert(
		validationProfileMetadata("execution-control-postgres").installPackages.includes(
			"campus-agent-schema...",
		),
	);
	assert(
		validationProfileMetadata("model-config-postgres").installPackages.includes(
			"campus-agent-schema...",
		),
	);
	assert(
		validationProfileMetadata("execution-control-temporal").installPackages.includes(
			"agent-runtime...",
		),
	);
	assert.equal(validationProfileMetadata("go").shell, "ci-go");
});

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);

function scope(changedFiles: string[], tasks: ScopeTask[] = []): AffectedScope {
	return { base: BASE, changedFiles, head: HEAD, tasks };
}

function profiles(changedFiles: string[], tasks: ScopeTask[] = []) {
	return validationPlanFromScope(scope(changedFiles, tasks)).validationProfiles;
}

test("tooling groups follow the changed repository surface", () => {
	assert.deepEqual(toolingGroupsForFiles(["apps/campus-web/src/routes/index.tsx"]), []);
	assert.deepEqual(toolingGroupsForFiles(["docs/architecture/product.md"]), ["docs"]);
	assert.deepEqual(toolingGroupsForFiles(["scripts/ci/validation.mts"]), ["ci"]);
	assert.deepEqual(toolingGroupsForFiles(["package.json"]), ["ci", "release"]);
});

test("validation profiles have one fail-closed registry", () => {
	assert.deepEqual(MANUAL_VALIDATION_PROFILES, [
		"go",
		"ragas",
		"app-api-product-db",
		"execution-control-postgres",
		"execution-control-temporal",
		"execution-control-stream",
		"execution-control-replay",
		"model-config-postgres",
		"ops-web-postgres",
		"infra",
		"otel",
	]);
	assert.deepEqual(validationProfileMetadata("ragas"), {
		lane: "manual",
		name: "ragas",
		shell: "ci-light",
		installPackages: ["eval-langfuse...", "ragas-runner"],
		requiresDocker: false,
		requiresUv: true,
	});
	assert.deepEqual(validationProfileMetadata("container-build"), {
		lane: "pull-request",
		name: "container-build",
		shell: "ci-release",
		installPackages: [],
		requiresDocker: true,
		requiresUv: false,
	});
	assert.deepEqual(validationProfileMetadata("image-build"), {
		lane: "pull-request",
		name: "image-build",
		shell: "ci-release",
		installPackages: [],
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
	const plan = validationPlanFromScope(scope(["docs/architecture/system/product-runtime.md"]));
	assert.deepEqual(plan.affectedPackages, []);
	assert.deepEqual(plan.lightSurfaces, []);
	assert.deepEqual(plan.validationProfiles, []);
	assert.ok(
		plan.profileDecisions.every((decision) => !decision.selected && decision.reason.length > 0),
	);
});

test("migration changes select real PostgreSQL checks and cannot pass when skipped", () => {
	for (const file of [
		"jobs/campus-agent-schema/src/history.ts",
		"jobs/campus-agent-schema/migrations/20260913080000_example/migration.sql",
		"jobs/campus-agent-schema/test/upgrade.integration.ts",
		"jobs/campus-agent-schema/package.json",
	]) {
		if (file === "pnpm-lock.yaml" || file === "pnpm-workspace.yaml") {
			continue;
		}
		const plan = validationPlanFromScope(scope([file]));
		assert(plan.validationProfiles.includes("schema-migration"), file);
		const outcomes = Object.fromEntries(
			[
				"plan",
				"install-static-dependencies",
				"repository-lint",
				"repository-docs",
				"repository-test",
				"secrets",
				...plan.validationProfiles,
			].map((name) => [name, "success"]),
		);
		checkValidationOutcomes(plan, outcomes);
		for (const status of ["skipped", "failure", "cancelled"]) {
			assert.throws(
				() => checkValidationOutcomes(plan, { ...outcomes, "schema-migration": status }),
				/schema-migration/u,
			);
		}
	}
});

test("execution-control native checks are automatic while service integrations stay manual", () => {
	const selected = profiles(
		["apps/execution-control/internal/temporalruntime/workflow.go"],
		[
			{ package: "execution-control", task: "native:test" },
			{ package: "execution-control", task: "native:typecheck" },
		],
	);
	assert.ok(selected.includes("affected-native"));
	for (const profile of [
		"execution-control-temporal",
		"execution-control-stream",
		"execution-control-replay",
	] as const) {
		assert.ok(!selected.includes(profile));
		assert.equal(validationProfileMetadata(profile).lane, "manual");
	}
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
	);
	assert.deepEqual(plan.affectedPackages, ["app-api"]);
	assert.deepEqual(plan.validationProfiles, ["affected-node"]);
	assert.deepEqual(
		plan.profileDecisions
			.filter((decision) => decision.selected)
			.map((decision) => decision.profile),
		plan.validationProfiles,
	);
	assert.ok(plan.affectedTasks.some((task) => task.package === "app-api"));
});

test("does not schedule PR Node validation or installs for typecheck-only changes", () => {
	const plan = validationPlanFromScope(scope([], [{ package: "campus-web", task: "typecheck" }]));
	assert.deepEqual(plan.affectedPackages, []);
	assert.deepEqual(plan.validationProfiles, []);
});

test("keeps unrelated service, infrastructure and browser checks manual", () => {
	for (const file of [
		"packages/ragas-runner/tests/test_runner.py",
		"infra/k8s/data-postgres/base/service.yaml",
		"infra/otel/collector-local-debug.yaml",
		"apps/campus-web/src/routes/index.tsx",
		"apps/campus-web/e2e/conversation-lifecycle.spec.ts",
	]) {
		assert.deepEqual(profiles([file]), [], file);
	}
	assert.deepEqual(profiles(["apps/execution-control/internal/server/server.go"]), ["image-build"]);
});

test("selects container and image evidence for Node dependency inputs", () => {
	assert.deepEqual(profiles(["pnpm-lock.yaml"]), ["container-build", "image-build"]);
	assert.deepEqual(profiles(["pnpm-workspace.yaml"]), ["container-build", "image-build"]);
	assert.deepEqual(profiles(["uv.lock"]), []);
	assert.deepEqual(profiles(["apps/execution-control/go.sum"]), ["image-build"]);
});

test("selects container contract evidence for release adapter changes", () => {
	const plan = validationPlanFromScope(scope(["scripts/release/images.mts"]));
	assert.deepEqual(plan.lightSurfaces, []);
	assert.deepEqual(plan.validationProfiles, ["container-build", "image-build"]);
});

test("Dockerfiles select contract and real image evidence", () => {
	assert.deepEqual(profiles(["apps/agent-runtime/Dockerfile"]), ["container-build", "image-build"]);
	assert.deepEqual(profiles(["docker-bake.hcl"]), ["container-build", "image-build"]);
});

test("CI control files stay in hosted checks while image inputs select image evidence", () => {
	for (const [file, lightSurfaces, validationProfiles] of [
		["package.json", [], ["container-build", "image-build"]],
		["turbo.json", [], []],
		["apps/campus-web/turbo.json", [], []],
		["flake.nix", ["config"], []],
		["nix/tools.nix", ["config"], []],
		["scripts/ci/validation.mts", [], []],
		[".github/workflows/pr.yml", ["config"], []],
	] as const) {
		const plan = validationPlanFromScope(scope([file]));
		assert.deepEqual(plan.lightSurfaces, lightSurfaces, file);
		assert.deepEqual(plan.validationProfiles, validationProfiles, file);
	}
});

test("keeps only separately owned config checks in the validation plan", () => {
	const plan = validationPlanFromScope(
		scope([".github/workflows/old.yml", "config/new.yaml", "removed/check.sh", "schema.sql"]),
	);
	assert.deepEqual(plan.lightSurfaces, ["config"]);
});

test("keeps static lint ownership outside the affected validation plan", () => {
	assert.deepEqual(profiles(["infra/k8s/runtime.yaml", "pnpm-lock.yaml"]), [
		"container-build",
		"image-build",
	]);
	assert.deepEqual(
		validationPlanFromScope(scope(["infra/k8s/runtime.yaml", "pnpm-lock.yaml"])).lightSurfaces,
		[],
	);
});

test("does not select YAML lint for a pnpm lock-only change", () => {
	assert.deepEqual(validationPlanFromScope(scope(["pnpm-lock.yaml"])).lightSurfaces, []);
});
