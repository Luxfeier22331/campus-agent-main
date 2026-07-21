import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const read = (path) => readFileSync(path, "utf8");
const prSource = read(".github/workflows/pr.yml");
const prWorkflow = parse(prSource);
const releaseSource = read(".github/workflows/execution-runtime-publish.yml");
const releaseWorkflow = parse(releaseSource);
const healthSource = read(".github/workflows/health.yml");
const healthWorkflow = parse(healthSource);
const verifySource = read(".github/workflows/verify.yml");
const verifyWorkflow = parse(verifySource);
const diningSource = read(".github/workflows/dining-sync-image.yml");
const diningWorkflow = parse(diningSource);
const scorecardSource = read(".github/workflows/scorecard.yml");
const scorecardWorkflow = parse(scorecardSource);
const actionlintConfig = read(".github/actionlint.yaml");
const packageJson = read("package.json");
const osvScan = read("scripts/ci/osv-scan.sh");
const runAffected = read("scripts/ci/run-affected.sh");
const checkStaticAffected = read("scripts/ci/check-static-affected.sh");
const publishImages = read("scripts/ci/publish-images.sh");
const opsWebDockerfile = read("apps/ops-web/Dockerfile");
const ciSurfaces = read("scripts/ci/ci-surfaces.mjs");

function setupNodeStep(jobName) {
	return releaseWorkflow.jobs[jobName].steps.find(
		(candidate) => candidate.uses === "./.github/actions/setup-node-pnpm",
	);
}

test("keeps automatic PR checks lightweight and bounded", () => {
	assert.deepEqual(Object.keys(prWorkflow.jobs), ["pr-fast"]);
	assert.equal(prWorkflow.jobs["pr-fast"]["timeout-minutes"], 8);
	assert.match(prSource, /pnpm ci:pr/u);
	assert.match(
		prWorkflow.jobs["pr-fast"].steps[1].with["workspace-filters"],
		/campus-contracts\.\.\./u,
	);
	assert.doesNotMatch(
		prSource,
		/docker\/build-push-action|playwright|test:e2e|staging|wrangler deploy|TURBO_TOKEN/iu,
	);
	assert.match(packageJson, /"ci:pr": "CI_AFFECTED_PROFILE=fast/u);
});

test("keeps the fast profile free of build and runtime checks", () => {
	const fastProfileStart = runAffected.indexOf("run_fast()");
	const fastProfile = runAffected.slice(
		fastProfileStart,
		runAffected.indexOf("run_code()", fastProfileStart),
	);
	assert.doesNotMatch(fastProfile, /docker (?:run|build)|playwright|test:e2e|ci:go|ci:rust/u);
	assert.match(fastProfile, /check-static-affected/u);
	assert.match(runAffected, /check-ops-web-artifact\.test\.mjs/u);
	assert.match(checkStaticAffected, /--no-errors-on-unmatched/u);
	assert.match(fastProfile, /gitleaks/u);
	assert.match(fastProfile, /scripts\/ci\/shellcheck\.sh/u);
});

test("keeps heavy health checks explicit and single-profile", () => {
	assert.equal(healthWorkflow.on.schedule, undefined);
	assert.ok(healthWorkflow.on.workflow_dispatch);
	assert.deepEqual(healthWorkflow.on.workflow_dispatch.inputs.profile.options, [
		"node",
		"go",
		"rust",
		"database",
		"browser",
		"dependencies",
	]);
	assert.match(healthSource, /TURBO_TOKEN/u);
	assert.doesNotMatch(healthSource, /schedule:/u);
});

test("keeps Docker, database and browser verification manual and affected", () => {
	assert.equal(verifyWorkflow.on.schedule, undefined);
	assert.ok(verifyWorkflow.on.workflow_dispatch);
	assert.deepEqual(verifyWorkflow.on.workflow_dispatch.inputs.profile.options, [
		"docker",
		"database",
		"browser",
	]);
	assert.deepEqual(Object.keys(verifyWorkflow.jobs), ["plan", "docker", "database", "browser"]);
	assert.match(verifySource, /TURBO_TOKEN/u);
	assert.match(verifySource, /TURBO_TEAM/u);
	assert.match(verifySource, /TURBO_REMOTE_CACHE_SIGNATURE_KEY/u);
	assert.doesNotMatch(verifySource, /Require Remote Cache configuration/u);
	assert.match(verifySource, /pnpm ci:affected:docker /u);
	assert.match(verifySource, /pnpm ci:affected:database /u);
	assert.match(verifySource, /pnpm ci:affected:browser /u);
});

test("guards release publication and unresolved surfaces", () => {
	assert.equal(releaseWorkflow.concurrency.queue, "max");
	assert.match(releaseSource, /allowed only from main/u);
	assert.match(releaseSource, /pnpm ci:fast/u);
	for (const jobName of ["release-plan", "release-config", "publish-workers"]) {
		const step = setupNodeStep(jobName);
		assert.ok(step, `${jobName} must set up Node and pnpm`);
		assert.match(step.with["workspace-filters"], /campus-contracts\.\.\./u);
	}
	const cloudflareCredentialStep = releaseWorkflow.jobs["release-config"].steps.find(
		(step) => step.name === "Validate Cloudflare staging credentials",
	);
	assert.ok(cloudflareCredentialStep, "release-config must validate Cloudflare credentials early");
	assert.match(
		cloudflareCredentialStep.env.RELEASE_WORKERS,
		/^\$\{\{ needs\.release-plan\.outputs\.workers \}\}$/u,
	);
	assert.match(cloudflareCredentialStep.run, /pnpm --dir "\$worker_app" exec tsx/u);
	assert.match(cloudflareCredentialStep.run, /if jq -e 'index\("app-api"\) != null'/u);
	assert.match(cloudflareCredentialStep.run, /elif jq -e 'index\("campus-web"\) != null'/u);
	assert.match(
		cloudflareCredentialStep.run,
		/\.\.\/\.\.\/scripts\/deploy\/run-wrangler-command\.ts/u,
	);
	assert.doesNotMatch(cloudflareCredentialStep.run, /pnpm exec tsx/u);
	assert.match(cloudflareCredentialStep.run, /--account ["']?\$CLOUDFLARE_ACCOUNT_ID/u);
	assert.match(releaseSource, /\.unresolved \| length == 0/u);
	assert.match(releaseSource, /scripts\/ci\/publish-images\.sh/u);
	assert.match(publishImages, /--cache-to .*ignore-error=true/u);
	assert.match(opsWebDockerfile, /check-ops-web-artifact\.mjs \/opt\/ops-web/u);
	assert.match(ciSurfaces, /"apps\/ops-web\/Dockerfile"/u);
	assert.match(releaseSource, /name: campus-agent-release-\$\{\{ github\.run_id \}\}/u);
	assert.match(releaseSource, /keep-state: false/u);
	assert.match(releaseSource, /cleanup: true/u);
	assert.doesNotMatch(releaseSource, /name: campus-agent-release\s*$/mu);
	assert.match(releaseSource, /github\.ref == 'refs\/heads\/main'/u);
});

test("supports a bounded failed release replay", () => {
	const input = releaseWorkflow.on.workflow_dispatch.inputs.replay_base_sha;
	assert.equal(input.required, false);
	assert.equal(input.type, "string");
	assert.match(releaseSource, /\^\[0-9a-f\]\{40\}\$/u);
	assert.match(releaseSource, /git cat-file -e "\$\{REPLAY_BASE_SHA\}\^\{commit\}"/u);
	assert.match(releaseSource, /git merge-base --is-ancestor "\$REPLAY_BASE_SHA" "\$HEAD_SHA"/u);
	assert.match(
		releaseSource,
		/scripts\/ci\/write-change-plan\.sh "\$REPLAY_BASE_SHA" "\$HEAD_SHA"/u,
	);
	assert.match(releaseSource, /Release replay cannot run in validation-only mode/u);
});

test("retains selected Worker release validation", () => {
	assert.match(releaseSource, /worker-staging-app-api/u);
	assert.match(releaseSource, /worker-staging-campus-web/u);
	assert.match(releaseSource, /CAMPUS_WEB_SELECTED/u);
	assert.match(releaseSource, /docs-reader-release\.json/u);
});

test("bounds auxiliary workflows", () => {
	assert.equal(diningWorkflow.jobs.build["timeout-minutes"], 45);
	assert.equal(scorecardWorkflow.jobs.analysis["timeout-minutes"], 15);
	assert.equal(scorecardWorkflow.concurrency.group, "scorecard");
	assert.equal(diningSource.match(/docker\/build-push-action@/gu)?.length, 1);
});

test("uses Turbo affected tasks instead of planner package cohorts", () => {
	assert.match(runAffected, /turbo run typecheck test --affected/u);
	assert.match(runAffected, /turbo run test:worker build:worker build:app --affected/u);
	assert.match(runAffected, /has_worker_release/u);
	assert.match(runAffected, /check-worker-secret-presence\.ts --self-test/u);
	assert.match(runAffected, /worker-version\.self-test\.ts/u);
	assert.doesNotMatch(
		runAffected,
		/\.verification\.(?:nodeFilters|ingestFilters|evalFilters|workerFilters)/u,
	);
	assert.doesNotMatch(packageJson, /--filter=!eval-langfuse|--filter=!ingest-core/u);
});

test("documents the current Actionlint schema exception narrowly", () => {
	assert.match(actionlintConfig, /execution-runtime-publish\.yml/u);
	assert.match(actionlintConfig, /unexpected key "queue"/u);
});

test("uses the repository OSV installer from every scan entry point", () => {
	assert.match(osvScan, /scripts\/ci\/osv-scanner\.sh/u);
	assert.doesNotMatch(osvScan, /command -v osv-scanner/u);
	assert.match(read(".github/actions/run-osv-scan/action.yml"), /scripts\/ci\/osv-scan\.sh/u);
});
