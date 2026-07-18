import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const prWorkflow = readFileSync(".github/workflows/pr.yml", "utf8");
const releaseWorkflow = readFileSync(".github/workflows/execution-runtime-publish.yml", "utf8");
const scheduledHealthWorkflow = readFileSync(".github/workflows/scheduled-health.yml", "utf8");
const diningImageWorkflow = readFileSync(".github/workflows/dining-sync-image.yml", "utf8");
const actionlintAction = readFileSync(".github/actions/run-actionlint/action.yml", "utf8");
const actionlintConfig = readFileSync(".github/actionlint.yaml", "utf8");

function jobNames(workflow) {
	const jobs = workflow.slice(workflow.indexOf("\njobs:\n") + 7);
	return [...jobs.matchAll(/^ {2}([a-z][a-z0-9-]+):$/gmu)].map((match) => match[1]);
}

test("keeps the PR graph small and free of release image work", () => {
	assert.deepEqual(jobNames(prWorkflow), [
		"preflight",
		"code",
		"native",
		"docker-check",
		"integration",
		"ui-smoke",
		"required",
	]);
	assert.doesNotMatch(prWorkflow, /image-scan|trivy image|--sbom=true/u);
	assert.match(prWorkflow, /check-docker-affected\.mjs/u);
	assert.match(prWorkflow, /max-parallel: 1/u);
	assert.match(prWorkflow, /target: \$\{\{ steps\.target\.outputs\.target \}\}/u);
	assert.match(prWorkflow, /push: false/u);
	assert.match(prWorkflow, /load: false/u);
});

test("routes preflight tools and database installs from the shared plan", () => {
	assert.match(prWorkflow, /preflightChecks, 'planner'/u);
	assert.match(prWorkflow, /preflightChecks, 'actions'/u);
	assert.match(prWorkflow, /databaseNodeFilters/u);
	assert.doesNotMatch(
		prWorkflow,
		/workspace-filters-json: '\["app-api\.\.\.", "ops-web\.\.\."\]'/u,
	);
	assert.match(prWorkflow, /zizmor==1\.27\.0/u);
	assert.match(
		prWorkflow,
		/has_suite execution-control && scripts\/ci\/go-postgres-integration\.sh/u,
	);
});

test("keeps Worker validation independent from release selection", () => {
	const codeJob = prWorkflow.slice(
		prWorkflow.indexOf("\n  code:\n"),
		prWorkflow.indexOf("\n  native:\n"),
	);
	assert.match(codeJob, /pnpm ci:worker:affected/u);
	assert.doesNotMatch(codeJob, /release\.workers/u);
});

test("keeps full browser coverage scheduled without duplicate Go setup", () => {
	const nodeJob = scheduledHealthWorkflow.slice(
		scheduledHealthWorkflow.indexOf("\n  node:\n"),
		scheduledHealthWorkflow.indexOf("\n  browser:\n"),
	);
	const browserJob = scheduledHealthWorkflow.slice(
		scheduledHealthWorkflow.indexOf("\n  browser:\n"),
		scheduledHealthWorkflow.indexOf("\n  go:\n"),
	);
	assert.doesNotMatch(nodeJob, /Setup Go|Verify Go|setup-go/u);
	assert.match(browserJob, /build:docs:fixture/u);
	assert.match(browserJob, /test:e2e:full/u);
	assert.match(browserJob, /CAMPUS_WEB_E2E_DOCS_PREBUILT/u);
});

test("builds the manually published dining image once", () => {
	assert.equal(diningImageWorkflow.match(/docker\/build-push-action@/gu)?.length, 1);
	assert.match(diningImageWorkflow, /docker push "\$\{IMAGE_NAME\}:\$\{GITHUB_SHA\}"/u);
});

test("routes main publication through the shared change plan", () => {
	assert.deepEqual(jobNames(releaseWorkflow), [
		"release-plan",
		"release-config",
		"publish-images",
		"publish-workers",
		"promote",
	]);
	assert.match(releaseWorkflow, /scripts\/ci\/write-change-plan\.sh/u);
	assert.match(releaseWorkflow, /scripts\/ci\/publish-images\.sh/u);
	assert.doesNotMatch(releaseWorkflow, /dorny\/paths-filter|\n {4}paths:/u);
	assert.match(releaseWorkflow, /queue: max/u);
	assert.match(releaseWorkflow, /validate_only:/u);
});

test("keeps required staging Worker bindings in the publication job", () => {
	for (const name of [
		"STAGING_APP_API_DB_FRESH_HYPERDRIVE_ID",
		"STAGING_APP_API_DB_HYPERDRIVE_ID",
		"STAGING_EXECUTION_CONTROL_VPC_SERVICE_ID",
		"STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY",
		"STAGING_MAP_DATA_BUCKET_NAME",
	]) {
		assert.match(releaseWorkflow, new RegExp(`${name}:`, "u"));
	}
	for (const name of [
		"STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED",
		"STAGING_INGESTION_OBJECT_STORE_REGION",
	]) {
		assert.match(releaseWorkflow, new RegExp(`vars\\.${name}`, "u"));
	}
	assert.doesNotMatch(releaseWorkflow, /STAGING_INGESTION_OBJECT_STORE_ENDPOINT/u);
	assert.doesNotMatch(releaseWorkflow, /STAGING_ACCESS_(?:POLICY_AUD|TEAM_DOMAIN)/u);
});

test("plans PR checks from the tested merge commit and scans PR commits", () => {
	assert.match(prWorkflow, /HEAD_SHA: \$\{\{ github\.sha \}\}/u);
	assert.match(prWorkflow, /TURBO_SCM_HEAD: \$\{\{ needs\.preflight\.outputs\.plan_head_sha \}\}/u);
	assert.match(prWorkflow, /scripts\/ci\/gitleaks\.sh "\$BASE_SHA" "\$HEAD_SHA"/u);
	assert.doesNotMatch(prWorkflow, /ghcr\.io\/gitleaks/u);
});

test("pins the current Actionlint release and narrows its queue syntax exception", () => {
	assert.match(actionlintAction, /default: 1\.7\.12/u);
	assert.match(actionlintConfig, /execution-runtime-publish\.yml/u);
	assert.match(actionlintConfig, /unexpected key "queue"/u);
});
