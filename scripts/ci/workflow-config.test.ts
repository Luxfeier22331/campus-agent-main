import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseAllDocuments } from "yaml";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENVIRONMENT_PREFIXED_CONFIG = /\b(?:STAGING|DEV|DEVELOPMENT|PROD|PRODUCTION)_[A-Z0-9_]+\b/u;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function githubExpression(expression: string): string {
	return ["$", "{{ ", expression, " }}"].join("");
}

function sourceCheckouts(workflow: unknown, jobName: string): Record<string, unknown>[] {
	if (!(isObject(workflow) && isObject(workflow.jobs))) {
		return [];
	}
	const job = workflow.jobs[jobName];
	if (!(isObject(job) && Array.isArray(job.steps))) {
		return [];
	}
	return job.steps.filter(
		(step) =>
			isObject(step) &&
			typeof step.uses === "string" &&
			step.uses.startsWith("actions/checkout@") &&
			isObject(step.with) &&
			step.with.repository === undefined,
	);
}

function jobShell(job: unknown): string | undefined {
	if (!(isObject(job) && isObject(job.defaults))) {
		return;
	}
	const run = job.defaults.run;
	if (!isObject(run)) {
		return;
	}
	return typeof run.shell === "string" ? run.shell : undefined;
}

function environmentPrefixedConfig(value: unknown, location = "workflow"): string[] {
	if (typeof value === "string") {
		const match = value.match(ENVIRONMENT_PREFIXED_CONFIG);
		return match ? [`${location}: ${match[0]}`] : [];
	}
	if (Array.isArray(value)) {
		return value.flatMap((entry, index) =>
			environmentPrefixedConfig(entry, `${location}[${index}]`),
		);
	}
	if (!isObject(value)) {
		return [];
	}
	return Object.entries(value).flatMap(([key, entry]) => [
		...(ENVIRONMENT_PREFIXED_CONFIG.test(key) ? [`${location}: ${key}`] : []),
		...environmentPrefixedConfig(entry, `${location}.${key}`),
	]);
}

test("environment-prefixed workflow configuration is rejected", () => {
	assert.deepEqual(
		environmentPrefixedConfig({
			jobs: {
				deploy: {
					env: { STAGING_TOKEN: "STAGING_TOKEN" },
					steps: [{ run: 'test -n "$DEV_DATABASE_URL"' }],
				},
			},
		}),
		[
			"workflow.jobs.deploy.env: STAGING_TOKEN",
			"workflow.jobs.deploy.env.STAGING_TOKEN: STAGING_TOKEN",
			"workflow.jobs.deploy.steps[0].run: DEV_DATABASE_URL",
		],
	);
});

test("GitHub workflows use environment-neutral configuration names", async () => {
	const workflowRoot = path.join(REPOSITORY_ROOT, ".github/workflows");
	const workflows = (await readdir(workflowRoot, { withFileTypes: true }))
		.filter(
			(entry) => entry.isFile() && (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")),
		)
		.map((entry) => entry.name)
		.sort();
	const failures: string[] = [];
	for (const workflow of workflows) {
		const source = await readFile(path.join(workflowRoot, workflow), "utf8");
		for (const document of parseAllDocuments(source)) {
			if (document.errors.length > 0) {
				throw new Error(`Invalid workflow YAML ${workflow}: ${document.errors.join("; ")}`);
			}
			failures.push(...environmentPrefixedConfig(document.toJS(), workflow));
		}
	}
	assert.deepEqual(failures, []);
});

test("pull request validation keeps one stable hosted check", async () => {
	const source = await readFile(path.join(REPOSITORY_ROOT, ".github/workflows/pr.yml"), "utf8");
	const document = parseAllDocuments(source)[0];
	assert(document);
	const workflow = document.toJS() as Record<string, unknown>;
	assert(isObject(workflow.on));
	assert(isObject(workflow.on.pull_request));
	assert.deepEqual(workflow.on.pull_request.types, [
		"opened",
		"reopened",
		"synchronize",
		"ready_for_review",
	]);
	assert(isObject(workflow.jobs));
	assert.deepEqual(Object.keys(workflow.jobs ?? {}).sort(), ["repo-checks"]);
	for (const jobName of ["repo-checks"]) {
		const job = workflow.jobs[jobName];
		assert(isObject(job));
		assert.equal(job.if, "github.event.pull_request.draft == false", jobName);
		assert.equal(job["runs-on"], "ubuntu-24.04", jobName);
	}
	assert(!source.includes("pull_request.head.sha }}\n          ref:"));
	assert.equal(source.match(/TURBO_TOKEN:/gu)?.length, 1);
	assert.equal(source.match(/TURBO_CACHE: "local:rw,remote:rw"/gu)?.length, 1);
	assert(source.includes("has_affected_node"));
	assert(source.includes("has_dependencies"));
	assert(source.includes("has_toolchain"));
	const repoChecks = workflow.jobs["repo-checks"];
	assert(isObject(repoChecks));
	assert(Array.isArray(repoChecks.steps));
	const planner = repoChecks.steps.find(
		(step) => isObject(step) && step.name === "Generate pull request validation plan",
	);
	assert(isObject(planner));
	assert.equal(typeof planner.run, "string");
	assert(planner.run.includes("jq -r --arg profile affected-node"));
	assert(planner.run.includes("index($profile) != null"));
	assert(planner.run.includes(".affectedPackages"));
	assert(planner.run.includes('echo "affected_packages=$affected_packages"'));
	assert(!planner.run.includes(String.raw`\"affected-node\"`));
	assert(!source.includes("browser"));
	const affectedInstall = repoChecks.steps.find(
		(step) => isObject(step) && step.name === "Install affected workspaces",
	);
	assert(isObject(affectedInstall));
	assert(isObject(affectedInstall.env));
	assert.equal(
		affectedInstall.env.AFFECTED_PACKAGES,
		githubExpression("steps.plan.outputs.affected_packages"),
	);
	assert.equal(typeof affectedInstall.run, "string");
	assert.match(affectedInstall.run, /filters\+=\(--filter "\$\{package\}\.\.\."\)/u);
	assert.match(affectedInstall.run, /pnpm install --frozen-lockfile "\$\{filters\[@\]\}"/u);
	const repositoryCheck = repoChecks.steps.find(
		(step) => isObject(step) && step.name === "Run repository checks",
	);
	assert(isObject(repositoryCheck));
	assert.equal(repositoryCheck.run, "pnpm check");
	assert(!source.includes("Check CI and release orchestration"));
});

test("Source diff consumers use complete history without promisor fetches", async () => {
	const workflowRoot = path.join(REPOSITORY_ROOT, ".github/workflows");
	const [publishSource, pullRequestSource] = await Promise.all([
		readFile(path.join(workflowRoot, "execution-runtime-publish.yml"), "utf8"),
		readFile(path.join(workflowRoot, "pr.yml"), "utf8"),
	]);
	const publishWorkflow = parseAllDocuments(publishSource)[0]?.toJS();
	const pullRequestWorkflow = parseAllDocuments(pullRequestSource)[0]?.toJS();
	for (const [workflow, jobName] of [
		[publishWorkflow, "release-plan"],
		[pullRequestWorkflow, "repo-checks"],
	] as const) {
		const checkouts = sourceCheckouts(workflow, jobName);
		assert.equal(checkouts.length, 1, `${jobName} must have one Source checkout`);
		const checkout = checkouts[0];
		assert(checkout);
		assert(isObject(checkout.with));
		assert.equal(checkout.with["fetch-depth"], 0, jobName);
		assert.equal(checkout.with.filter, undefined, jobName);
		assert.equal(checkout.with["persist-credentials"], false, jobName);
	}
});

test("source workflows use Nix on bounded GitHub-hosted release lanes", async () => {
	const workflowRoot = path.join(REPOSITORY_ROOT, ".github/workflows");
	const sources = await Promise.all(
		["dependencies.yml", "execution-runtime-publish.yml", "manual-evidence.yml", "pr.yml"].map(
			(workflow) => readFile(path.join(workflowRoot, workflow), "utf8"),
		),
	);
	const joined = sources.join("\n");
	for (const retired of [
		"aquaproj/aqua-installer",
		"astral-sh/setup-uv",
		"azure/setup-kubectl",
		"dorny/paths-filter",
		"pnpm/action-setup",
		"actions/setup-node",
		"./gitops/.github/actions/setup-policy-tools",
		"CI_DOCKER_CGROUP_PARENT",
		"candidate-evidence",
		"candidate-browser-evidence",
		"kubectl --context default --namespace campus-agent-staging",
		"self-hosted",
		"campus-agent-release",
		"/nix/var/nix/profiles/default/bin/nix",
	]) {
		assert(!joined.includes(retired), retired);
	}
	assert(joined.includes("cachix/install-nix-action@630ae543ea3a38a9a4166f03376c02c50f408342"));
	assert(joined.includes("nix develop .#ci-core"));
	assert(joined.includes("nix develop .#ci-light"));
	assert(joined.includes("nix develop .#ci-release"));
	assert(joined.includes("nix develop .#ci-full"));
	assert(joined.includes("nix develop ./gitops#ci-control"));
	assert(!joined.includes("nix develop ./gitops#ci-infra"));
	assert(!joined.includes("actions/cache@"));
	const dependencies = sources[0];
	assert(dependencies);
	assert(dependencies.includes("nix develop .#ci-light"));
	assert(dependencies.includes("run: scripts/dependencies/scan.sh"));
	assert(!dependencies.includes("nix develop .#ci-full"));
});

test("manual evidence exposes one hosted profile and no aggregate full mode", async () => {
	const source = await readFile(
		path.join(REPOSITORY_ROOT, ".github/workflows/manual-evidence.yml"),
		"utf8",
	);
	assert.match(source, /type: choice\n/u);
	assert(!source.includes("- all"));
	assert(!source.includes("- full"));
	assert(source.includes(`VALIDATION_PROFILES: '["\${{ inputs.profile }}"]'`));
	assert(!source.includes("browser"));
	assert.match(source, /evidence:\n\s+runs-on: ubuntu-24\.04/u);
	assert.equal(source.match(/TURBO_CACHE: "local:rw,remote:rw"/gu)?.length, 1);
	for (const retired of ["- affected-node", "- dependencies", "- toolchain"]) {
		assert(!source.includes(retired), retired);
	}
});

test("Turbo cache configuration can write the remote cache", async () => {
	const workflowRoot = path.join(REPOSITORY_ROOT, ".github/workflows");
	const [pullRequest, manual] = await Promise.all(
		["pr.yml", "manual-evidence.yml"].map((workflow) =>
			readFile(path.join(workflowRoot, workflow), "utf8"),
		),
	);
	for (const source of [pullRequest, manual]) {
		assert.match(source, /TURBO_CACHE: "local:rw,remote:rw"/u);
		assert.match(source, /TURBO_TOKEN:/u);
		assert(!source.includes("TURBO_REMOTE_CACHE_READ_ONLY"));
	}
});

test("candidate publishing uses GitHub-hosted runners before final status", async () => {
	const source = await readFile(
		path.join(REPOSITORY_ROOT, ".github/workflows/execution-runtime-publish.yml"),
		"utf8",
	);
	const workflow = parseAllDocuments(source)[0]?.toJS();
	assert(isObject(workflow));
	assert(isObject(workflow.on));
	assert(isObject(workflow.on.workflow_dispatch));
	assert(isObject(workflow.on.workflow_dispatch.inputs));
	const candidateScope = workflow.on.workflow_dispatch.inputs.candidate_scope;
	assert(isObject(candidateScope));
	assert.equal(candidateScope.type, "choice");
	assert.equal(candidateScope.default, "affected");
	assert.deepEqual(candidateScope.options, ["affected", "campus-web-docs"]);
	assert.equal(workflow.on.workflow_dispatch.inputs.validate_only, undefined);

	assert(isObject(workflow.jobs));
	for (const jobName of [
		"candidate-status",
		"promote",
		"publish-images",
		"publish-workers",
		"release-plan",
	]) {
		assert(isObject(workflow.jobs[jobName]), jobName);
	}
	for (const retired of ["publish-app-api", "publish-campus-web", "publish-status-web"]) {
		assert.equal(workflow.jobs[retired], undefined, retired);
	}
	assert(isObject(workflow.concurrency));
	assert.equal(workflow.concurrency["cancel-in-progress"], false);
	const releasePlan = workflow.jobs["release-plan"];
	assert(isObject(releasePlan));
	assert(Array.isArray(releasePlan.steps));
	const planner = releasePlan.steps.find(
		(step) => isObject(step) && step.name === "Select release candidates",
	);
	assert(isObject(planner));
	assert(isObject(planner.env));
	assert.equal(
		planner.env.REFRESH_CAMPUS_WEB_DOCS,
		githubExpression(
			"github.event_name == 'workflow_dispatch' && inputs.candidate_scope == 'campus-web-docs' || false",
		),
	);
	assert.equal(typeof planner.run, "string");
	assert(planner.run.includes('--refresh-campus-web-docs "$REFRESH_CAMPUS_WEB_DOCS"'));
	assert(!planner.run.includes("validate-only"));
	assert(!planner.run.includes("worker-selection"));
	assert(!planner.run.includes("browserProfiles"));
	assert(!planner.run.includes("selfHostedProfiles"));
	const verifyCurrentMain = releasePlan.steps.find(
		(step) => isObject(step) && step.name === "Verify current main revision",
	);
	assert(isObject(verifyCurrentMain));
	assert.equal(typeof verifyCurrentMain.run, "string");
	assert(verifyCurrentMain.run.includes('commits/main" --jq .sha'));
	assert(verifyCurrentMain.run.includes('[[ "$GITHUB_SHA" != "$current_main" ]]'));
	const pending = releasePlan.steps.find(
		(step) => isObject(step) && step.name === "Mark staging candidate pending",
	);
	assert(isObject(pending));
	assert.match(String(pending.if), /steps\.plan\.outputs\.images != '\[\]'/u);
	const emptySuccess = releasePlan.steps.find(
		(step) => isObject(step) && step.name === "Mark empty staging candidate success",
	);
	assert(isObject(emptySuccess));
	assert.match(String(emptySuccess.if), /steps\.plan\.outputs\.kubernetes == 'false'/u);

	for (const jobName of ["publish-images", "publish-workers", "candidate-status", "promote"]) {
		const job = workflow.jobs[jobName];
		assert(isObject(job));
		assert.match(String(job["runs-on"]), /^ubuntu-24\.04/u, jobName);
	}
	for (const jobName of ["publish-images", "publish-workers"]) {
		const job = workflow.jobs[jobName];
		assert(isObject(job));
		assert.equal(job.needs, "release-plan", jobName);
	}
	for (const jobName of ["publish-images", "publish-workers", "promote"]) {
		const job = workflow.jobs[jobName];
		assert(isObject(job));
		assert(Array.isArray(job.steps));
		const installNix = job.steps.find((step) => isObject(step) && step.name === "Install Nix");
		assert(isObject(installNix));
		assert.equal(
			installNix.uses,
			"cachix/install-nix-action@630ae543ea3a38a9a4166f03376c02c50f408342",
		);
		assert(isObject(installNix.with));
		assert.equal(installNix.with.install_url, "https://releases.nixos.org/nix/nix-2.35.1/install");
		assert.equal(installNix.with.enable_kvm, false);
	}
	const publishImages = workflow.jobs["publish-images"];
	assert(isObject(publishImages));
	assert(Array.isArray(publishImages.steps));
	const buildxIndex = publishImages.steps.findIndex(
		(step) => isObject(step) && step.name === "Setup Docker Buildx",
	);
	assert(buildxIndex >= 0);
	assert(
		!publishImages.steps.some(
			(step) =>
				isObject(step) && step.name === "Initialize release toolchain and record runner facts",
		),
	);
	const buildx = publishImages.steps[buildxIndex];
	assert(isObject(buildx));
	assert(isObject(buildx.with));
	assert.deepEqual(buildx.with, { "cache-binary": false });
	const publishStep = publishImages.steps.find(
		(step) => isObject(step) && step.name === "Build, publish and scan images",
	);
	assert(isObject(publishStep));
	assert(isObject(publishStep.env));
	assert.equal(publishStep.env.BUILDKIT_PROGRESS, undefined);
	assert.equal(typeof publishStep.run, "string");
	assert(publishStep.run.includes('--summary "$GITHUB_STEP_SUMMARY"'));
	const verifyImageMain = publishImages.steps.find(
		(step) =>
			isObject(step) && step.name === "Verify current main revision before image publication",
	);
	assert(isObject(verifyImageMain));
	assert.equal(typeof verifyImageMain.run, "string");
	assert(verifyImageMain.run.includes('commits/main" --jq .sha'));
	assert(verifyImageMain.run.includes('[[ "$GITHUB_SHA" != "$current_main" ]]'));
	assert(
		publishImages.steps.indexOf(verifyImageMain) < buildxIndex,
		"stale image runs must stop before Buildx setup",
	);
	const candidateStatus = workflow.jobs["candidate-status"];
	assert(isObject(candidateStatus));
	assert.deepEqual(candidateStatus.needs, ["release-plan", "publish-images", "publish-workers"]);
	assert.match(String(candidateStatus.if), /always\(\)/u);
	assert.match(String(candidateStatus.if), /needs\.release-plan\.result != 'success'/u);
	assert.match(String(candidateStatus.if), /needs\.release-plan\.outputs\.images != '\[\]'/u);
	assert(Array.isArray(candidateStatus.steps));
	const statusStep = candidateStatus.steps.find(
		(step) => isObject(step) && step.name === "Finalize staging candidate status",
	);
	assert(isObject(statusStep));
	assert.equal(typeof statusStep.run, "string");
	assert(isObject(statusStep.env));
	assert.equal(statusStep.env.WORKER_RESULT, githubExpression("needs.publish-workers.result"));
	assert.equal(statusStep.env.APP_API_RESULT, undefined);
	assert(
		statusStep.run.includes("Selected artifacts were built and published; images were scanned"),
	);
	assert(
		statusStep.run.indexOf("gh api --method POST") <
			statusStep.run.indexOf('echo "approved=$approved"'),
	);
	assert(!statusStep.run.includes("VALIDATE_ONLY"));
	const promote = workflow.jobs.promote;
	assert(isObject(promote));
	assert(Array.isArray(promote.needs));
	assert(promote.needs.includes("candidate-status"));
	assert.match(String(promote.if), /!cancelled\(\)/u);
	assert.match(String(promote.if), /needs\.candidate-status\.result == 'success'/u);
	assert(Array.isArray(promote.steps));
	const prepareReleaseInputs = promote.steps.find(
		(step) => isObject(step) && step.name === "Prepare release inputs",
	);
	assert(isObject(prepareReleaseInputs));
	assert.equal(prepareReleaseInputs.shell, "bash -e {0}");
	assert.equal(
		prepareReleaseInputs.run,
		"printf '{}\\n' > image-digests.json\nmkdir -p worker-candidates\n",
	);
	const installGitOpsTooling = promote.steps.find(
		(step) => isObject(step) && step.name === "Install GitOps tooling",
	);
	assert(isObject(installGitOpsTooling));
	assert.equal(
		installGitOpsTooling.run,
		"pnpm --dir gitops --ignore-workspace install --frozen-lockfile",
	);
	const verifyPromotionMain = promote.steps.find(
		(step) => isObject(step) && step.name === "Verify current main revision before promotion",
	);
	assert(isObject(verifyPromotionMain));
	assert.equal(verifyPromotionMain.shell, "nix develop .#ci-core --command bash -e {0}");
	assert.equal(typeof verifyPromotionMain.run, "string");
	assert(verifyPromotionMain.run.includes('commits/main" --jq .sha'));
	assert(verifyPromotionMain.run.includes('[[ "$GITHUB_SHA" != "$current_main" ]]'));
	assert(
		promote.steps.indexOf(verifyPromotionMain) < promote.steps.indexOf(prepareReleaseInputs),
		"stale promotion runs must stop before preparing or downloading release inputs",
	);
	for (const stepName of [
		"Install GitOps tooling",
		"Update GitOps desired state",
		"Detect GitOps changes",
		"Mark staging promotion pending",
	]) {
		const step = promote.steps.find(
			(candidate) => isObject(candidate) && candidate.name === stepName,
		);
		assert(isObject(step));
		assert.equal(step.shell, "nix develop ./gitops#ci-control --command bash -e {0}");
	}
	assert.equal(
		promote.steps.find((step) => isObject(step) && step.name === "Render promoted GitOps state"),
		undefined,
	);
	const deploymentPullRequest = promote.steps.find(
		(step) => isObject(step) && step.name === "Open GitOps deployment pull request",
	);
	assert(isObject(deploymentPullRequest));
	assert(isObject(deploymentPullRequest.with));
	assert.match(
		String(deploymentPullRequest.with.body),
		/\[ \] GitOps PR 的完整仓库与受影响 Kustomize、schema、策略、Terraform\/Helm 检查/u,
	);
	const profileShells = new Map<string, string | undefined>([
		["release-plan", jobShell(releasePlan)],
		["publish-images", jobShell(workflow.jobs["publish-images"])],
		["publish-workers", jobShell(workflow.jobs["publish-workers"])],
	]);
	assert.equal(profileShells.get("release-plan"), "nix develop .#ci-core --command bash -e {0}");
	assert.equal(
		profileShells.get("publish-images"),
		"nix develop .#ci-release --command bash -e {0}",
	);
	assert.equal(profileShells.get("publish-workers"), "nix develop .#ci-core --command bash -e {0}");
	assert(!source.includes("npm_config_store_dir"));
	assert(!source.includes("--prefer-offline"));
	assert(source.includes(`--trivy-cache "\${RUNNER_TOOL_CACHE}/trivy"`));
	assert(!source.includes(`--trivy-cache "\${RUNNER_TEMP}/trivy"`));
	assert(!source.includes("validate-ops-web-promotion"));
	assert(!source.includes('index("clusters/staging/overlays/ops-web")'));

	const workers = workflow.jobs["publish-workers"];
	assert(isObject(workers));
	assert.equal(workers["timeout-minutes"], 30);
	assert.equal(workers.env, undefined);
	assert(Array.isArray(workers.steps));
	assert(
		workers.steps.some(
			(step) => isObject(step) && step.name === "Install selected Worker workspaces",
		),
	);
	const workerInstall = workers.steps.find(
		(step) => isObject(step) && step.name === "Install selected Worker workspaces",
	);
	assert(isObject(workerInstall));
	assert.equal(typeof workerInstall.run, "string");
	assert(workerInstall.run.includes("campus-contracts..."));
	assert.match(workerInstall.run, /campus-web-staging\)\n\s+add_filter 'campus-contracts\.\.\.'/u);
	assert(workerInstall.run.includes("Unsupported Worker candidate"));
	assert.equal(workerInstall.id, "install_workers");
	const verifyWorkerMain = workers.steps.find(
		(step) =>
			isObject(step) && step.name === "Verify current main revision before Worker publication",
	);
	assert(isObject(verifyWorkerMain));
	assert.equal(typeof verifyWorkerMain.run, "string");
	assert(verifyWorkerMain.run.includes('commits/main" --jq .sha'));
	assert(verifyWorkerMain.run.includes('[[ "$GITHUB_SHA" != "$current_main" ]]'));
	assert(
		workers.steps.indexOf(verifyWorkerMain) < workers.steps.indexOf(workerInstall),
		"stale Worker runs must stop before dependency installation",
	);
	for (const stepName of [
		"Upload app-api candidate",
		"Build Campus Web staging candidate",
		"Upload Campus Web candidate",
		"Upload status-web candidate",
		"Validate selected Worker candidates",
		"Finalize Worker publication",
	]) {
		assert(
			workers.steps.some((step) => isObject(step) && step.name === stepName),
			stepName,
		);
	}
	const artifact = workers.steps.find(
		(step) => isObject(step) && String(step.uses).startsWith("actions/upload-artifact@"),
	);
	assert(isObject(artifact));
	assert.equal(artifact.with?.name, "release-worker-candidates");
	assert.equal(artifact.with?.path, "worker-candidates/*.json");
	assert.equal(artifact.with?.["if-no-files-found"], "error");
	assert.equal(artifact.if, "!cancelled()");
	const appApiUpload = workers.steps.find(
		(step) => isObject(step) && step.name === "Upload app-api candidate",
	);
	assert(isObject(appApiUpload));
	assert.match(String(appApiUpload.if), /steps\.install_workers\.outcome == 'success'/u);
	assert(isObject(appApiUpload.env));
	assert.equal(
		appApiUpload.env.OBJECT_STORE_VPC_SERVICE_ID,
		githubExpression("vars.OBJECT_STORE_VPC_SERVICE_ID"),
	);
	const statusUpload = workers.steps.find(
		(step) => isObject(step) && step.name === "Upload status-web candidate",
	);
	assert(isObject(statusUpload));
	assert(isObject(statusUpload.env));
	assert.equal(
		statusUpload.env.CLOUDFLARE_API_TOKEN,
		githubExpression("secrets.CLOUDFLARE_API_TOKEN"),
	);
	assert.equal(
		statusUpload.env.STATUS_SNAPSHOT_KV_ID,
		githubExpression("vars.STATUS_SNAPSHOT_KV_ID"),
	);
	const campusBuild = workers.steps.find(
		(step) => isObject(step) && step.name === "Build Campus Web staging candidate",
	);
	assert(isObject(campusBuild));
	assert.match(String(campusBuild.if), /steps\.install_workers\.outcome == 'success'/u);
	assert(isObject(campusBuild.env));
	assert.equal(
		campusBuild.env.OBJECT_STORE_DERIVED_READ_ACCESS_KEY,
		githubExpression("secrets.OBJECT_STORE_DERIVED_READ_ACCESS_KEY"),
	);
	assert.equal(
		campusBuild.env.OBJECT_STORE_ENDPOINT,
		githubExpression("vars.OBJECT_STORE_ENDPOINT"),
	);
	const finalize = workers.steps.find(
		(step) => isObject(step) && step.name === "Finalize Worker publication",
	);
	assert(isObject(finalize));
	assert.equal(typeof finalize.run, "string");
	assert(finalize.run.includes("Worker workspace installation failed"));
	assert.equal(source.match(/always\(\)/gu)?.length, 1);
	assert(!source.includes("validate_only"));
	assert(!source.includes("preflight-staging.ts"));
});
