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

test("pull request validation keeps one hosted planner and one stable heavy check", async () => {
	const source = await readFile(path.join(REPOSITORY_ROOT, ".github/workflows/pr.yml"), "utf8");
	const document = parseAllDocuments(source)[0];
	assert(document);
	const workflow = document.toJS() as { jobs?: Record<string, unknown> };
	assert.deepEqual(Object.keys(workflow.jobs ?? {}).sort(), ["light", "repo-checks"]);
	assert.match(source, /light:\n\s+runs-on: ubuntu-24\.04/u);
	assert.match(
		source,
		/repo-checks:\n[\s\S]*runs-on: \[self-hosted, Linux, ARM64, campus-agent-release\]/u,
	);
	assert(!source.includes("pull_request.head.sha }}\n          ref:"));
	assert.equal(source.match(/TURBO_TOKEN:/gu)?.length, 1);
});

test("Source diff consumers retain credentials for partial-clone object fetches", async () => {
	const workflowRoot = path.join(REPOSITORY_ROOT, ".github/workflows");
	const [publishSource, pullRequestSource] = await Promise.all([
		readFile(path.join(workflowRoot, "execution-runtime-publish.yml"), "utf8"),
		readFile(path.join(workflowRoot, "pr.yml"), "utf8"),
	]);
	const publishWorkflow = parseAllDocuments(publishSource)[0]?.toJS();
	const pullRequestWorkflow = parseAllDocuments(pullRequestSource)[0]?.toJS();
	for (const [workflow, jobName] of [
		[publishWorkflow, "release-plan"],
		[publishWorkflow, "candidate-evidence"],
		[pullRequestWorkflow, "repo-checks"],
	] as const) {
		const checkouts = sourceCheckouts(workflow, jobName);
		assert.equal(checkouts.length, 1, `${jobName} must have one Source checkout`);
		const checkout = checkouts[0];
		assert(checkout);
		assert(isObject(checkout.with));
		assert.equal(checkout.with["fetch-depth"], 0, jobName);
		assert.equal(checkout.with.filter, "blob:none", jobName);
		assert.equal(checkout.with["persist-credentials"], true, jobName);
	}
});

test("source workflows use Nix and do not restore retired setup entrypoints", async () => {
	const workflowRoot = path.join(REPOSITORY_ROOT, ".github/workflows");
	const sources = await Promise.all(
		["dependencies.yml", "execution-runtime-publish.yml", "pr.yml"].map((workflow) =>
			readFile(path.join(workflowRoot, workflow), "utf8"),
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
	]) {
		assert(!joined.includes(retired), retired);
	}
	assert(joined.includes("cachix/install-nix-action@630ae543ea3a38a9a4166f03376c02c50f408342"));
	assert(joined.includes("nix develop .#ci-light"));
	assert(joined.includes("nix develop .#ci-full"));
	assert(joined.includes("nix develop ./gitops#ci-infra"));
	const dependencies = sources[0];
	assert(dependencies);
	assert(dependencies.includes("nix develop .#ci-light"));
	assert(!dependencies.includes("nix develop .#ci-full"));
});

test("manual evidence exposes one explicit profile and no aggregate full mode", async () => {
	const source = await readFile(
		path.join(REPOSITORY_ROOT, ".github/workflows/manual-evidence.yml"),
		"utf8",
	);
	assert.match(source, /type: choice\n/u);
	assert(!source.includes("- all"));
	assert(!source.includes("- full"));
	assert(source.includes(`VALIDATION_PROFILES: '["\${{ inputs.profile }}"]'`));
});

test("non-trusted Turbo lanes use the supported read-only cache mode", async () => {
	const workflowRoot = path.join(REPOSITORY_ROOT, ".github/workflows");
	const [pullRequest, manual, publish] = await Promise.all(
		["pr.yml", "manual-evidence.yml", "execution-runtime-publish.yml"].map((workflow) =>
			readFile(path.join(workflowRoot, workflow), "utf8"),
		),
	);
	for (const source of [pullRequest, manual]) {
		assert.match(source, /TURBO_CACHE: "local:rw,remote:r"/u);
		assert(!source.includes("TURBO_REMOTE_CACHE_READ_ONLY"));
	}
	assert.match(publish, /TURBO_CACHE: "local:rw,remote:rw"/u);
});

test("candidate publishing keeps the Stage A object-store and docs refresh contracts", async () => {
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
	const objectStore = campusWeb.steps.find(
		(step) => isObject(step) && step.name === "Resolve object store endpoint",
	);
	assert(isObject(objectStore));
	assert.equal(typeof objectStore.run, "string");
	assert(objectStore.run.includes("kubectl --context default --namespace campus-agent-staging"));
	assert(objectStore.run.includes("get service object-store"));

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
			step.env.OBJECT_STORE_DERIVED_ACCESS_KEY,
			githubExpression("secrets.OBJECT_STORE_DERIVED_ACCESS_KEY"),
		);
		assert.equal(
			step.env.OBJECT_STORE_DERIVED_SECRET_KEY,
			githubExpression("secrets.OBJECT_STORE_DERIVED_SECRET_KEY"),
		);
		assert.equal(
			step.env.OBJECT_STORE_ENDPOINT,
			githubExpression("steps.object-store.outputs.endpoint"),
		);
		assert.equal(step.env.OBJECT_STORE_DERIVED_READ_ACCESS_KEY, undefined);
		assert.equal(step.env.OBJECT_STORE_DERIVED_READ_SECRET_KEY, undefined);
	}
});
