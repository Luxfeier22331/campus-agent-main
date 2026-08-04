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
		assert.equal(job["runs-on"], "ubuntu-24.04", jobName);
	}
	assert(!source.includes("pull_request.head.sha }}\n          ref:"));
	assert.equal(source.match(/TURBO_TOKEN:/gu)?.length, 1);
	assert.equal(source.match(/TURBO_CACHE: "local:rw,remote:r"/gu)?.length, 1);
	assert(source.includes("has_affected_node"));
	assert(source.includes("has_non_turbo"));
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
	assert(!planner.run.includes(String.raw`\"affected-node\"`));
	assert(!source.includes("browser"));
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

test("source workflows use Nix with a bounded transitional self-hosted release lane", async () => {
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
	]) {
		assert(!joined.includes(retired), retired);
	}
	assert(joined.includes("cachix/install-nix-action@630ae543ea3a38a9a4166f03376c02c50f408342"));
	assert(joined.includes("nix develop .#ci-light"));
	assert(joined.includes("nix develop .#ci-full"));
	assert(joined.includes("nix develop ./gitops#ci-infra"));
	assert(joined.includes("campus-agent-release"));
	assert(joined.includes("/nix/var/nix/profiles/default/bin/nix"));
	const dependencies = sources[0];
	assert(dependencies);
	assert(dependencies.includes("nix develop .#ci-light"));
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
	assert.equal(source.match(/TURBO_CACHE: "local:rw,remote:r"/gu)?.length, 1);
});

test("Turbo cache configuration is read-only outside local writes", async () => {
	const workflowRoot = path.join(REPOSITORY_ROOT, ".github/workflows");
	const [pullRequest, manual] = await Promise.all(
		["pr.yml", "manual-evidence.yml"].map((workflow) =>
			readFile(path.join(workflowRoot, workflow), "utf8"),
		),
	);
	for (const source of [pullRequest, manual]) {
		assert.match(source, /TURBO_CACHE: "local:rw,remote:r"/u);
		assert.match(source, /TURBO_TOKEN:/u);
		assert(!source.includes("TURBO_REMOTE_CACHE_READ_ONLY"));
	}
});

test("candidate publishing uses the transitional release runner before final status", async () => {
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

	assert(isObject(workflow.jobs));
	assert.deepEqual(Object.keys(workflow.jobs).sort(), [
		"candidate-status",
		"promote",
		"publish-app-api",
		"publish-campus-web",
		"publish-images",
		"release-plan",
	]);
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
	assert(planner.run.includes("Campus Web docs refresh cannot run in validation-only mode."));
	assert(!planner.run.includes("browserProfiles"));
	assert(!planner.run.includes("selfHostedProfiles"));
	const pending = releasePlan.steps.find(
		(step) => isObject(step) && step.name === "Mark staging candidate pending",
	);
	assert(isObject(pending));

	for (const [jobName, runner] of [
		["publish-images", ["self-hosted", "Linux", "ARM64", "campus-agent-release"]],
		["publish-app-api", "ubuntu-24.04"],
		["publish-campus-web", ["self-hosted", "Linux", "ARM64", "campus-agent-release"]],
		["candidate-status", "ubuntu-24.04"],
		["promote", ["self-hosted", "Linux", "ARM64", "campus-agent-release"]],
	] as const) {
		const job = workflow.jobs[jobName];
		assert(isObject(job));
		assert.deepEqual(job["runs-on"], runner, jobName);
	}
	for (const jobName of ["publish-images", "publish-app-api", "publish-campus-web"]) {
		const job = workflow.jobs[jobName];
		assert(isObject(job));
		assert.equal(job.needs, "release-plan", jobName);
	}
	const candidateStatus = workflow.jobs["candidate-status"];
	assert(isObject(candidateStatus));
	assert.deepEqual(candidateStatus.needs, [
		"release-plan",
		"publish-images",
		"publish-app-api",
		"publish-campus-web",
	]);
	assert(Array.isArray(candidateStatus.steps));
	const statusStep = candidateStatus.steps.find(
		(step) => isObject(step) && step.name === "Finalize staging candidate status",
	);
	assert(isObject(statusStep));
	assert.equal(typeof statusStep.run, "string");
	assert(
		statusStep.run.includes("Selected artifacts were built and published; images were scanned"),
	);
	const promote = workflow.jobs.promote;
	assert(isObject(promote));
	assert(Array.isArray(promote.needs));
	assert(promote.needs.includes("candidate-status"));

	const appApi = workflow.jobs["publish-app-api"];
	assert(isObject(appApi));
	assert(isObject(appApi.env));
	assert.equal(
		appApi.env.OBJECT_STORE_VPC_SERVICE_ID,
		githubExpression("vars.OBJECT_STORE_VPC_SERVICE_ID"),
	);

	const campusWeb = workflow.jobs["publish-campus-web"];
	assert(isObject(campusWeb));
	assert.equal(campusWeb.env, undefined);
	assert(Array.isArray(campusWeb.steps));
	const buildSteps = campusWeb.steps.filter(
		(step) =>
			isObject(step) &&
			(step.name === "Build Campus Web staging configuration" ||
				step.name === "Build Campus Web staging candidate"),
	);
	assert.equal(buildSteps.length, 2);
	for (const step of buildSteps) {
		assert(isObject(step));
		assert(isObject(step.env));
		assert.equal(
			step.env.OBJECT_STORE_DERIVED_READ_ACCESS_KEY,
			githubExpression("secrets.OBJECT_STORE_DERIVED_READ_ACCESS_KEY"),
		);
		assert.equal(
			step.env.OBJECT_STORE_DERIVED_READ_SECRET_KEY,
			githubExpression("secrets.OBJECT_STORE_DERIVED_READ_SECRET_KEY"),
		);
		assert.equal(step.env.OBJECT_STORE_DERIVED_ACCESS_KEY, undefined);
		assert.equal(step.env.OBJECT_STORE_DERIVED_SECRET_KEY, undefined);
		assert.equal(step.env.OBJECT_STORE_ENDPOINT, githubExpression("vars.OBJECT_STORE_ENDPOINT"));
	}
	assert.equal(
		campusWeb.steps.find((step) => isObject(step) && step.name === "Resolve object store endpoint"),
		undefined,
	);
});
