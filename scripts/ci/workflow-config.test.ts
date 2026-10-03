import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { parseAllDocuments } from "yaml";

import { WORKER_CANDIDATES } from "../release/workers.mts";
import { MANUAL_VALIDATION_PROFILES } from "./validation-profiles.mts";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");
const ENVIRONMENT_PREFIXED_CONFIG = /\b(?:STAGING|DEV|DEVELOPMENT|PROD|PRODUCTION)_[A-Z0-9_]+\b/u;
const SELF_HOSTED_RUNNER_LABELS = ["self-hosted", "Linux", "campus-ci"];

test("PR tooling uses the grouped repository entry instead of workspace tests", async () => {
	const workflow = await readFile(path.join(REPOSITORY_ROOT, ".github/workflows/pr.yml"), "utf8");
	assert.match(workflow, /pnpm test:tooling --groups=/u);
	assert.doesNotMatch(workflow, /pnpm test --groups=/u);
});

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function githubExpression(expression: string): string {
	return ["$", "{{ ", expression, " }}"].join("");
}

function runnerSelector(hostedRunner: "ubuntu-24.04" | "ubuntu-24.04-arm"): string {
	return githubExpression(
		`fromJSON(vars.CI_RUNNER_MODE == 'self-hosted' && '${JSON.stringify(SELF_HOSTED_RUNNER_LABELS)}' || '"${hostedRunner}"')`,
	);
}

// Exercise the workflow's boolean expressions against concrete event outcomes.
function condition(expression: unknown, context: Record<string, unknown>): boolean {
	return runInNewContext(
		String(expression)
			.replaceAll(".cache-matched-key", '["cache-matched-key"]')
			.replaceAll(".cache-hit", '["cache-hit"]')
			.replaceAll(/\.(release-plan|candidate-status|publish-images|publish-workers)/gu, '["$1"]')
			.replaceAll(".repository-validation", '["repository-validation"]'),
		{
			always: () => true,
			cancelled: () => false,
			contains: (values: string[], value: string) => values.includes(value),
			fromJSON: JSON.parse,
			...context,
		},
	);
}

test("image cache permissions are confined to mutually exclusive reusable jobs", async () => {
	const workflow = await loadWorkflow("pr.yml");
	const validation = workflowJob(workflow, "repository-validation");
	assert.equal((validation.permissions as Record<string, string>).packages, "read");
	const trusted = workflowJob(workflow, "image-evidence-trusted");
	const readonly = workflowJob(workflow, "image-evidence-readonly");
	assert.equal((trusted.permissions as Record<string, string>).packages, "read");
	assert.equal((readonly.permissions as Record<string, string>).packages, "read");
	assert.equal(trusted.uses, readonly.uses);
	assert.equal(trusted.with.cache_write, undefined);
	assert.equal(trusted.with.cache_read, true);
	assert.equal(readonly.with.cache_read, false);
	for (const [sameRepo, actor, author, cancelled, result, selected, expected] of [
		[true, "developer", "developer", false, "success", true, [true, false]],
		[false, "developer", "developer", false, "success", true, [false, true]],
		[true, "developer", "dependabot[bot]", false, "success", true, [false, true]],
		[true, "dependabot[bot]", "developer", false, "success", true, [false, true]],
		[true, "developer", "developer", true, "success", true, [false, false]],
		[true, "developer", "developer", false, "failure", true, [false, false]],
		[true, "developer", "developer", false, "success", false, [false, false]],
	] as const) {
		const context = {
			cancelled: () => cancelled,
			needs: {
				"repository-validation": { result, outputs: { has_image_build: String(selected) } },
			},
			github: {
				actor,
				repository: "owner/source",
				event: {
					pull_request: {
						head: { repo: { full_name: sameRepo ? "owner/source" : "fork/source" } },
						user: { login: author },
					},
				},
			},
		};
		assert.deepEqual([condition(trusted.if, context), condition(readonly.if, context)], expected);
	}
	const reusable = await loadWorkflow("pr-image-evidence.yml");
	const build = workflowJob(reusable, "build");
	const cacheWrite = reusable.on.workflow_call.inputs.cache_write;
	const cacheRead = reusable.on.workflow_call.inputs.cache_read;
	assert.equal(cacheWrite, undefined);
	assert.equal(cacheRead.required, false);
	assert.equal(cacheRead.default, false);
	const builder = namedStep(build, "Setup Docker Buildx");
	assert.equal((builder.with as Record<string, string>).driver, "docker-container");
	assert.match(
		String((builder.with as Record<string, string>)["buildkitd-config-inline"]),
		/max-parallelism = 2/u,
	);
	assert.equal(namedStep(build, "Login for image caches")["continue-on-error"], true);
	assert(!jobSteps(build).some((step) => /pnpm install|pnpm check|turbo/u.test(String(step.run))));
});

test("required repo-checks rejects failures and unexpected image skips", async () => {
	const gate = workflowJob(await loadWorkflow("pr.yml"), "repo-checks");
	assert.deepEqual(gate.permissions, {});
	assert.match(String(gate.if), /always\(\)/u);
	const step = namedStep(gate, "Check all selected evidence");
	for (const [validation, selected, trusted, readonly, passes] of [
		["success", "false", "skipped", "skipped", true],
		["success", "true", "success", "skipped", true],
		["success", "true", "skipped", "success", true],
		["success", "true", "skipped", "skipped", false],
		["success", "true", "failure", "skipped", false],
		["success", "true", "cancelled", "skipped", false],
		["failure", "false", "skipped", "skipped", false],
		["success", "", "skipped", "skipped", false],
	] as const) {
		const invoke = () =>
			execFileSync("bash", ["-e", "-c", String(step.run)], {
				env: {
					...process.env,
					VALIDATION_RESULT: validation,
					IMAGE_SELECTED: selected,
					TRUSTED_RESULT: trusted,
					READONLY_RESULT: readonly,
				},
				stdio: "pipe",
			});
		if (passes) {
			assert.doesNotThrow(invoke);
		} else {
			assert.throws(invoke);
		}
	}
});

test("pnpm caches restore before installs and save only successful installation state", async () => {
	const job = workflowJob(await loadWorkflow("pr.yml"), "repository-validation");
	const steps = jobSteps(job);
	const restore = namedStep(job, "Restore pnpm store");
	const save = namedStep(job, "Save pnpm store");
	assert.equal(restore.if, "runner.environment != 'self-hosted'");
	assert.equal(restore["continue-on-error"], true);
	assert.equal(save["continue-on-error"], true);
	assert(isObject(restore.with) && isObject(save.with));
	assert.deepEqual(save.with, {
		path: restore.with.path,
		key: githubExpression("steps.plan.outputs.pnpm_cache_key"),
	});
	assert.match(String(restore.with.key), /hashFiles\('pnpm-lock.yaml', 'pnpm-workspace.yaml'\)/u);
	assert.deepEqual(String(restore.with["restore-keys"]).trim().split("\n"), [
		restore.with.key,
		`${githubExpression("steps.pnpm_cache.outputs.prefix")}-`,
	]);
	const plan = namedStep(job, "Generate pull request validation plan");
	assert(isObject(plan.env));
	assert.equal(`${plan.env.PNPM_CACHE_BASE}-scope-`, restore.with.key);
	assert(steps.indexOf(restore) < steps.indexOf(namedStep(job, "Install validation dependencies")));
	assert(steps.indexOf(save) > steps.indexOf(namedStep(job, "Install affected workspaces")));
	assert.match(String(namedStep(job, "Configure hosted pnpm store").run), /PNPM_CONFIG_STORE_DIR/u);
	assert.match(String(namedStep(job, "Configure hosted pnpm store").run), /prefix=pnpm-v2-/u);
	for (const [hit, root, affected, selected, cancelled, environment, expected] of [
		[false, "success", "success", true, false, "github-hosted", true],
		[true, "success", "success", true, false, "github-hosted", false],
		[false, "failure", "success", true, false, "github-hosted", false],
		[false, "success", "failure", true, false, "github-hosted", false],
		[false, "success", "skipped", true, false, "github-hosted", false],
		[false, "success", "skipped", false, false, "github-hosted", true],
		[false, "success", "success", true, true, "github-hosted", false],
		[false, "success", "success", true, false, "self-hosted", false],
	] as const) {
		assert.equal(
			condition(save.if, {
				cancelled: () => cancelled,
				runner: { environment },
				steps: {
					restore_pnpm: { outputs: { "cache-matched-key": hit ? "current-scope" : "other-scope" } },
					install_validation: { outcome: root },
					install_affected: { outcome: affected },
					plan: {
						outcome: "success",
						outputs: {
							validation_profiles: JSON.stringify(selected ? ["affected-node"] : []),
							pnpm_cache_key: "current-scope",
						},
					},
				},
			}),
			expected,
		);
	}
});

test("pnpm caches save expanded installation scopes and reuse their saved keys on later runs", async () => {
	const job = workflowJob(await loadWorkflow("pr.yml"), "repository-validation");
	const planStep = namedStep(job, "Generate pull request validation plan");
	const save = namedStep(job, "Save pnpm store");
	const scopeCommands = String(planStep.run).match(/(pnpm_install_scope=[\s\S]*?)\n\{/u)?.[1];
	const keyCommand = String(planStep.run).match(/^\s*(echo "pnpm_cache_key=.*")$/mu)?.[1];
	assert(
		scopeCommands && keyCommand,
		"workflow must compute and export the installation scope key",
	);
	const cacheKey = (packages: string[], selected = true, base = "pnpm-v2-tools-lock") =>
		execFileSync("bash", ["-euo", "pipefail", "-c", `${scopeCommands}\n${keyCommand}`], {
			encoding: "utf8",
			env: {
				...process.env,
				PNPM_CACHE_BASE: base,
				plan: JSON.stringify({
					validationProfiles: selected ? ["affected-node"] : [],
					affectedPackages: packages,
				}),
			},
		})
			.trim()
			.replace(/^pnpm_cache_key=/u, "");
	const rootKey = cacheKey([], false);
	const expandedKey = cacheKey(["ops-web", "app-api"]);
	assert.match(rootKey, /^pnpm-v2-tools-lock-scope-[a-f0-9]{64}$/u);
	assert.notEqual(rootKey, expandedKey);
	assert.equal(cacheKey(["app-api", "ops-web", "ops-web"]), expandedKey);
	assert.equal(cacheKey(["ops-web"], false), rootKey);
	assert.equal(cacheKey(["campus-contracts"]), rootKey);
	const changedLockKey = cacheKey(["ops-web", "app-api"], true, "pnpm-v2-tools-new-lock");
	assert.notEqual(changedLockKey, expandedKey);
	for (const [matchedKey, nextKey, selected, expected] of [
		["", rootKey, false, true],
		[rootKey, expandedKey, true, true],
		[expandedKey, expandedKey, true, false],
		[expandedKey, changedLockKey, true, true],
	] as const) {
		assert.equal(
			condition(save.if, {
				runner: { environment: "github-hosted" },
				steps: {
					restore_pnpm: { outputs: { "cache-matched-key": matchedKey } },
					install_validation: { outcome: "success" },
					install_affected: { outcome: selected ? "success" : "skipped" },
					plan: {
						outcome: "success",
						outputs: {
							pnpm_cache_key: nextKey,
							validation_profiles: JSON.stringify(selected ? ["affected-node"] : []),
						},
					},
				},
			}),
			expected,
		);
	}
});

test("Go caches follow native selection and save fresh successful analysis only", async () => {
	const job = workflowJob(await loadWorkflow("pr.yml"), "repository-validation");
	const steps = jobSteps(job);
	const restore = namedStep(job, "Restore Go and lint caches");
	const native = namedStep(job, "Check affected native code");
	const save = namedStep(job, "Save Go and lint caches");
	assert(isObject(restore.with) && isObject(save.with));
	assert.equal(save.with.path, restore.with.path);
	assert.equal(save.with.key, githubExpression("steps.restore_go.outputs.cache-primary-key"));
	assert.equal(
		String(restore.with.key),
		`${String(restore.with["restore-keys"]).trim()}${githubExpression("github.sha")}`,
	);
	assert.match(String(restore.with.key), /runner.arch/u);
	assert.match(String(restore.with.key), /flake.lock/u);
	assert.match(String(restore.with.key), /go.work/u);
	assert.match(String(restore.with.key), /go.sum/u);
	assert.match(String(restore.with.key), /golangci.yml/u);
	assert(steps.indexOf(restore) < steps.indexOf(namedStep(job, "Lint repository")));
	assert(steps.indexOf(save) > steps.indexOf(native));
	assert.equal(restore["continue-on-error"], true);
	assert.equal(save["continue-on-error"], true);
	for (const [variable, directory] of [
		["GOCACHE", "build"],
		["GOMODCACHE", "mod"],
		["GOLANGCI_LINT_CACHE", "lint"],
	]) {
		assert(
			String(restore.with.path).includes(
				`${githubExpression("runner.temp")}/go-cache/${directory}`,
			),
		);
		assert(
			String(namedStep(job, "Configure hosted Go caches").run).includes(
				`${variable}=$RUNNER_TEMP/go-cache/${directory}`,
			),
		);
	}
	for (const [selected, cancelled, environment, plan, expected] of [
		[true, false, "github-hosted", "success", true],
		[false, false, "github-hosted", "success", false],
		[true, true, "github-hosted", "success", false],
		[true, false, "self-hosted", "success", false],
		[true, false, "github-hosted", "failure", false],
	] as const) {
		assert.equal(
			condition(restore.if, {
				cancelled: () => cancelled,
				runner: { environment },
				steps: {
					plan: {
						outcome: plan,
						outputs: {
							validation_profiles: JSON.stringify(selected ? ["affected-native"] : []),
						},
					},
				},
			}),
			expected,
		);
	}
	for (const [hit, nativeOutcome, restoreOutcome, cancelled, expected] of [
		["", "success", "success", false, true],
		["false", "success", "success", false, true],
		["true", "success", "success", false, false],
		["false", "failure", "success", false, false],
		["false", "skipped", "success", false, false],
		["", "success", "failure", false, false],
		["", "success", "skipped", false, false],
		["false", "success", "success", true, false],
	] as const) {
		assert.equal(
			condition(save.if, {
				cancelled: () => cancelled,
				steps: {
					restore_go: { outcome: restoreOutcome, outputs: { "cache-hit": hit } },
					native_evidence: { outcome: nativeOutcome },
				},
			}),
			expected,
		);
	}
});

test("failed prerequisites prevent expensive PR checks while diagnostics remain available", async () => {
	const job = workflowJob(await loadWorkflow("pr.yml"), "repository-validation");
	const heavy = [
		"Install affected workspaces",
		"Run affected Node evidence",
		"Run container build contract evidence",
		"Check affected native code",
		"Verify unified database upgrade",
	];
	const successful = Object.fromEntries(
		[
			"repository_lint",
			"repository_docs",
			"repository_test",
			"secrets",
			"contracts",
			"canonical_order",
			"github_actions",
			"install_affected",
			"node_evidence",
			"container_build",
			"native_evidence",
		].map((id) => [id, { outcome: "success" }]),
	);
	const plan = {
		outcome: "success",
		outputs: {
			repository_groups: JSON.stringify(["ci", "docs"]),
			validation_profiles: JSON.stringify([
				"affected-node",
				"container-build",
				"affected-native",
				"schema-migration",
			]),
			light_surfaces: JSON.stringify(["contracts", "canonical-order", "config"]),
			node_evidence_profiles: '["affected-node"]',
			has_container_build: "true",
		},
	};
	for (const failed of [
		undefined,
		"repository_test",
		"secrets",
		"contracts",
		"canonical_order",
		"github_actions",
	]) {
		const steps = { ...successful, plan, ...(failed ? { [failed]: { outcome: "failure" } } : {}) };
		for (const name of heavy) {
			assert.equal(
				condition(namedStep(job, name).if, { steps }),
				failed === undefined,
				`${name}: ${failed}`,
			);
		}
	}
	const lintFailure = {
		...successful,
		plan,
		repository_lint: { outcome: "failure" },
		repository_docs: { outcome: "skipped" },
		repository_test: { outcome: "skipped" },
	};
	for (const name of heavy) {
		assert.equal(condition(namedStep(job, name).if, { steps: lintFailure }), false);
	}
	for (const skipped of ["contracts", "canonical_order", "github_actions"]) {
		const steps = { ...successful, plan, [skipped]: { outcome: "skipped" } };
		for (const name of heavy) {
			assert.equal(condition(namedStep(job, name).if, { steps }), false);
		}
	}
	const installFailure = {
		...successful,
		plan,
		install_affected: { outcome: "failure" },
		node_evidence: { outcome: "skipped" },
	};
	for (const name of heavy.slice(1)) {
		assert.equal(condition(namedStep(job, name).if, { steps: installFailure }), false);
	}
	const nativeOnly = {
		...successful,
		plan: {
			...plan,
			outputs: {
				...plan.outputs,
				validation_profiles: '["affected-native"]',
				light_surfaces: "[]",
				node_evidence_profiles: "[]",
				has_container_build: "false",
			},
		},
		contracts: { outcome: "skipped" },
		canonical_order: { outcome: "skipped" },
		github_actions: { outcome: "skipped" },
		install_affected: { outcome: "skipped" },
		node_evidence: { outcome: "skipped" },
		container_build: { outcome: "skipped" },
	};
	assert.equal(
		condition(namedStep(job, "Check affected native code").if, { steps: nativeOnly }),
		true,
	);
	assert.equal(namedStep(job, "Summarize repository evidence").if, "always()");
	assert.equal(namedStep(job, "Scan authored commits for secrets").if, "always()");
});

test("workflow jq selects Node and image evidence from the plan profile array", async () => {
	const workflow = await loadWorkflow("pr.yml");
	const plan = namedStep(
		workflowJob(workflow, "repository-validation"),
		"Generate pull request validation plan",
	);
	const expression = String(plan.run).match(/node_evidence_profiles="\$\(jq -c '([^']+)'/u)?.[1];
	assert(expression, "workflow must extract evidence profiles");
	for (const [profiles, expected] of [
		[[], []],
		[["affected-node"], ["affected-node"]],
		[["image-build"], []],
		[["affected-node", "container-build", "image-build"], ["affected-node"]],
		[["container-build", "affected-native"], []],
	]) {
		const actual = execFileSync("jq", ["-c", expression], {
			input: JSON.stringify({ validationProfiles: profiles, affectedPackages: ["ops-web"] }),
			encoding: "utf8",
		});
		assert.deepEqual(JSON.parse(actual), expected);
	}
});

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

test("pull request validation keeps the shared required-check contract", async () => {
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
	const repoChecks = workflowJob(workflow, "repository-validation");
	assert.equal(repoChecks.if, "github.event.pull_request.draft == false");
	assert.equal(repoChecks["runs-on"], runnerSelector("ubuntu-24.04-arm"));
	assert.equal(namedStep(repoChecks, "Install Nix").if, "runner.environment != 'self-hosted'");
	const staticDependencies = namedStep(repoChecks, "Install static-check dependencies");
	assert.equal(staticDependencies.if, "always()");
	assert.match(String(staticDependencies.run), /uv sync --only-dev --no-install-workspace/u);
	const repositoryCheck = namedStep(repoChecks, "Lint repository");
	assert.match(String(repositoryCheck.run), /pnpm lint --verbose --log-file/u);
	assert.match(
		String(namedStep(repoChecks, "Check repository documentation").if),
		/steps.repository_lint.outcome == 'success'/u,
	);
	assert.match(
		String(namedStep(repoChecks, "Test repository scripts").if),
		/steps.repository_docs.outcome == 'success'/u,
	);
	assert(isObject(repositoryCheck.env));
	assert.equal(repositoryCheck.env.GITHUB_TOKEN, githubExpression("github.token"));
	for (const removed of ["Lint Python", "Lint YAML", "Lint SQL", "Lint Shell"]) {
		assert.equal(
			jobSteps(repoChecks).some((step) => step.name === removed),
			false,
			removed,
		);
	}
	assert.equal(
		namedStep(repoChecks, "Summarize repository evidence").shell,
		"nix develop .#ci-core --command bash -e {0}",
	);
	const native = namedStep(repoChecks, "Check affected native code");
	assert.equal(native.shell, "nix develop .#ci-go --command bash -e {0}");
	assert.match(String(native.if), /affected-native/u);
	assert.match(String(native.run), /--profiles '\["affected-native"\]'/u);
	const summary = namedStep(repoChecks, "Summarize repository evidence");
	assert(isObject(summary.env));
	assert.match(String(summary.env.RESULTS), /steps\.native_evidence\.outcome/u);
	assert.match(
		String(namedStep(repoChecks, "Run affected Node evidence").if),
		/node_evidence_profiles != '\[\]'/u,
	);
	assert.match(
		String(namedStep(repoChecks, "Run container build contract evidence").if),
		/has_container_build == 'true'/u,
	);
	assert.equal(
		namedStep(repoChecks, "Run affected Node evidence").shell,
		"nix develop .#ci-core --command bash -e {0}",
	);
	const nodeAndImages = namedStep(repoChecks, "Run affected Node evidence");
	assert(isObject(nodeAndImages.env));
	assert.equal(
		nodeAndImages.env.VALIDATION_PROFILES,
		githubExpression("steps.plan.outputs.node_evidence_profiles"),
	);
	assert.match(String(nodeAndImages.run), /--repository "\$GITHUB_REPOSITORY"/u);
	assert.match(String(nodeAndImages.run), /--summary "\$GITHUB_STEP_SUMMARY"/u);
});

test("Source diff consumers check out complete immutable history", async () => {
	for (const [workflowName, jobName, persistCredentials] of [
		["pr.yml", "repository-validation", false],
		["execution-runtime-publish.yml", "release-plan", true],
	] as const) {
		const workflow = await loadWorkflow(workflowName);
		const checkouts = sourceCheckouts(workflow, jobName);
		assert.equal(checkouts.length, 1, `${jobName} must have one Source checkout`);
		const checkout = checkouts[0];
		assert(checkout);
		assert(isObject(checkout.with));
		assert.equal(checkout.with["fetch-depth"], 0);
		assert.equal(checkout.with["persist-credentials"], persistCredentials);
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
	assert.equal(evidence["runs-on"], runnerSelector("ubuntu-24.04"));
	assert.equal(namedStep(evidence, "Install Nix").if, "runner.environment != 'self-hosted'");
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
	assert.equal(scan["runs-on"], runnerSelector("ubuntu-24.04"));
	assert.equal(namedStep(scan, "Install Nix").if, "runner.environment != 'self-hosted'");
});

test("candidate publication keeps permissions, runners, and job dependencies explicit", async () => {
	const workflow = await loadWorkflow("execution-runtime-publish.yml");
	for (const name of ["release-plan", "publish-images", "publish-workers", "promote"]) {
		const steps = jobSteps(workflowJob(workflow, name));
		const guard = steps.findIndex((step) => String(step.name).startsWith("Verify current main"));
		assert(guard >= 0 && guard < steps.findIndex((step) => step.name === "Install Nix"), name);
		assert.equal(steps[guard].shell, "bash -e {0}");
	}
	assert.deepEqual(workflow.permissions, { contents: "read" });
	assert.deepEqual(workflow.concurrency, {
		"cancel-in-progress": false,
		group: "campus-agent-ghcr-mutation",
		queue: "max",
	});

	const releasePlan = workflowJob(workflow, "release-plan");
	assert.equal(releasePlan["runs-on"], runnerSelector("ubuntu-24.04"));
	assert.equal(namedStep(releasePlan, "Install Nix").if, "runner.environment != 'self-hosted'");
	assert.equal(releasePlan.environment, undefined);
	assert.deepEqual(releasePlan.permissions, {
		contents: "read",
		statuses: "write",
		actions: "read",
	});

	const publishImages = workflowJob(workflow, "publish-images");
	assert.equal(publishImages.needs, "release-plan");
	assert.match(String(publishImages.if), /outputs\.action/u);
	assert.equal(publishImages["runs-on"], runnerSelector("ubuntu-24.04-arm"));
	assert.equal(namedStep(publishImages, "Install Nix").if, "runner.environment != 'self-hosted'");
	assert.deepEqual(publishImages.permissions, { contents: "read", packages: "write" });
	const buildx = namedStep(publishImages, "Setup Docker Buildx");
	assert.equal(buildx.if, "runner.environment != 'self-hosted'");
	assert.equal(buildx.uses, "docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c");
	assert(isObject(buildx.with));
	assert.equal(buildx.with["cache-binary"], false);
	assert.equal(buildx.with.driver, "docker-container");
	assert.match(String(buildx.with["buildkitd-config-inline"]), /max-parallelism = 2/u);
	assert.equal(
		namedStep(publishImages, "Verify runner-owned builder").if,
		"runner.environment == 'self-hosted'",
	);

	const publishWorkers = workflowJob(workflow, "publish-workers");
	assert.equal(publishWorkers.needs, "release-plan");
	assert.match(String(publishWorkers.if), /outputs\.action/u);
	assert.equal(publishWorkers["runs-on"], runnerSelector("ubuntu-24.04"));
	assert.equal(namedStep(publishWorkers, "Install Nix").if, "runner.environment != 'self-hosted'");
	assert.deepEqual(publishWorkers.environment, {
		name: "staging",
		deployment: false,
	});

	const candidateStatus = workflowJob(workflow, "candidate-status");
	assert.deepEqual(candidateStatus.needs, ["release-plan", "publish-images", "publish-workers"]);
	assert.equal(candidateStatus["runs-on"], runnerSelector("ubuntu-24.04"));
	assert.deepEqual(candidateStatus.permissions, { contents: "read", statuses: "write" });
	assert.match(String(candidateStatus.if), /^always\(\)/u);

	const promote = workflowJob(workflow, "promote");
	assert.deepEqual(promote.needs, [
		"release-plan",
		"candidate-status",
		"publish-images",
		"publish-workers",
	]);
	assert.equal(promote["runs-on"], runnerSelector("ubuntu-24.04"));
	assert.deepEqual(promote.permissions, { contents: "read", actions: "read" });
	assert.equal(namedStep(promote, "Install Nix").if, "runner.environment != 'self-hosted'");
	assert.equal(promote.environment, undefined);
	assert.match(String(promote.if), /needs\.candidate-status\.outputs\.approved == 'true'/u);
	assert.match(String(promote.if), /github\.ref == 'refs\/heads\/main'/u);
	assert.match(String(promote.if), /inputs\.promote/u);
	assert.match(String(promote.if), /outputs\.action == 'reuse'/u);
	const releaseRevision = namedStep(releasePlan, "Verify current main revision");
	assert.match(String(releaseRevision.env.RECOVERY_RUN_ID), /promotion_recovery_run_id/u);
	assert.match(String(releaseRevision.run), /promotion_recovery_run_id is required/u);
	const promoteRevision = namedStep(promote, "Verify current main revision before promotion");
	assert.match(String(promoteRevision.run), /git merge-base --is-ancestor/u);
	assert.match(String(releaseRevision.run), /promotion_recovery_source_sha is required/u);
	assert.equal(releasePlan.outputs.workers, githubExpression("steps.publication.outputs.workers"));
	assert.equal(namedStep(publishImages, "Upload image digests").with["retention-days"], 7);
	assert.equal(namedStep(publishWorkers, "Upload Worker candidates").with["retention-days"], 7);
	assert(isObject(workflow.on));
	assert(isObject(workflow.on.workflow_dispatch));
	assert(isObject(workflow.on.workflow_dispatch.inputs));
	assert.equal(workflow.on.workflow_dispatch.inputs.promotion_recovery_run_id.type, "string");
	assert.equal(workflow.on.workflow_dispatch.inputs.promotion_recovery_source_sha.type, "string");
	const plan = namedStep(releasePlan, "Select release candidates");
	assert.match(String(plan.run), /\.sourceBases/u);
	assert.match(String(plan.run), /\.topologyMigrations/u);
	assert.doesNotMatch(String(plan.run), /\.kubernetes/u);
	const promotion = namedStep(promote, "Update GitOps desired state");
	assert.match(String(promotion.run), /--source-bases "\$SOURCE_BASES"/u);
	assert.match(String(promotion.run), /--topology-migration-file/u);
	assert.match(
		String(promotion.run),
		/--topology-migration-path "releases\/staging-migrations\/\$\{PROMOTION_SOURCE_SHA\}\.json"/u,
	);
	assert.match(String(promotion.env.PROMOTION_SOURCE_SHA), /promotion_recovery_source_sha/u);
	const recoveryImageDownload = namedStep(promote, "Download image digests");
	assert.match(String(recoveryImageDownload.if), /outputs\.action/u);
	assert.equal(
		recoveryImageDownload.with["run-id"],
		githubExpression("needs.release-plan.outputs.publication_run_id"),
	);
	const recoveryWorkerDownload = namedStep(promote, "Download Worker candidates");
	assert.match(String(recoveryWorkerDownload.if), /outputs\.action/u);
	assert.equal(
		recoveryWorkerDownload.with["run-id"],
		githubExpression("needs.release-plan.outputs.publication_run_id"),
	);
	assert.doesNotMatch(String(promotion.run), /--kubernetes/u);
	assert(!jobSteps(promote).some((step) => step.name === "Preflight GitOps promotion render"));
	const deploymentPr = namedStep(promote, "Open GitOps deployment pull request");
	assert.deepEqual(deploymentPr.env, { LC_ALL: "C" });
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
	assert.equal(appApi.env.AUTH_EMAIL_FROM, githubExpression("vars.AUTH_EMAIL_FROM"));
	assert.equal(
		appApi.env.OBJECT_STORE_DERIVED_READ_ACCESS_KEY,
		githubExpression("secrets.OBJECT_STORE_DERIVED_READ_ACCESS_KEY"),
	);
	assert.equal(
		appApi.env.OBJECT_STORE_DERIVED_READ_SECRET_KEY,
		githubExpression("secrets.OBJECT_STORE_DERIVED_READ_SECRET_KEY"),
	);
	assert.equal(
		appApi.env.OBJECT_STORE_DERIVED_ACCESS_KEY,
		githubExpression("secrets.OBJECT_STORE_DERIVED_ACCESS_KEY"),
	);
	assert.equal(
		appApi.env.OBJECT_STORE_DERIVED_SECRET_KEY,
		githubExpression("secrets.OBJECT_STORE_DERIVED_SECRET_KEY"),
	);
	assert.equal(
		appApi.env.OBJECT_STORE_VPC_SERVICE_ID,
		githubExpression("vars.OBJECT_STORE_VPC_SERVICE_ID"),
	);

	const docsSource = namedStep(workers, "Publish generated Docs source");
	assert.equal(docsSource.run, "pnpm --dir apps/campus-web docs:source:publish");
	assert(isObject(docsSource.env));
	assert.equal(
		docsSource.env.OBJECT_STORE_DERIVED_ACCESS_KEY,
		githubExpression("secrets.OBJECT_STORE_DERIVED_ACCESS_KEY"),
	);
	assert.equal(
		docsSource.env.OBJECT_STORE_DERIVED_SECRET_KEY,
		githubExpression("secrets.OBJECT_STORE_DERIVED_SECRET_KEY"),
	);
	const campusWeb = namedStep(workers, "Build Campus Web staging candidate");
	assert.match(String(campusWeb.if), /steps\.campus_web_docs\.outcome == 'success'/u);
	assert(steps.indexOf(docsSource) < steps.indexOf(campusWeb));
	assert(isObject(campusWeb.env));
	assert.equal(
		campusWeb.env.OBJECT_STORE_DERIVED_READ_ACCESS_KEY,
		githubExpression("secrets.OBJECT_STORE_DERIVED_READ_ACCESS_KEY"),
	);
	assert.equal(campusWeb.env.OBJECT_STORE_ENDPOINT, githubExpression("vars.OBJECT_STORE_ENDPOINT"));
	assert.equal(campusWeb.env.OBJECT_STORE_DERIVED_ACCESS_KEY, undefined);
	assert.equal(campusWeb.env.OBJECT_STORE_DERIVED_SECRET_KEY, undefined);

	const statusWeb = namedStep(workers, "Upload status-web candidate");
	assert(isObject(statusWeb.env));
	assert.equal(
		statusWeb.env.CLOUDFLARE_API_TOKEN,
		githubExpression("secrets.CLOUDFLARE_API_TOKEN"),
	);
	assert.equal(statusWeb.env.STATUS_SNAPSHOT_KV_ID, githubExpression("vars.STATUS_SNAPSHOT_KV_ID"));
});

test("retention is manual, uses trusted main and serializes mutations with publication", async () => {
	const workflow = await loadWorkflow("ghcr-retention.yml");
	assert.equal(workflow.on.pull_request_target, undefined);
	assert.equal(workflow.on.pull_request, undefined);
	assert.equal(workflow.on.schedule, undefined);
	assert.equal(workflow.on.workflow_dispatch.inputs.scope.default, "full");
	assert.equal(workflow.on.workflow_dispatch.inputs.mode.default, "report");
	const pr = workflowJob(workflow, "pr-cache");
	assert.deepEqual(pr.permissions, {
		contents: "read",
		packages: "write",
		"pull-requests": "read",
	});
	assert.equal(namedStep(pr, "Checkout Source").with.ref, "main");
	const full = workflowJob(workflow, "project-retention");
	assert.equal(full.permissions.packages, "write");
	assert.equal(full.permissions.actions, "read");
	const sourcePackage = namedStep(full, "Create Source package token");
	assert.equal(sourcePackage.with["permission-packages"], "write");
	const expression = String(workflow.concurrency.group).slice(3, -2);
	const group = (scope: string, mode: string) =>
		runInNewContext(expression, {
			inputs: { scope, mode, pr_number: "442" },
			github: { run_id: 10 },
			format: (pattern: string, value: string | number) => pattern.replace("{0}", String(value)),
		});
	assert.equal(group("full", "apply"), "campus-agent-ghcr-mutation");
	assert.equal(group("full", "report"), "campus-agent-ghcr-report-10");
	assert.equal(group("pr", "apply"), "campus-agent-ghcr-pr-cache-442");
	assert.match(
		String(namedStep(full, "Plan and optionally apply project retention").run),
		/--mode "\$RETENTION_MODE"/u,
	);
	assert.match(
		String(namedStep(full, "Plan and optionally apply project retention").env?.GH_TOKEN),
		/source-package-token/u,
	);
});

test("PR image evidence only imports caches and requires no PR write coordination", async () => {
	const reusable = await loadWorkflow("pr-image-evidence.yml");
	assert.equal(reusable.on.workflow_call.inputs.cache_write, undefined);
	assert.equal(reusable.on.workflow_call.inputs.pull_request_number, undefined);
	const build = workflowJob(reusable, "build");
	assert.equal(namedStep(build, "Login for image caches").if, "inputs.cache_read");
	assert.doesNotMatch(
		String(namedStep(build, "Run image evidence").run),
		/cache-export-registry|pr-cache-/u,
	);
	const trusted = workflowJob(await loadWorkflow("pr.yml"), "image-evidence-trusted");
	assert.equal(trusted.permissions["pull-requests"], undefined);
});

test("formal release serializes publication and separates read and write credentials", async () => {
	const workflow = await loadWorkflow("formal-release.yml");
	assert.deepEqual(workflow.concurrency, {
		group: "campus-agent-ghcr-mutation",
		"cancel-in-progress": false,
		queue: "max",
	});
	const publish = workflowJob(workflow, "publish");
	assert.deepEqual(publish.permissions, { contents: "read", packages: "read" });
	const settings = namedStep(publish, "Create Source settings read token");
	assert.equal(settings.with["permission-administration"], "read");
	const publication = namedStep(publish, "Create Source publication token");
	assert.equal(publication.with["permission-contents"], "write");
	assert.equal(publication.with["permission-workflows"], "write");
	const run = namedStep(publish, "Publish verified snapshot without rebuilding");
	assert.match(String(run.env?.SOURCE_TOKEN), /publication-token/u);
});

test("duplicate publication never marks pending or publishes, while reuse can promote", async () => {
	const workflow = await loadWorkflow("execution-runtime-publish.yml");
	const plan = workflowJob(workflow, "release-plan");
	for (const action of ["publish", "reuse", "skip"]) {
		const outputs = {
			action,
			images: '["model-config"]',
			workers: "[]",
			source_bases: "[]",
			topology_migrations: "[]",
			pending_written: action === "publish" ? "true" : "",
		};
		const context = {
			steps: { publication: { outputs }, plan: { outputs } },
			needs: {
				"release-plan": { result: "success", outputs },
				"candidate-status": {
					result: action === "skip" ? "skipped" : "success",
					outputs: { approved: "true" },
				},
				"publish-images": { result: action === "publish" ? "success" : "skipped" },
				"publish-workers": { result: "skipped" },
			},
			github: { ref: "refs/heads/main", event_name: "push" },
			inputs: { promote: false },
		};
		assert.equal(
			condition(namedStep(plan, "Mark staging candidate pending").if, context),
			action === "publish",
		);
		assert.equal(
			condition(workflowJob(workflow, "publish-images").if, context),
			action === "publish",
		);
		assert.equal(
			condition(workflowJob(workflow, "candidate-status").if, context),
			action !== "skip",
		);
		assert.equal(condition(workflowJob(workflow, "promote").if, context), action !== "skip");
	}
	assert.equal(
		condition(workflowJob(workflow, "candidate-status").if, {
			needs: { "release-plan": { outputs: { action: "publish", pending_written: "" } } },
		}),
		false,
	);
});

test("promotion narrows reused artifacts to the current selection", async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), "selected-candidates-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(path.join(root, "worker-candidates"));
	await writeFile(
		path.join(root, "image-digests.json"),
		JSON.stringify({ "model-config": "keep", "agent-runtime": "drop" }),
	);
	for (const name of ["app-api-staging", "campus-web-staging"]) {
		await writeFile(
			path.join(root, "worker-candidates", `${name}.json`),
			JSON.stringify({ workerName: name }),
		);
	}
	const step = namedStep(
		workflowJob(await loadWorkflow("execution-runtime-publish.yml"), "promote"),
		"Keep only selected candidates",
	);
	execFileSync("bash", ["-e", "-c", String(step.run)], {
		cwd: root,
		env: { ...process.env, IMAGES: '["model-config"]', WORKERS: '["app-api-staging"]' },
	});
	assert.deepEqual(JSON.parse(await readFile(path.join(root, "image-digests.json"), "utf8")), {
		"model-config": "keep",
	});
	assert.deepEqual(await readdir(path.join(root, "worker-candidates")), ["app-api-staging.json"]);
});

test("recovery requires both identity inputs before remote queries or candidate status writes", async () => {
	const job = workflowJob(await loadWorkflow("execution-runtime-publish.yml"), "release-plan");
	const guard = namedStep(job, "Verify current main revision");
	const steps = jobSteps(job);
	assert(steps.indexOf(guard) < steps.indexOf(namedStep(job, "Resolve publication reuse")));
	assert(steps.indexOf(guard) < steps.indexOf(namedStep(job, "Mark staging candidate pending")));
	for (const [id, sha, message] of [
		["10", "", "promotion_recovery_source_sha is required"],
		["", "a".repeat(40), "promotion_recovery_run_id is required"],
		["", "", ""],
		["10", "a".repeat(40), ""],
	]) {
		const result = spawnSync(
			"bash",
			[
				"-e",
				"-c",
				`
			gh() { echo "remote-query" >&2; echo "$GITHUB_SHA"; }
			git() { return 0; }
			${String(guard.run)}
		`,
			],
			{
				env: {
					...process.env,
					GITHUB_REPOSITORY: "MUC-WIKI/campus-agent",
					GITHUB_SHA: "a".repeat(40),
					RECOVERY_RUN_ID: id,
					RECOVERY_SOURCE_SHA: sha,
				},
				encoding: "utf8",
			},
		);
		if (message) {
			assert.notEqual(result.status, 0);
			assert(result.stderr.includes(message));
			assert(!result.stderr.includes("remote-query"));
		} else {
			assert.equal(result.status, 0, result.stderr);
			assert(result.stderr.includes("remote-query"));
		}
	}
});
