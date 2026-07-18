import assert from "node:assert/strict";
import test from "node:test";

import { buildChangePlan, parseChangedPaths } from "./change-plan.mjs";

function plan(files, affectedPackages = [], options = {}) {
	return buildChangePlan({
		affectedPackages: new Set(affectedPackages),
		affectedTasks: new Set(options.affectedTasks ?? []),
		files,
		nodeDependencyChanged: options.nodeDependencyChanged ?? false,
		nodeReleaseGraphChanged: options.nodeReleaseGraphChanged ?? false,
	});
}

test("routes documentation without owner runtime work", () => {
	const result = plan(["apps/app-api/README.md", "docs/reference/verification.md"]);

	assert.deepEqual(result.lanes, ["docs"]);
	assert.deepEqual(result.preflightChecks, []);
	assert.deepEqual(result.databaseNodeFilters, []);
	assert.deepEqual(result.databaseSuites, []);
	assert.deepEqual(result.dockerChecks, []);
	assert.deepEqual(result.release, { images: [], kubernetes: false, workers: [] });
	assert.equal(result.browser, false);
});

test("keeps a Node lockfile change inside Turbo affected packages", () => {
	const result = plan(["pnpm-lock.yaml"], ["ingest-core", "source-collector"], {
		affectedTasks: ["ingest-core#test:ingest", "source-collector#test:ingest"],
		nodeDependencyChanged: true,
		nodeReleaseGraphChanged: true,
	});

	assert.deepEqual(result.affectedPackages, ["ingest-core", "source-collector"]);
	assert.deepEqual(result.databaseSuites, []);
	assert.deepEqual(result.dependencyEcosystems, ["node"]);
	assert.deepEqual(result.release.images, [
		"ingestion-control",
		"ingestion-control-worker",
		"source-collector",
	]);
	assert.deepEqual(result.release.workers, []);
	assert.equal(result.pythonEval, false);
});

test("routes shared product schema to its database owners", () => {
	const result = plan(["apps/app-api/db/shared-product-schema/campus_services.sql"]);

	assert.deepEqual(result.databaseSuites, [
		"app-api-migration",
		"app-api-product",
		"execution-control",
		"ops-web",
	]);
	assert.deepEqual(result.databaseNodeFilters, ["app-api...", "ops-web..."]);
	assert.deepEqual(result.release.images, ["app-api-schema", "transport-publisher"]);
});

test("routes Campus Web runtime changes to one Worker and browser smoke", () => {
	const result = plan(["apps/campus-web/src/main.tsx"], ["campus-web"], {
		affectedTasks: ["campus-web#build:app", "campus-web#test"],
	});

	assert.equal(result.browser, true);
	assert.deepEqual(result.release.workers, ["campus-web"]);
	assert.deepEqual(result.databaseSuites, []);
	assert.equal(result.nodeFilters.includes("campus-web..."), true);
});

test("installs selected owners for root ingestion configuration", () => {
	const result = plan(["configs/ingestion/tasks.v1.json"]);

	assert.equal(result.lanes.includes("ingest"), true);
	assert.deepEqual(result.nodeFilters, [
		"ingest-core...",
		"ingestion-contracts...",
		"ingestion-control...",
		"source-collector...",
	]);
});

test("routes a global Docker context change to checks and main images only", () => {
	const result = plan([".dockerignore"]);

	assert.equal(result.dockerChecks.length, 8);
	assert.equal(result.release.images.length, 9);
	assert.equal(result.dockerChecks.includes("ingestion-control"), true);
	assert.equal(result.dockerChecks.includes("ingestion-control-worker"), false);
	assert.equal(result.lanes.includes("node"), false);
});

test("routes Actions files without running planner integration", () => {
	const result = plan([".github/workflows/pr.yml"]);

	assert.deepEqual(result.preflightChecks, ["actions"]);
	assert.equal(result.lanes.includes("yaml"), true);
});

test("routes planner and Turbo contracts without product work", () => {
	const result = plan(["scripts/ci/change-plan.mjs", "turbo.json"]);

	assert.deepEqual(result.preflightChecks, ["planner"]);
	assert.deepEqual(result.lanes, []);
	assert.deepEqual(result.release, { images: [], kubernetes: false, workers: [] });
});

test("installs only the selected database owner workspace", () => {
	const appApi = plan(["apps/app-api/test/app-api-product-db.integration.test.ts"]);
	const opsWeb = plan(["apps/ops-web/test/ops-web-postgres.integration.test.ts"]);
	const executionControl = plan([
		"apps/execution-control/internal/execution/postgres_repository.go",
	]);

	assert.deepEqual(appApi.databaseNodeFilters, ["app-api..."]);
	assert.deepEqual(opsWeb.databaseNodeFilters, ["ops-web..."]);
	assert.deepEqual(executionControl.databaseNodeFilters, []);
});

test("routes Kubernetes source changes to release promotion", () => {
	const result = plan(["infra/k8s/apps/execution-runtime/kustomization.yaml"]);

	assert.equal(result.release.kubernetes, true);
	assert.equal(result.lanes.includes("infra"), true);
});

test("does not route Node dependencies into Ragas", () => {
	const result = plan(["pnpm-lock.yaml"], ["eval-langfuse"], {
		nodeDependencyChanged: true,
	});

	assert.deepEqual(result.dependencyEcosystems, ["node"]);
	assert.equal(result.pythonEval, false);
	assert.equal(result.lanes.includes("eval"), true);
});

test("routes Python evaluation changes without broad Node work", () => {
	const result = plan(
		["packages/ragas-runner/src/campus_ragas_runner/runner.py"],
		["ragas-runner"],
		{ affectedTasks: ["ragas-runner#test:eval"] },
	);

	assert.equal(result.pythonEval, true);
	assert.equal(result.lanes.includes("eval"), true);
	assert.equal(result.lanes.includes("node"), false);
});

test("runs owner tests without releasing test-only changes", () => {
	const result = plan(["apps/campus-web/test/staging-config.test.ts"], ["campus-web"], {
		affectedTasks: ["campus-web#test"],
	});

	assert.equal(result.lanes.includes("node"), true);
	assert.deepEqual(result.release.workers, []);
	assert.equal(result.browser, false);
});

test("keeps Turbo configuration out of product release surfaces", () => {
	const result = plan(["turbo.json"], ["campus-web", "ops-web"], {
		affectedTasks: ["campus-web#build:app", "ops-web#build"],
	});

	assert.deepEqual(result.databaseSuites, []);
	assert.deepEqual(result.release, { images: [], kubernetes: false, workers: [] });
	assert.equal(result.browser, false);
	assert.deepEqual(result.preflightChecks, ["planner"]);
});

test("does not treat the GitOps promotion script as Worker input", () => {
	const result = plan(["scripts/deploy/update-staging-candidate.sh"], ["campus-web"], {
		affectedTasks: ["campus-web#test"],
	});

	assert.deepEqual(result.release.workers, []);
	assert.equal(result.browser, false);
});

test("routes deleted production paths through their former owner", () => {
	const result = plan(["apps/app-api/src/retired.ts"], ["app-api"], {
		affectedTasks: ["app-api#build:worker"],
	});

	assert.deepEqual(result.release.workers, ["app-api"]);
});

test("parses deleted and renamed paths from NUL-delimited Git output", () => {
	assert.deepEqual(
		parseChangedPaths(
			"D\0apps/app-api/src/deleted.ts\0R100\0apps/campus-web/src/old.ts\0docs/old.ts\0",
		),
		["apps/app-api/src/deleted.ts", "apps/campus-web/src/old.ts", "docs/old.ts"],
	);
});
