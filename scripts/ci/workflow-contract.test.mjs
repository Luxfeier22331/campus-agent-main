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
const docsPublishJob = parse(read("infra/k8s/docs-publish/base/job.yaml"));

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

test("guards release publication and isolates candidate surfaces", () => {
	assert.equal(releaseWorkflow.concurrency.queue, undefined);
	assert.match(releaseSource, /allowed only from main/u);
	assert.doesNotMatch(releaseSource, /pnpm ci:fast/u);
	assert.equal(releaseWorkflow.jobs["release-config"], undefined);
	for (const jobName of ["release-plan", "publish-app-api"]) {
		const step = setupNodeStep(jobName);
		assert.ok(step, `${jobName} must set up Node and pnpm`);
		assert.match(step.with["workspace-filters"], /campus-contracts\.\.\./u);
	}
	assert.match(releaseSource, /\.unresolved \| length == 0/u);
	assert.match(releaseSource, /scripts\/ci\/publish-images\.sh/u);
	assert.match(publishImages, /--cache-to .*ignore-error=true/u);
	assert.match(publishImages, /while IFS= read|JSON image list/u);
	assert.match(opsWebDockerfile, /check-ops-web-artifact\.mjs \/opt\/ops-web/u);
	assert.match(ciSurfaces, /"apps\/ops-web\/Dockerfile"/u);
	assert.match(releaseSource, /github\.ref == 'refs\/heads\/main'/u);
	const publishImagesJob = releaseWorkflow.jobs["publish-images"];
	assert.equal(publishImagesJob.needs, "release-plan");
	assert.deepEqual(publishImagesJob["runs-on"], [
		"self-hosted",
		"Linux",
		"ARM64",
		"campus-agent-release",
	]);
	const buildx = publishImagesJob.steps.find(
		(step) => step.name === "Setup persistent Docker Buildx",
	);
	assert.equal(buildx.with.name, "campus-agent-release");
	assert.equal(buildx.with["keep-state"], true);
	assert.equal(buildx.with.cleanup, false);
	assert.match(buildx.with["driver-opts"], /memory=2g/u);
	assert.match(buildx.with["driver-opts"], /memory-swap=2g/u);
	assert.match(buildx.with["driver-opts"], /cpu-quota=200000/u);
	assert.doesNotMatch(releaseSource, /campus-agent-release-\$\{\{ github\.run_id \}\}/u);
	assert.match(releaseSource, /keys == \(\$expected \| sort\)/u);
	for (const jobName of ["publish-images", "publish-app-api"]) {
		const upload = releaseWorkflow.jobs[jobName].steps.find(
			(step) => step.name === "Upload image digests" || step.name === "Upload Worker candidates",
		);
		assert.equal(upload.with["if-no-files-found"], "error");
		assert.equal(upload.with.overwrite, true);
	}
	assert.deepEqual(releaseWorkflow.jobs.promote.needs, [
		"release-plan",
		"publish-images",
		"publish-app-api",
	]);
	assert.match(releaseWorkflow.jobs.promote.if, /needs\.publish-images\.result == 'success'/u);
	assert.match(releaseWorkflow.jobs.promote.if, /needs\.publish-app-api\.result == 'success'/u);
	assert.match(releaseWorkflow.jobs.promote.if, /outputs\.kubernetes == 'true'/u);
	assert.doesNotMatch(releaseWorkflow.jobs.promote.if, /outputs\.images\)\[0\] == null/u);
	const downloadWorkerCandidates = releaseWorkflow.jobs.promote.steps.find(
		(step) => step.name === "Download Worker candidates",
	);
	assert.equal(downloadWorkerCandidates.if, "needs.publish-app-api.result == 'success'");
});

test("bounds the single-node release jobs", () => {
	assert.equal(releaseWorkflow.jobs["publish-images"]["timeout-minutes"], 15);
	assert.equal(releaseWorkflow.jobs["publish-app-api"]["timeout-minutes"], 5);
	assert.ok(releaseWorkflow.jobs["publish-images"]["timeout-minutes"] < 20);
});

test("keeps every staging release job on the dedicated runner", () => {
	for (const jobName of ["release-plan", "publish-images", "publish-app-api", "promote"]) {
		assert.deepEqual(releaseWorkflow.jobs[jobName]["runs-on"], [
			"self-hosted",
			"Linux",
			"ARM64",
			"campus-agent-release",
		]);
	}
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

test("keeps App API validation and upload in one candidate job", () => {
	const publishAppApi = releaseWorkflow.jobs["publish-app-api"];
	assert.equal(publishAppApi.needs, "release-plan");
	assert.equal(
		publishAppApi.if,
		"contains(fromJSON(needs.release-plan.outputs.workers), 'app-api')",
	);
	const validation = publishAppApi.steps.find(
		(step) => step.name === "Validate app-api staging configuration",
	);
	const appApiUpload = publishAppApi.steps.find((step) => step.name === "Upload app-api candidate");
	assert.equal(validation.if, "needs.release-plan.outputs.validate_only == 'true'");
	assert.match(validation.run, /apps\/app-api exec tsx \.\/scripts\/preflight-staging\.ts/u);
	assert.equal(appApiUpload.if, "needs.release-plan.outputs.validate_only != 'true'");
	assert.match(appApiUpload.run, /pnpm --dir apps\/app-api upload:staging/u);
});

test("freezes Campus Web candidate publication", () => {
	assert.deepEqual(Object.keys(releaseWorkflow.jobs), [
		"release-plan",
		"publish-images",
		"publish-app-api",
		"promote",
	]);
	assert.equal(releaseWorkflow.on.workflow_dispatch.inputs.docs_release_id, undefined);
	assert.match(releaseSource, /ALL_WORKERS/u);
	assert.doesNotMatch(
		releaseSource,
		/campus-web|DOCS_RELEASE_ID|OBJECT_STORE_|release-config|publish-workers|build:staging/iu,
	);
});

test("uses a numeric non-root identity for the docs publisher image", () => {
	const container = docsPublishJob.spec.template.spec.containers[0];
	assert.equal(container.securityContext.runAsNonRoot, true);
	assert.equal(container.securityContext.runAsUser, 1000);
	assert.equal(container.securityContext.runAsGroup, 1000);
});

test("bounds auxiliary workflows", () => {
	assert.equal(scorecardWorkflow.jobs.analysis["timeout-minutes"], 15);
	assert.equal(scorecardWorkflow.concurrency.group, "scorecard");
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

test("does not hide workflow schema errors from Actionlint", () => {
	assert.doesNotMatch(actionlintConfig, /paths:|ignore:/u);
});

test("uses the repository OSV installer from every scan entry point", () => {
	assert.match(osvScan, /scripts\/ci\/osv-scanner\.sh/u);
	assert.doesNotMatch(osvScan, /command -v osv-scanner/u);
	assert.match(read(".github/actions/run-osv-scan/action.yml"), /scripts\/ci\/osv-scan\.sh/u);
});
