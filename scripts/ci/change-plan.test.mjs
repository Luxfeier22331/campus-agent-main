import assert from "node:assert/strict";
import test from "node:test";

import { buildChangePlan, parseChangedPaths } from "./change-plan.mjs";

function plan(files, affectedPackages = [], options = {}) {
	return buildChangePlan({
		affectedPackages: new Set(affectedPackages),
		contentFiles: options.contentFiles ?? files,
		dockerIgnorePatterns: options.dockerIgnorePatterns ?? [],
		files,
		nodeDependencyChanged: options.nodeDependencyChanged ?? false,
		nodeReleaseGraphChanged: options.nodeReleaseGraphChanged ?? false,
		workspacePackageNames: new Set(options.workspacePackageNames ?? affectedPackages),
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

test("routes a Node lockfile through selected importer packages", () => {
	const result = plan(["pnpm-lock.yaml"], ["ingest-core", "source-collector"], {
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
	assert.deepEqual(result.databaseNodeFilters, [
		"app-api...",
		"ops-web...",
		"transport-publisher...",
	]);
	assert.deepEqual(result.release.images, ["app-api-schema", "transport-publisher"]);
});

test("routes Campus Web runtime changes to one Worker and local browser validation", () => {
	const result = plan(["apps/campus-web/src/main.tsx"], ["campus-web"]);

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

test("routes a Docker context allow rule only to declared consumers", () => {
	const result = plan([".dockerignore"], [], {
		dockerIgnorePatterns: ["!packages/telemetry-node/**"],
	});

	assert.deepEqual(result.dockerChecks, ["ingestion-control", "source-collector"]);
	assert.deepEqual(result.release.images, [
		"ingestion-control",
		"ingestion-control-worker",
		"source-collector",
	]);
	assert.deepEqual(result.unresolved, []);
});

test("blocks broad Docker context fallbacks instead of selecting every image", () => {
	const result = plan([".dockerignore"], [], { dockerIgnorePatterns: ["**"] });

	assert.deepEqual(result.dockerChecks, []);
	assert.deepEqual(result.release.images, []);
	assert.deepEqual(result.unresolved, [".dockerignore:**"]);
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

test("installs every workspace imported by the selected database fixture", () => {
	const appApi = plan(["apps/app-api/test/shared-product-db.integration.test.ts"]);
	const opsWeb = plan(["apps/ops-web/test/ops-web-database.integration.test.ts"]);
	const executionControl = plan([
		"apps/execution-control/internal/execution/postgres_repository.go",
	]);

	assert.deepEqual(appApi.databaseNodeFilters, ["app-api...", "transport-publisher..."]);
	assert.deepEqual(opsWeb.databaseNodeFilters, [
		"app-api...",
		"ops-web...",
		"transport-publisher...",
	]);
	assert.deepEqual(executionControl.databaseNodeFilters, []);
});

test("routes ingestion PostgreSQL ownership to its explicit database suite", () => {
	const result = plan(["apps/ingestion-control/src/schema-bootstrap.ts"], ["ingestion-control"]);

	assert.deepEqual(result.databaseSuites, ["ingestion-control"]);
	assert.deepEqual(result.databaseNodeFilters, ["ingestion-control..."]);
	assert.equal(result.lanes.includes("ingest"), true);
});

test("routes Kubernetes source changes to release promotion", () => {
	const result = plan(["infra/k8s/apps/execution-runtime/kustomization.yaml"]);

	assert.equal(result.release.kubernetes, true);
	assert.equal(result.lanes.includes("infra"), true);
});

test("routes owner environment contracts through contract checks", () => {
	const result = plan(["apps/execution-control/env.contract.json"]);

	assert.equal(result.lanes.includes("contracts"), true);
});

test("validates OTel configuration without claiming a Kubernetes release", () => {
	const result = plan([
		"infra/otel/collector-staging-template.yaml",
		"infra/otel/collector.env.example",
	]);

	assert.equal(result.lanes.includes("otel"), true);
	assert.equal(result.lanes.includes("yaml"), true);
	assert.equal(result.release.kubernetes, false);
	assert.deepEqual(result.release.images, []);
	assert.deepEqual(result.release.workers, []);
	assert.deepEqual(result.databaseSuites, []);
	assert.equal(result.browser, false);
});

test("keeps Node telemetry inside its runtime owners", () => {
	const result = plan(
		["packages/telemetry-node/src/index.ts"],
		["@campus-agent/telemetry-node", "ingestion-control", "source-collector"],
	);

	assert.equal(result.lanes.includes("otel"), false);
	assert.equal(result.lanes.includes("eval"), false);
	assert.deepEqual(result.dockerChecks, ["ingestion-control", "source-collector"]);
	assert.deepEqual(result.release.images, [
		"ingestion-control",
		"ingestion-control-worker",
		"source-collector",
	]);
});

test("does not classify the pnpm lockfile as generic YAML", () => {
	const result = plan(["pnpm-lock.yaml"], [], { nodeDependencyChanged: true });

	assert.equal(result.lanes.includes("yaml"), false);
	assert.deepEqual(result.dependencyEcosystems, ["node"]);
});

test("routes mode-only CI scripts through planner checks", () => {
	const result = plan(["scripts/ci/go-postgres-integration.sh"], [], {
		contentFiles: [],
	});

	assert.deepEqual(result.preflightChecks, ["planner"]);
	assert.equal(result.lanes.includes("go"), false);
	assert.equal(result.lanes.includes("shell"), false);
});

test("uses image inputs for local Docker verification", () => {
	const result = plan(["apps/ops-web/src/app/ops-web-app.tsx"], ["ops-web"]);

	assert.deepEqual(result.dockerChecks, ["ops-web"]);
	assert.deepEqual(result.release.images, ["ops-web"]);
});

test("keeps OTel documentation in the documentation lane", () => {
	const result = plan(["infra/otel/README.md"]);

	assert.deepEqual(result.lanes, ["docs"]);
	assert.deepEqual(result.release, { images: [], kubernetes: false, workers: [] });
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
	);

	assert.equal(result.pythonEval, true);
	assert.equal(result.lanes.includes("eval"), true);
	assert.equal(result.lanes.includes("node"), false);
});

test("runs owner tests without releasing test-only changes", () => {
	const result = plan(["apps/campus-web/test/staging-config.test.ts"], ["campus-web"]);

	assert.equal(result.lanes.includes("node"), true);
	assert.deepEqual(result.release.workers, []);
	assert.equal(result.browser, false);
});

test("keeps Turbo configuration out of product release surfaces", () => {
	const result = plan(["turbo.json"], ["campus-web", "ops-web"]);

	assert.deepEqual(result.databaseSuites, []);
	assert.deepEqual(result.release, { images: [], kubernetes: false, workers: [] });
	assert.equal(result.browser, false);
	assert.deepEqual(result.preflightChecks, ["planner"]);
});

test("does not treat the GitOps promotion script as Worker input", () => {
	const result = plan(["scripts/deploy/update-staging-candidate.sh"], ["campus-web"]);

	assert.deepEqual(result.release.workers, []);
	assert.equal(result.browser, false);
});

test("routes deleted production paths through their former owner", () => {
	const result = plan(["apps/app-api/src/retired.ts"], ["app-api"]);

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
