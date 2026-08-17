import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { parseAllDocuments } from "yaml";

import { WORKER_CANDIDATES } from "../release/workers.mts";
import { MANUAL_VALIDATION_PROFILES } from "./validation-profiles.mts";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");
const ENVIRONMENT_PREFIXED_CONFIG = /\b(?:STAGING|DEV|DEVELOPMENT|PROD|PRODUCTION)_[A-Z0-9_]+\b/u;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function githubExpression(expression: string): string {
	return ["$", "{{ ", expression, " }}"].join("");
}

async function loadWorkflow(name: string): Promise<Record<string, unknown>> {
	const source = await readFile(path.join(REPOSITORY_ROOT, ".github/workflows", name), "utf8");
	const documents = parseAllDocuments(source);
	if (documents.length !== 1) {
		throw new Error(`${name} must contain one YAML document`);
	}
	const document = documents[0];
	if (!document) {
		throw new Error(`${name} must contain one YAML document`);
	}
	if (document.errors.length > 0) {
		throw new Error(`${name} must be valid YAML: ${document.errors.join("; ")}`);
	}
	const workflow = document.toJS();
	if (!isObject(workflow)) {
		throw new Error(`${name} must contain a workflow object`);
	}
	return workflow;
}

function workflowJobs(workflow: Record<string, unknown>): Record<string, unknown> {
	if (!isObject(workflow.jobs)) {
		throw new Error("workflow must declare jobs");
	}
	return workflow.jobs;
}

function workflowJob(workflow: Record<string, unknown>, name: string): Record<string, unknown> {
	const job = workflowJobs(workflow)[name];
	if (!isObject(job)) {
		throw new Error(`missing workflow job: ${name}`);
	}
	return job;
}

function jobSteps(job: Record<string, unknown>): Record<string, unknown>[] {
	if (!Array.isArray(job.steps)) {
		throw new Error("workflow job must declare steps");
	}
	return job.steps.filter(isObject);
}

function namedStep(job: Record<string, unknown>, name: string): Record<string, unknown> {
	const step = jobSteps(job).find((candidate) => candidate.name === name);
	if (!step) {
		throw new Error(`missing workflow step: ${name}`);
	}
	return step;
}

function sourceCheckouts(
	workflow: Record<string, unknown>,
	jobName: string,
): Record<string, unknown>[] {
	return jobSteps(workflowJob(workflow, jobName)).filter(
		(step) =>
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

function workerCandidatesInExpression(value: unknown): string[] {
	if (typeof value !== "string") {
		return [];
	}
	return [
		...value.matchAll(/contains\(fromJSON\(needs\.release-plan\.outputs\.workers\), '([^']+)'\)/gu),
	]
		.map((match) => match[1])
		.filter((candidate): candidate is string => candidate !== undefined);
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
	for (const workflowName of workflows) {
		const source = await readFile(path.join(workflowRoot, workflowName), "utf8");
		for (const document of parseAllDocuments(source)) {
			assert.deepEqual(document.errors, [], `${workflowName} must be valid YAML`);
			failures.push(...environmentPrefixedConfig(document.toJS(), workflowName));
		}
	}
	assert.deepEqual(failures, []);
});

test("pull request validation keeps one bounded hosted gate", async () => {
	const workflow = await loadWorkflow("pr.yml");
	assert.deepEqual(workflow.permissions, { contents: "read", "pull-requests": "read" });
	assert.deepEqual(workflow.concurrency, {
		"cancel-in-progress": true,
		group: `${githubExpression("github.workflow")}-${githubExpression(
			"github.event.pull_request.number || github.ref",
		)}`,
	});
	assert(isObject(workflow.on));
	assert(isObject(workflow.on.pull_request));
	assert.deepEqual(workflow.on.pull_request.types, [
		"opened",
		"reopened",
		"synchronize",
		"ready_for_review",
	]);
	assert.deepEqual(Object.keys(workflowJobs(workflow)), ["repo-checks"]);

	const repoChecks = workflowJob(workflow, "repo-checks");
	assert.equal(repoChecks.if, "github.event.pull_request.draft == false");
	assert.equal(repoChecks["runs-on"], "ubuntu-24.04");
	assert.equal(repoChecks["timeout-minutes"], 30);
	assert.equal(namedStep(repoChecks, "Run repository checks").run, "pnpm check");
	assert.equal(
		namedStep(repoChecks, "Run affected Node evidence").if,
		"steps.plan.outputs.has_affected_node == 'true'",
	);
	assert.equal(
		namedStep(repoChecks, "Run toolchain evidence").if,
		"steps.plan.outputs.has_toolchain == 'true'",
	);
});

test("Source diff consumers check out complete immutable history", async () => {
	for (const [workflowName, jobName] of [
		["pr.yml", "repo-checks"],
		["execution-runtime-publish.yml", "release-plan"],
	] as const) {
		const workflow = await loadWorkflow(workflowName);
		const checkouts = sourceCheckouts(workflow, jobName);
		assert.equal(checkouts.length, 1, `${jobName} must have one Source checkout`);
		const checkout = checkouts[0];
		assert(checkout);
		assert(isObject(checkout.with));
		assert.equal(checkout.with["fetch-depth"], 0);
		assert.equal(checkout.with["persist-credentials"], false);
		assert.equal(checkout.with.filter, undefined);
	}
});

test("manual evidence derives its choices and dependencies from the profile registry", async () => {
	const workflow = await loadWorkflow("manual-evidence.yml");
	assert.deepEqual(workflow.permissions, { contents: "read" });
	assert.deepEqual(workflow.concurrency, {
		"cancel-in-progress": true,
		group: `manual-validation-${githubExpression("github.ref")}-${githubExpression("inputs.profile")}`,
	});
	assert(isObject(workflow.on));
	assert(isObject(workflow.on.workflow_dispatch));
	assert(isObject(workflow.on.workflow_dispatch.inputs));
	const profile = workflow.on.workflow_dispatch.inputs.profile;
	assert(isObject(profile));
	assert.equal(profile.type, "choice");
	assert.deepEqual(profile.options, MANUAL_VALIDATION_PROFILES);

	const evidence = workflowJob(workflow, "evidence");
	assert.equal(evidence["runs-on"], "ubuntu-24.04");
	assert.equal(evidence["timeout-minutes"], 90);
	assert.equal(namedStep(evidence, "Resolve profile requirements").id, "profile");
	assert.equal(
		namedStep(evidence, "Install evaluation dependencies").if,
		"steps.profile.outputs.requires_uv == 'true'",
	);
	assert.equal(
		namedStep(evidence, "Verify Docker evidence dependency").if,
		"steps.profile.outputs.requires_docker == 'true'",
	);
	const selected = namedStep(evidence, "Run selected profile");
	assert(isObject(selected.env));
	assert.equal(selected.env.VALIDATION_PROFILES, `["${githubExpression("inputs.profile")}"]`);
});

test("scheduled dependency evidence has a bounded read-only lane", async () => {
	const workflow = await loadWorkflow("dependencies.yml");
	assert.deepEqual(workflow.permissions, { contents: "read" });
	assert.deepEqual(workflow.concurrency, { "cancel-in-progress": true, group: "dependencies" });
	const scan = workflowJob(workflow, "scan");
	assert.equal(scan["runs-on"], "ubuntu-24.04");
	assert.equal(scan["timeout-minutes"], 15);
});

test("candidate publication keeps permissions, runners, and job dependencies explicit", async () => {
	const workflow = await loadWorkflow("execution-runtime-publish.yml");
	assert.deepEqual(workflow.permissions, { contents: "read" });
	assert.deepEqual(workflow.concurrency, {
		"cancel-in-progress": false,
		group: "staging-candidate-publish",
	});

	const releasePlan = workflowJob(workflow, "release-plan");
	assert.equal(releasePlan["runs-on"], "ubuntu-24.04");
	assert.equal(releasePlan.environment, "staging");
	assert.deepEqual(releasePlan.permissions, { contents: "read", statuses: "write" });

	const publishImages = workflowJob(workflow, "publish-images");
	assert.equal(publishImages.needs, "release-plan");
	assert.equal(publishImages["runs-on"], "ubuntu-24.04-arm");
	assert.deepEqual(publishImages.permissions, { contents: "read", packages: "write" });

	const publishWorkers = workflowJob(workflow, "publish-workers");
	assert.equal(publishWorkers.needs, "release-plan");
	assert.equal(publishWorkers["runs-on"], "ubuntu-24.04");
	assert.equal(publishWorkers.environment, "staging");

	const candidateStatus = workflowJob(workflow, "candidate-status");
	assert.deepEqual(candidateStatus.needs, ["release-plan", "publish-images", "publish-workers"]);
	assert.equal(candidateStatus["runs-on"], "ubuntu-24.04");
	assert.deepEqual(candidateStatus.permissions, { contents: "read", statuses: "write" });
	assert.match(String(candidateStatus.if), /^always\(\)/u);

	const promote = workflowJob(workflow, "promote");
	assert.deepEqual(promote.needs, [
		"release-plan",
		"candidate-status",
		"publish-images",
		"publish-workers",
	]);
	assert.equal(promote["runs-on"], "ubuntu-24.04");
	assert.equal(promote.environment, "staging");
	assert.match(String(promote.if), /needs\.candidate-status\.outputs\.approved == 'true'/u);
	assert.match(String(promote.if), /github\.ref == 'refs\/heads\/main'/u);
	const installGitOpsTooling = namedStep(promote, "Install GitOps tooling");
	assert.equal(installGitOpsTooling.run, "pnpm --dir gitops install --frozen-lockfile");
	assert(!String(installGitOpsTooling.run).includes("--ignore-workspace"));
});

test("Worker publication matches the candidate registry and secret boundaries", async () => {
	const workflow = await loadWorkflow("execution-runtime-publish.yml");
	const workers = workflowJob(workflow, "publish-workers");
	const steps = jobSteps(workers);
	const install = namedStep(workers, "Install selected Worker workspaces");
	assert.equal(install.id, "install_workers");
	assert.match(String(install.run), /scripts\/release\/workers\.mts --workers "\$WORKERS"/u);

	const selectedWorkers = new Set(steps.flatMap((step) => workerCandidatesInExpression(step.if)));
	assert.deepEqual([...selectedWorkers].sort(), [...WORKER_CANDIDATES].sort());

	const outputWorkers = new Set(
		steps.flatMap((step) => {
			if (!isObject(step.env) || typeof step.env.WORKER_VERSION_OUTPUT !== "string") {
				return [];
			}
			const match = step.env.WORKER_VERSION_OUTPUT.match(/worker-candidates\/([^/]+)\.json$/u);
			return match?.[1] ? [match[1]] : [];
		}),
	);
	assert.deepEqual([...outputWorkers].sort(), [...WORKER_CANDIDATES].sort());

	const finalize = namedStep(workers, "Finalize Worker publication");
	assert.equal(finalize.if, "!cancelled()");
	assert(isObject(finalize.env));
	const finalizedWorkers = new Set(
		Object.values(finalize.env).flatMap(workerCandidatesInExpression),
	);
	assert.deepEqual([...finalizedWorkers].sort(), [...WORKER_CANDIDATES].sort());

	const artifact = steps.find(
		(step) => typeof step.uses === "string" && step.uses.startsWith("actions/upload-artifact@"),
	);
	assert(artifact);
	assert(isObject(artifact.with));
	assert.equal(artifact.with.name, "release-worker-candidates");
	assert.equal(artifact.with.path, "worker-candidates/*.json");
	assert.equal(artifact.with["if-no-files-found"], "error");

	const appApi = namedStep(workers, "Upload app-api candidate");
	assert(isObject(appApi.env));
	assert.equal(
		appApi.env.OBJECT_STORE_DERIVED_READ_ACCESS_KEY,
		githubExpression("secrets.OBJECT_STORE_DERIVED_READ_ACCESS_KEY"),
	);
	assert.equal(
		appApi.env.OBJECT_STORE_DERIVED_READ_SECRET_KEY,
		githubExpression("secrets.OBJECT_STORE_DERIVED_READ_SECRET_KEY"),
	);
	assert.equal(
		appApi.env.OBJECT_STORE_VPC_SERVICE_ID,
		githubExpression("vars.OBJECT_STORE_VPC_SERVICE_ID"),
	);

	const campusWeb = namedStep(workers, "Build Campus Web staging candidate");
	assert(isObject(campusWeb.env));
	assert.equal(
		campusWeb.env.OBJECT_STORE_DERIVED_READ_ACCESS_KEY,
		githubExpression("secrets.OBJECT_STORE_DERIVED_READ_ACCESS_KEY"),
	);
	assert.equal(campusWeb.env.OBJECT_STORE_ENDPOINT, githubExpression("vars.OBJECT_STORE_ENDPOINT"));

	const statusWeb = namedStep(workers, "Upload status-web candidate");
	assert(isObject(statusWeb.env));
	assert.equal(
		statusWeb.env.CLOUDFLARE_API_TOKEN,
		githubExpression("secrets.CLOUDFLARE_API_TOKEN"),
	);
	assert.equal(statusWeb.env.STATUS_SNAPSHOT_KV_ID, githubExpression("vars.STATUS_SNAPSHOT_KV_ID"));
});
