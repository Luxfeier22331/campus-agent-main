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
