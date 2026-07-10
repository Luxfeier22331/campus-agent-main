import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	type CiWorkflowContractIssue,
	dedupeIssues,
	firstStepIndexContaining,
	gh,
	globPackageJsons,
	jobSteps,
	objectValue,
	pnpmVersion,
	prChecksWorkflow,
	prJobSteps,
	readJson,
	readYaml,
	relativePosix,
	requiredGolangciLintInstall,
	requiredUvSetup,
	runTextContainsCommand,
	scheduledHealthWorkflow,
	stringValue,
	workflowJobSteps,
	workflowPaths,
	workflowSteps,
} from "./lib.ts";
import { auditManualReleaseWorkflowContracts } from "./manual.ts";

export const requiredCiScriptTokens = new Map<string, string[]>([
	[
		"ci:repo",
		[
			"pnpm repo:guard",
			"pnpm exec tsx scripts/check_repo_static.ts --affected",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: checking literal shell fallback syntax in package.json.
			'--base "${CI_BASE_REF:-origin/main}"',
		],
	],
	["ci:repo:full", ["pnpm repo:guard", "pnpm repo:static"]],
	[
		"ci:contracts",
		[
			"pnpm --filter campus-contracts typecheck",
			"pnpm --filter campus-contracts test",
			"pnpm contracts:check",
			"uv run --package campus-contracts python -m unittest discover -s packages/contracts/tests",
			"-t packages/contracts",
		],
	],
	[
		"ci:ingest",
		[
			"pnpm --filter ingestion-contracts typecheck",
			"pnpm --filter ingestion-contracts test",
			"uv run --package campus-ingestion-contracts python -m unittest discover -s packages/ingestion-contracts/tests",
			"-t packages/ingestion-contracts",
		],
	],
	[
		"ci:eval",
		[
			"pnpm --dir packages/eval-langfuse typecheck",
			"pnpm --dir packages/eval-langfuse test",
			"pnpm --dir packages/eval-langfuse exec tsx src/cli.ts audit --json",
			"uv run --package campus-ragas-runner python -m unittest discover -s packages/ragas-runner/tests",
			"pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/telemetry.index.test.ts",
		],
	],
	["ci:web", ["turbo run typecheck test --affected --concurrency=2"]],
	["ci:web:full", ["pnpm web:check"]],
	[
		"ci:worker",
		[
			"pnpm web:test:worker",
			"pnpm --dir apps/app-api exec wrangler deploy --dry-run",
			"pnpm --dir apps/campus-web build:app",
			"pnpm --dir apps/operator-console-web build",
		],
	],
	[
		"ci:config",
		[
			"pnpm ci:actions:lint",
			"uvx zizmor --min-severity=medium .github",
			"pnpm exec tsx scripts/check_repo_static.ts --ci-workflows",
		],
	],
	["ci:actions:lint", ["go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7"]],
	[
		"ci:deps",
		[
			"go run github.com/google/osv-scanner/v2/cmd/osv-scanner@v2.3.8 scan source",
			"--lockfile pnpm-lock.yaml",
			"--lockfile uv.lock",
		],
	],
]);

export const requiredWorkflowScriptCalls = new Map<string, string[]>([
	[
		prChecksWorkflow,
		[
			"pnpm ci:repo",
			"pnpm ci:repo:full",
			"pnpm ci:config",
			"pnpm ci:web",
			"pnpm ci:worker",
			"pnpm ci:contracts",
			"pnpm ci:go",
			"pnpm ci:eval",
			"pnpm ci:ingest",
		],
	],
]);

const requiredScheduledHealthCalls = [
	"pnpm ci:repo:full",
	"pnpm repo:self-test",
	"pnpm ci:web:full",
	"pnpm ci:contracts",
	"pnpm ci:ingest",
	"pnpm ci:eval",
	"pnpm ci:go",
];

const deployStagingWorkflow = ".github/workflows/deploy-staging.yml";

const requiredDeployStagingEnvRefs = new Map<string, string>([
	["CLOUDFLARE_ACCOUNT_ID", gh("vars.CLOUDFLARE_ACCOUNT_ID")],
	["CLOUDFLARE_API_TOKEN", gh("secrets.CLOUDFLARE_API_TOKEN")],
	["STAGING_ACCESS_POLICY_AUD", gh("vars.STAGING_ACCESS_POLICY_AUD")],
	["STAGING_ACCESS_TEAM_DOMAIN", gh("vars.STAGING_ACCESS_TEAM_DOMAIN")],
	["STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY", gh("vars.STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY")],
]);

const forbiddenDeployStagingTokens = [
	"secrets.CLOUDFLARE_ACCOUNT_ID",
	"secrets.STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY",
	"secrets.STAGING_ACCESS_TEAM_DOMAIN",
	"secrets.STAGING_ACCESS_POLICY_AUD",
	"STAGING_APP_API_OPERATOR_DATABASE_URL",
	"STAGING_APP_API_DATABASE_SSLMODE",
	"STAGING_EXECUTION_CONTROL_BASE_URL",
	"STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_ID",
	"STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_SECRET",
] as const;

const requiredCiScripts = [
	"repo:guard",
	"repo:self-test",
	"repo:static",
	"repo:static:affected",
	"ci:repo",
	"ci:repo:full",
	"ci:contracts",
	"ci:ingest",
	"ci:eval",
	"ci:go",
	"ci:web",
	"ci:web:full",
	"ci:worker",
	"ci:config",
	"ci:actions:lint",
	"ci:deps",
] as const;

const forbiddenCiScripts = [
	"ci:repo-guard",
	"ci:repo-static",
	"ci:repo-static:affected",
	"ci:ingestion-contracts",
	"ci:python-islands",
	"ci:langfuse",
	"ci:web-graph:affected",
	"ci:web-graph:full",
	"ci:worker-runtime",
	"ci:config:lint",
	"ci:secrets",
	"ci:deps:vuln",
] as const;

const requiredPrJobs = [
	"changes",
	"repo",
	"secrets",
	"web",
	"worker",
	"contracts",
	"go",
	"eval",
	"ingest",
	"deps-pr",
	"deps-full",
	"required",
] as const;

const allowedWorkflowPaths = new Set([
	".github/workflows/deploy-staging.yml",
	".github/workflows/dining-sync-image.yml",
	".github/workflows/execution-runtime-image.yml",
	".github/workflows/pr.yml",
	".github/workflows/production-preflight.yml",
	".github/workflows/scheduled-health.yml",
	".github/workflows/scorecard.yml",
]);

const pathFilteredJobs = new Map<string, string>([
	["web", "web"],
	["worker", "worker"],
	["contracts", "contracts"],
	["go", "go"],
	["eval", "eval"],
	["ingest", "ingest"],
]);

export function auditCiWorkflowContracts(root: string): CiWorkflowContractIssue[] {
	const issues: CiWorkflowContractIssue[] = [];
	const rootPackage = readJson(join(root, "package.json"));
	const rootPnpmVersion = pnpmVersion(stringValue(rootPackage.packageManager));
	if (rootPnpmVersion === "") {
		issues.push({ path: "package.json", message: "root packageManager must use pnpm@<version>" });
	}

	const scripts = objectValue(rootPackage.scripts) ?? {};
	for (const scriptName of requiredCiScripts) {
		if (!(scriptName in scripts)) {
			issues.push({
				path: "package.json",
				message: `missing required CI lane script: ${scriptName}`,
			});
		}
	}
	for (const scriptName of forbiddenCiScripts) {
		if (scriptName in scripts) {
			issues.push({
				path: "package.json",
				message: `retired CI lane script must not be restored: ${scriptName}`,
			});
		}
	}
	for (const [scriptName, requiredTokens] of requiredCiScriptTokens) {
		const scriptValue = stringValue(scripts[scriptName]);
		if (!scriptValue) {
			continue;
		}
		for (const token of requiredTokens) {
			if (!scriptValue.includes(token)) {
				issues.push({
					path: "package.json",
					message: `${scriptName} must include required command token: ${token}`,
				});
			}
		}
	}

	if (rootPnpmVersion !== "") {
		issues.push(...auditPackageManagerVersions(root, rootPnpmVersion));
		issues.push(...auditWorkflowPnpmVersions(root, rootPnpmVersion));
	}
	issues.push(...auditWorkflowScriptCalls(root));
	issues.push(...auditScheduledHealthWorkflowCalls(root));
	issues.push(...auditAllowedWorkflowSurface(root));
	issues.push(...auditPrRequiredJobs(root));
	issues.push(...auditWorkflowConcurrency(root));
	issues.push(...auditPathFilteredJobs(root));
	issues.push(...auditPrAggregateJob(root));
	issues.push(...auditPrBaseShaFlow(root));
	issues.push(...auditWorkflowSetupCache(root));
	issues.push(...auditSecurityLaneTooling(root));
	issues.push(...auditGoLaneTooling(root));
	issues.push(...auditDeployStagingWorkflowEnv(root));
	issues.push(...auditManualReleaseWorkflowContracts(root));
	return dedupeIssues(issues);
}

function auditPackageManagerVersions(
	root: string,
	rootPnpmVersion: string,
): CiWorkflowContractIssue[] {
	const packagePaths = [
		...globPackageJsons(root, "apps"),
		...globPackageJsons(root, "jobs"),
		...globPackageJsons(root, "packages"),
		...globPackageJsons(root, "packages/domains"),
	];
	return [...new Set(packagePaths)].sort().flatMap((packagePath) => {
		const version = pnpmVersion(stringValue(readJson(packagePath).packageManager));
		if (version === "" || version === rootPnpmVersion) {
			return [];
		}
		return [
			{
				path: relativePosix(root, packagePath),
				message: `packageManager pnpm version ${version} does not match root ${rootPnpmVersion}`,
			},
		];
	});
}

function auditWorkflowPnpmVersions(
	root: string,
	rootPnpmVersion: string,
): CiWorkflowContractIssue[] {
	return workflowPaths(root).flatMap((workflowPath) =>
		workflowSteps(readYaml(workflowPath))
			.filter((step) => step.uses === "pnpm/action-setup@v6")
			.flatMap((step) => {
				const version = stringValue(objectValue(step.with)?.version).trim();
				return version === rootPnpmVersion
					? []
					: [
							{
								path: relativePosix(root, workflowPath),
								message: `pnpm/action-setup version ${version || "<missing>"} does not match root ${rootPnpmVersion}`,
							},
						];
			}),
	);
}

function auditWorkflowScriptCalls(root: string): CiWorkflowContractIssue[] {
	const issues: CiWorkflowContractIssue[] = [];
	for (const [workflowRelpath, requiredCalls] of requiredWorkflowScriptCalls) {
		const workflowPath = join(root, workflowRelpath);
		if (!existsSync(workflowPath)) {
			issues.push({ path: workflowRelpath, message: "required workflow is missing" });
			continue;
		}
		const runText = workflowSteps(readYaml(workflowPath))
			.map((step) => stringValue(step.run))
			.join("\n");
		for (const requiredCall of requiredCalls) {
			if (!runTextContainsCommand(runText, requiredCall)) {
				issues.push({
					path: workflowRelpath,
					message: `workflow does not call required script: ${requiredCall}`,
				});
			}
		}
	}
	return issues;
}

function auditScheduledHealthWorkflowCalls(root: string): CiWorkflowContractIssue[] {
	const workflowPath = join(root, scheduledHealthWorkflow);
	if (!existsSync(workflowPath)) {
		return [{ path: scheduledHealthWorkflow, message: "required workflow is missing" }];
	}
	const steps = workflowSteps(readYaml(workflowPath));
	const issues = requiredScheduledHealthCalls
		.filter((call) => !steps.some((step) => runTextContainsCommand(step.run, call)))
		.map((call) => ({
			path: scheduledHealthWorkflow,
			message: `scheduled health workflow does not call required script: ${call}`,
		}));
	const text = JSON.stringify(readYaml(workflowPath));
	if (
		!text.includes("google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@v2.3.8")
	) {
		issues.push({
			path: scheduledHealthWorkflow,
			message: "scheduled health workflow must run the OSV reusable dependency scan",
		});
	}
	return issues;
}

function auditAllowedWorkflowSurface(root: string): CiWorkflowContractIssue[] {
	return workflowPaths(root)
		.map((path) => relativePosix(root, path))
		.filter((path) => !allowedWorkflowPaths.has(path))
		.map((path) => ({ path, message: "workflow is not in the governed workflow surface" }));
}

function auditPrRequiredJobs(root: string): CiWorkflowContractIssue[] {
	const jobs = readWorkflowJobs(root, prChecksWorkflow);
	if (!jobs) {
		return [];
	}
	const missing = requiredPrJobs.filter((jobName) => !(jobName in jobs));
	return missing.length === 0
		? []
		: [
				{
					path: prChecksWorkflow,
					message: `pr workflow is missing required jobs: ${missing.join(", ")}`,
				},
			];
}

function auditWorkflowConcurrency(root: string): CiWorkflowContractIssue[] {
	const workflowPath = join(root, prChecksWorkflow);
	if (!existsSync(workflowPath)) {
		return [];
	}
	const concurrency = objectValue(readYaml(workflowPath).concurrency);
	if (!concurrency) {
		return [
			{
				path: prChecksWorkflow,
				message: "workflow must configure concurrency to cancel superseded runs",
			},
		];
	}
	return concurrency["cancel-in-progress"] === true
		? []
		: [
				{
					path: prChecksWorkflow,
					message: "workflow concurrency must set cancel-in-progress: true",
				},
			];
}

function auditPathFilteredJobs(root: string): CiWorkflowContractIssue[] {
	const jobs = readWorkflowJobs(root, prChecksWorkflow);
	if (!jobs) {
		return [];
	}
	const changesJob = objectValue(jobs.changes);
	const issues: CiWorkflowContractIssue[] = [];
	if (!changesJob) {
		return [
			{
				path: prChecksWorkflow,
				message: "pr workflow must define a changes job for path-filtered heavy lanes",
			},
		];
	}
	const outputs = objectValue(changesJob.outputs) ?? {};
	for (const [jobName, outputName] of pathFilteredJobs) {
		if (!(outputName in outputs)) {
			issues.push({
				path: prChecksWorkflow,
				message: `changes job must expose ${outputName} output for ${jobName}`,
			});
		}
		const job = objectValue(jobs[jobName]);
		if (!job) {
			issues.push({
				path: prChecksWorkflow,
				message: `workflow is missing path-filtered job: ${jobName}`,
			});
			continue;
		}
		if (job.needs !== "changes") {
			issues.push({ path: prChecksWorkflow, message: `${jobName} must depend on the changes job` });
		}
		const condition = stringValue(job.if).trim();
		if (!condition.includes(`needs.changes.outputs.${outputName} == 'true'`)) {
			issues.push({
				path: prChecksWorkflow,
				message: `${jobName} must be gated by ${outputName} changed-surface output`,
			});
		}
	}
	return issues;
}

function auditPrAggregateJob(root: string): CiWorkflowContractIssue[] {
	const jobs = readWorkflowJobs(root, prChecksWorkflow);
	if (!jobs) {
		return [];
	}
	const aggregate = objectValue(jobs.required);
	if (!aggregate) {
		return [{ path: prChecksWorkflow, message: "pr workflow must define required aggregate job" }];
	}
	const needs = Array.isArray(aggregate.needs) ? aggregate.needs.map(String) : [];
	const missing = Object.keys(jobs)
		.filter((jobName) => jobName !== "required")
		.sort()
		.filter((jobName) => !needs.includes(jobName));
	const issues: CiWorkflowContractIssue[] = [];
	if (missing.length > 0) {
		issues.push({
			path: prChecksWorkflow,
			message: `required must depend on every PR check job: ${missing.join(", ")}`,
		});
	}
	if (stringValue(aggregate.if).trim() !== "always()") {
		issues.push({
			path: prChecksWorkflow,
			message: "required must use if: always() so skipped conditional jobs are summarized",
		});
	}
	const runText = jobSteps(aggregate)
		.map((step) => stringValue(step.run))
		.join("\n");
	if (!runText.includes("success|skipped")) {
		issues.push({
			path: prChecksWorkflow,
			message: "required must accept only successful or skipped dependent jobs",
		});
	}
	return issues;
}

function auditPrBaseShaFlow(root: string): CiWorkflowContractIssue[] {
	const jobs = readWorkflowJobs(root, prChecksWorkflow);
	if (!jobs) {
		return [];
	}
	const changesOutputs = objectValue(objectValue(jobs.changes)?.outputs);
	const repoEnv = objectValue(objectValue(jobs.repo)?.env);
	const webEnv = objectValue(objectValue(jobs.web)?.env);
	const issues: CiWorkflowContractIssue[] = [];
	if (!(changesOutputs && "base_sha" in changesOutputs)) {
		issues.push({
			path: prChecksWorkflow,
			message: "changes job must expose base_sha for affected lanes",
		});
	}
	if (!repoEnv || repoEnv.CI_BASE_REF !== gh("needs.changes.outputs.base_sha")) {
		issues.push({
			path: prChecksWorkflow,
			message: "repo must pass changes base_sha through CI_BASE_REF",
		});
	}
	if (!webEnv || webEnv.TURBO_SCM_BASE !== gh("needs.changes.outputs.base_sha")) {
		issues.push({
			path: prChecksWorkflow,
			message: "web must pass changes base_sha through TURBO_SCM_BASE",
		});
	}
	return issues;
}

function auditWorkflowSetupCache(root: string): CiWorkflowContractIssue[] {
	const issues: CiWorkflowContractIssue[] = [];
	for (const workflowPath of workflowPaths(root)) {
		const workflow = readYaml(workflowPath);
		const relpath = relativePosix(root, workflowPath);
		for (const steps of workflowJobSteps(workflow)) {
			issues.push(...auditNodeSetupSteps(steps, relpath));
		}
		for (const step of workflowSteps(workflow)) {
			if (step.uses === requiredUvSetup && objectValue(step.with)?.["enable-cache"] !== true) {
				issues.push({ path: relpath, message: "astral-sh/setup-uv steps must enable uv cache" });
			}
		}
	}
	return dedupeIssues(issues);
}

function auditNodeSetupSteps(
	steps: Record<string, unknown>[],
	relpath: string,
): CiWorkflowContractIssue[] {
	const installsPnpm = steps.some((step) =>
		stringValue(step.run).includes("pnpm install --frozen-lockfile"),
	);
	let pnpmSetupSeen = false;
	const issues: CiWorkflowContractIssue[] = [];
	for (const step of steps) {
		const withBlock = objectValue(step.with);
		if (step.uses === "pnpm/action-setup@v6") {
			pnpmSetupSeen = true;
		}
		if (step.uses !== "actions/setup-node@v6") {
			continue;
		}
		const cacheEnabled = withBlock?.cache === "pnpm";
		if (installsPnpm && !cacheEnabled) {
			issues.push({
				path: relpath,
				message:
					"actions/setup-node steps must enable pnpm cache when the job installs the pnpm workspace",
			});
		} else if (!installsPnpm && cacheEnabled) {
			issues.push({
				path: relpath,
				message:
					"actions/setup-node must not enable pnpm cache when the job does not run pnpm install",
			});
		} else if (cacheEnabled && withBlock?.["cache-dependency-path"] !== "pnpm-lock.yaml") {
			issues.push({
				path: relpath,
				message: "actions/setup-node pnpm cache must use root pnpm-lock.yaml",
			});
		} else if (cacheEnabled && !pnpmSetupSeen) {
			issues.push({
				path: relpath,
				message:
					"pnpm/action-setup must run before actions/setup-node when setup-node enables pnpm cache",
			});
		}
	}
	return issues;
}

function auditSecurityLaneTooling(root: string): CiWorkflowContractIssue[] {
	const issues: CiWorkflowContractIssue[] = [];
	const prWorkflowText = JSON.stringify(readYaml(join(root, prChecksWorkflow)));
	for (const token of [
		"gitleaks/gitleaks-action@v3",
		"google/osv-scanner-action/.github/workflows/osv-scanner-reusable-pr.yml@v2.3.8",
		"google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@v2.3.8",
	]) {
		if (!prWorkflowText.includes(token)) {
			issues.push({
				path: prChecksWorkflow,
				message: `pr workflow missing security lane token: ${token}`,
			});
		}
	}
	return issues;
}

function auditGoLaneTooling(root: string): CiWorkflowContractIssue[] {
	const issues: CiWorkflowContractIssue[] = [];
	for (const [workflowRelpath, jobName] of [
		[prChecksWorkflow, "go"],
		[scheduledHealthWorkflow, "go"],
	] as const) {
		const steps =
			workflowRelpath === prChecksWorkflow
				? prJobSteps(root, jobName)
				: jobSteps(objectValue(readWorkflowJobs(root, workflowRelpath)?.[jobName]) ?? {});
		const installIndex = firstStepIndexContaining(steps, requiredGolangciLintInstall);
		const ciGoIndex = firstStepIndexContaining(steps, "pnpm ci:go");
		if (ciGoIndex !== undefined && !(installIndex !== undefined && installIndex < ciGoIndex)) {
			issues.push({
				path: workflowRelpath,
				message: `${jobName} must install golangci-lint v2.11.4 before pnpm ci:go`,
			});
		}
	}
	return issues;
}

function auditDeployStagingWorkflowEnv(root: string): CiWorkflowContractIssue[] {
	const workflowPath = join(root, deployStagingWorkflow);
	if (!existsSync(workflowPath)) {
		return [];
	}
	const workflow = readYaml(workflowPath);
	const deployJob = objectValue(objectValue(workflow.jobs)?.deploy);
	const env = objectValue(deployJob?.env) ?? {};
	const issues: CiWorkflowContractIssue[] = [];
	for (const [name, expected] of requiredDeployStagingEnvRefs) {
		const actual = stringValue(env[name]);
		if (actual !== expected) {
			issues.push({
				path: deployStagingWorkflow,
				message: `deploy staging env ${name} must be ${expected}`,
			});
		}
	}
	const workflowText = JSON.stringify(workflow);
	for (const token of forbiddenDeployStagingTokens) {
		if (workflowText.includes(token)) {
			issues.push({
				path: deployStagingWorkflow,
				message: `deploy staging workflow must not reference retired token: ${token}`,
			});
		}
	}
	return issues;
}

function readWorkflowJobs(
	root: string,
	workflowRelpath: string,
): Record<string, unknown> | undefined {
	const workflowPath = join(root, workflowRelpath);
	if (!existsSync(workflowPath)) {
		return;
	}
	return objectValue(readYaml(workflowPath).jobs);
}
