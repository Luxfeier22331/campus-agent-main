import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	isBiomePath,
	isContractScriptPath,
	isDecompositionPath,
	isDockerPath,
	isDoctorEnvPath,
	isEditorconfigPath,
	isEnvPath,
	isIngestionAssertionNamingPath,
	isIngestionTaskExecutabilityPath,
	isLangfuseEvalAuditPath,
	isLintCoveragePath,
	isMarkdownPath,
	isPackageScriptPolicyPath,
	isProjectionSyncHelperPath,
	isSqlPath,
	isTemporalStagingPreflightPath,
	isWorkerConfigSurfacePath,
} from "../affected_paths.ts";

export interface StaticCheck {
	label: string;
	command: string[];
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const ruffCommand = (...args: string[]): string[] => [
	"uv",
	"run",
	"--all-packages",
	"ruff",
	...args,
];

function tsxScript(script: string, ...args: string[]): string[] {
	return ["pnpm", "exec", "tsx", script, ...args];
}

function packageTsxScript(packagePath: string, script: string, ...args: string[]): string[] {
	return ["pnpm", "--dir", packagePath, "exec", "tsx", script, ...args];
}

const checkScripts = {
	ciWorkflows: "tools/repo-static/check_ci_workflows.ts",
	docsPolicy: "tools/repo-static/check_docs_policy.ts",
	envConfigPolicy: "tools/repo-static/check_env_config_policy.ts",
	formatPolicy: "tools/repo-static/check_format_policy.ts",
	ingestionPolicy: "tools/repo-static/check_ingestion_policy.ts",
	k8sGitopsPolicy: "tools/repo-static/check_k8s_gitops_policy.ts",
	lockfilePolicy: "tools/repo-static/check_lockfile_policy.ts",
	observabilityPolicy: "tools/repo-static/check_observability_policy.ts",
	publicReleasePolicy: "tools/repo-static/check_public_release_policy.ts",
	repoPolicy: "tools/repo-static/check_repo_policy.ts",
	runtimePolicy: "tools/repo-static/check_runtime_policy.ts",
} as const;

export function repoStaticChecks(): StaticCheck[] {
	return [
		{
			label: "format policy",
			command: tsxScript(checkScripts.formatPolicy),
		},
		{
			label: "docs policy",
			command: tsxScript(checkScripts.docsPolicy),
		},
		{
			label: "repo policy",
			command: tsxScript(checkScripts.repoPolicy),
		},
		{
			label: "env/config policy",
			command: tsxScript(checkScripts.envConfigPolicy),
		},
		{
			label: "k8s/gitops policy",
			command: tsxScript(checkScripts.k8sGitopsPolicy),
		},
		{
			label: "public release policy",
			command: tsxScript(checkScripts.publicReleasePolicy),
		},
		{
			label: "lockfile policy",
			command: tsxScript(checkScripts.lockfilePolicy),
		},
		{
			label: "ingestion policy",
			command: tsxScript(checkScripts.ingestionPolicy),
		},
		{
			label: "runtime policy",
			command: tsxScript(checkScripts.runtimePolicy),
		},
		{
			label: "observability policy",
			command: tsxScript(checkScripts.observabilityPolicy),
		},
		{ label: "ruff check", command: ruffCommand("check", ".") },
		{ label: "ruff format", command: ruffCommand("format", ".", "--check") },
		{
			label: "ci workflows",
			command: tsxScript(checkScripts.ciWorkflows),
		},
	];
}

export function affectedRepoStaticChecks(paths: string[]): StaticCheck[] {
	const checks: StaticCheck[] = [];
	if (paths.some(isBiomePath)) {
		checks.push({
			label: "format policy",
			command: tsxScript(checkScripts.formatPolicy),
		});
	}
	if (paths.some(isMarkdownPath)) {
		checks.push(
			{
				label: "format policy",
				command: tsxScript(checkScripts.formatPolicy),
			},
			{
				label: "docs policy",
				command: tsxScript(checkScripts.docsPolicy),
			},
		);
	}
	if (paths.some(isLintCoveragePath)) {
		checks.push({
			label: "repo policy",
			command: tsxScript(checkScripts.repoPolicy),
		});
	}
	if (paths.some(isDecompositionPath)) {
		checks.push({
			label: "repo policy",
			command: tsxScript(checkScripts.repoPolicy),
		});
	}
	if (paths.some(isEditorconfigPath)) {
		checks.push({
			label: "format policy",
			command: tsxScript(checkScripts.formatPolicy),
		});
	}
	if (paths.some((path) => isEnvPath(path) || path === checkScripts.envConfigPolicy)) {
		checks.push({
			label: "env/config policy",
			command: tsxScript(checkScripts.envConfigPolicy),
		});
	}
	if (
		paths.some((path) => path === checkScripts.envConfigPolicy || isWorkerConfigSurfacePath(path))
	) {
		checks.push({
			label: "env/config policy",
			command: tsxScript(checkScripts.envConfigPolicy),
		});
	}
	if (
		paths.some((path) => path.startsWith("infra/gitops/") || path === checkScripts.k8sGitopsPolicy)
	) {
		checks.push(
			{
				label: "k8s/gitops policy",
				command: tsxScript(checkScripts.k8sGitopsPolicy),
			},
			{
				label: "repo policy",
				command: tsxScript(checkScripts.repoPolicy),
			},
		);
	}
	if (
		paths.some(
			(path) =>
				path.startsWith("infra/local/") ||
				path.startsWith("infra/k8s/execution-runtime/") ||
				path.startsWith("infra/policies/") ||
				path === checkScripts.k8sGitopsPolicy ||
				path === checkScripts.repoPolicy,
		)
	) {
		checks.push(
			{
				label: "repo policy",
				command: tsxScript(checkScripts.repoPolicy),
			},
			{
				label: "k8s/gitops policy",
				command: tsxScript(checkScripts.k8sGitopsPolicy),
			},
		);
	}
	if (paths.some((path) => path.endsWith(".html"))) {
		checks.push({ label: "html tracked files", command: trackedTextFormatCommand("html") });
	}
	if (paths.some((path) => path.endsWith(".yaml") || path.endsWith(".yml"))) {
		checks.push({ label: "yaml tracked files", command: trackedTextFormatCommand("yaml") });
	}
	if (paths.some((path) => path.endsWith(".toml"))) {
		checks.push({ label: "toml syntax", command: trackedTextFormatCommand("toml") });
	}
	if (paths.some((path) => path.endsWith(".sh"))) {
		checks.push({
			label: "shell affected files",
			command: tsxScript("tools/repo-static/checks/check_shell_tracked.ts", "--affected", ...paths),
		});
	}
	if (paths.some((path) => path.endsWith(".xml"))) {
		checks.push({ label: "xml tracked files", command: trackedTextFormatCommand("xml") });
	}
	if (paths.some((path) => path.endsWith(".jsonl"))) {
		checks.push({ label: "jsonl tracked files", command: trackedTextFormatCommand("jsonl") });
	}
	if (paths.some(isSqlPath)) {
		checks.push({ label: "sql tracked files", command: trackedTextFormatCommand("sql") });
	}
	if (paths.some(isDockerPath)) {
		checks.push({
			label: "docker affected files",
			command: tsxScript(
				"tools/repo-static/checks/check_dockerfile_tracked.ts",
				"--affected",
				...paths,
			),
		});
	}
	if (paths.some((path) => path === "pnpm-lock.yaml" || path.endsWith("/pnpm-lock.yaml"))) {
		checks.push({
			label: "lockfile policy",
			command: tsxScript(checkScripts.lockfilePolicy),
		});
	}
	if (paths.includes("uv.lock")) {
		checks.push({
			label: "lockfile policy",
			command: tsxScript(checkScripts.lockfilePolicy),
		});
	}
	if (paths.some(isIngestionTaskExecutabilityPath)) {
		checks.push({
			label: "ingestion policy",
			command: tsxScript(checkScripts.ingestionPolicy),
		});
	}
	if (paths.some(isIngestionAssertionNamingPath)) {
		checks.push({
			label: "ingestion policy",
			command: tsxScript(checkScripts.ingestionPolicy),
		});
	}
	if (paths.some(isPackageScriptPolicyPath)) {
		checks.push({
			label: "repo policy",
			command: tsxScript(checkScripts.repoPolicy),
		});
	}
	if (paths.some(isProjectionSyncHelperPath)) {
		checks.push({
			label: "observability policy",
			command: tsxScript(checkScripts.observabilityPolicy),
		});
	}
	if (paths.some(isTemporalStagingPreflightPath)) {
		checks.push({
			label: "temporal staging preflight",
			command: tsxScript(
				"tools/repo-static/checks/check_temporal_staging_preflight.ts",
				"--self-test",
			),
		});
	}
	if (paths.some(isDoctorEnvPath)) {
		checks.push({
			label: "doctor env",
			command: tsxScript("scripts/deploy/doctor-env.ts", "--self-test"),
		});
	}
	if (paths.some(isLangfuseEvalAuditPath)) {
		checks.push({
			label: "langfuse eval audit",
			command: packageTsxScript("packages/eval-langfuse", "src/cli.ts", "self-test"),
		});
	}
	if (paths.some(isContractScriptPath)) {
		checks.push(
			{
				label: "runtime policy",
				command: tsxScript(checkScripts.runtimePolicy),
			},
			{
				label: "contract schema self-test",
				command: packageTsxScript(
					"packages/contracts",
					"./scripts/check_contract_schemas.ts",
					"--self-test",
				),
			},
			{
				label: "tool execution generator self-test",
				command: packageTsxScript(
					"packages/contracts",
					"./scripts/generate_tool_execution_contracts.ts",
					"--self-test",
				),
			},
		);
	}
	const pythonPaths = paths.filter((path) => path.endsWith(".py"));
	if (pythonPaths.length > 0) {
		checks.push(
			{ label: "ruff affected check", command: ruffCommand("check", ...pythonPaths) },
			{ label: "ruff affected format", command: ruffCommand("format", "--check", ...pythonPaths) },
		);
	}
	if (paths.some((path) => path.startsWith(".github/workflows/") || path === "package.json")) {
		checks.push({
			label: "ci workflows",
			command: tsxScript(checkScripts.ciWorkflows),
		});
	}
	return dedupeChecks(checks);
}

export function changedWorktreePaths(root = repoRoot, baseRef = "origin/main"): string[] {
	const mergeBase = gitStdout(["merge-base", baseRef, "HEAD"], root).trim();
	const candidates = [
		...gitStdout(["diff", "--name-only", "-z", `${mergeBase}..HEAD`], root).split("\0"),
		...gitStdout(["diff", "--name-only", "-z", "--cached"], root).split("\0"),
		...gitStdout(["diff", "--name-only", "-z"], root).split("\0"),
		...gitStdout(["ls-files", "-z", "--others", "--exclude-standard"], root).split("\0"),
	];
	const seen = new Set<string>();
	const paths: string[] = [];
	for (const candidate of candidates) {
		if (candidate === "" || seen.has(candidate)) {
			continue;
		}
		seen.add(candidate);
		if (existsSync(join(root, candidate))) {
			paths.push(candidate);
		}
	}
	return paths;
}

export function repoSelfTestChecks(): StaticCheck[] {
	return [
		{
			label: "repo static router",
			command: tsxScript("scripts/check_repo_static.ts", "--self-test"),
		},
		{
			label: "format policy",
			command: tsxScript(checkScripts.formatPolicy, "--self-test"),
		},
		{
			label: "docs policy",
			command: tsxScript(checkScripts.docsPolicy, "--self-test"),
		},
		{
			label: "repo policy",
			command: tsxScript(checkScripts.repoPolicy, "--self-test"),
		},
		{
			label: "package test layout",
			command: tsxScript("tools/repo-static/checks/check_package_test_layout.ts", "--self-test"),
		},
		{
			label: "local compose policy",
			command: tsxScript("tools/repo-static/checks/check_local_compose_policy.ts", "--self-test"),
		},
		{
			label: "env/config policy",
			command: tsxScript(checkScripts.envConfigPolicy, "--self-test"),
		},
		{
			label: "k8s/gitops policy",
			command: tsxScript(checkScripts.k8sGitopsPolicy, "--self-test"),
		},
		{
			label: "public release policy",
			command: tsxScript(checkScripts.publicReleasePolicy, "--self-test"),
		},
		{
			label: "lockfile policy",
			command: tsxScript(checkScripts.lockfilePolicy, "--self-test"),
		},
		{
			label: "ingestion policy",
			command: tsxScript(checkScripts.ingestionPolicy, "--self-test"),
		},
		{
			label: "runtime policy",
			command: tsxScript(checkScripts.runtimePolicy, "--self-test"),
		},
		{
			label: "observability policy",
			command: tsxScript(checkScripts.observabilityPolicy, "--self-test"),
		},
		{
			label: "ci workflows",
			command: tsxScript(checkScripts.ciWorkflows, "--self-test"),
		},
		{
			label: "ci changed surfaces",
			command: tsxScript("tools/repo-static/detect_changed_surfaces.ts", "--self-test"),
		},
		{ label: "repo guard", command: tsxScript("scripts/check_repo_guard.ts", "--self-test") },
		{
			label: "temporal staging preflight",
			command: tsxScript(
				"tools/repo-static/checks/check_temporal_staging_preflight.ts",
				"--self-test",
			),
		},
		{
			label: "doctor env",
			command: tsxScript("scripts/deploy/doctor-env.ts", "--self-test"),
		},
		{
			label: "langfuse eval audit",
			command: packageTsxScript("packages/eval-langfuse", "src/cli.ts", "self-test"),
		},
		{
			label: "contract schemas",
			command: packageTsxScript(
				"packages/contracts",
				"./scripts/check_contract_schemas.ts",
				"--self-test",
			),
		},
		{
			label: "tool execution generator",
			command: packageTsxScript(
				"packages/contracts",
				"./scripts/generate_tool_execution_contracts.ts",
				"--self-test",
			),
		},
	];
}

export function formatPolicyChecks(): StaticCheck[] {
	return [
		{
			label: "format policy",
			command: tsxScript(checkScripts.formatPolicy),
		},
	];
}

export function ciWorkflowChecks(): StaticCheck[] {
	return [
		{
			label: "ci workflows",
			command: tsxScript(checkScripts.ciWorkflows),
		},
	];
}

export function runStaticChecks({
	root = repoRoot,
	affected = false,
	baseRef = "origin/main",
	ciWorkflowsOnly = false,
	formatOnly = false,
	selfTestAll = false,
}: {
	root?: string;
	affected?: boolean;
	baseRef?: string;
	ciWorkflowsOnly?: boolean;
	formatOnly?: boolean;
	selfTestAll?: boolean;
} = {}): number {
	let checks = repoStaticChecks();
	if (selfTestAll) {
		checks = repoSelfTestChecks();
	} else if (formatOnly) {
		checks = formatPolicyChecks();
	} else if (ciWorkflowsOnly) {
		checks = ciWorkflowChecks();
	}
	if (affected) {
		const paths = changedWorktreePaths(root, baseRef);
		if (paths.length === 0) {
			console.log(`No changed files found against ${baseRef}; repo static affected lane skipped.`);
			return 0;
		}
		console.log(
			`Repo static affected lane found ${paths.length} changed files against ${baseRef}.`,
		);
		checks = affectedRepoStaticChecks(paths);
		if (checks.length === 0) {
			console.log("No repo static checks matched the affected file set.");
			return 0;
		}
	}
	for (const check of checks) {
		console.log(`==> ${check.label}`);
		const [command, ...args] = check.command;
		const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
		if (result.error) {
			console.error(result.error.message);
			return 1;
		}
		if (result.status !== 0) {
			return result.status ?? 1;
		}
	}
	return 0;
}

function gitStdout(args: string[], root: string): string {
	const result = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
		cwd: root,
		encoding: "utf8",
	});
	if (result.status !== 0) {
		throw new Error(String(result.stderr || result.stdout || `git ${args.join(" ")} failed`));
	}
	return result.stdout;
}

function dedupeChecks(checks: StaticCheck[]): StaticCheck[] {
	const seen = new Set<string>();
	const result: StaticCheck[] = [];
	for (const check of checks) {
		const key = JSON.stringify(check.command);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(check);
	}
	return result;
}

function trackedTextFormatCommand(textFormat: string): string[] {
	return tsxScript(
		"tools/repo-static/checks/check_tracked_text_formats.ts",
		"--format",
		textFormat,
	);
}

function runSelfTest(): number {
	const commandKeysFor = (paths: string[]) =>
		new Set(affectedRepoStaticChecks(paths).map((check) => check.command.join(" ")));
	const checkCommand = (script: string) => tsxScript(script).join(" ");
	const conversationCommands = commandKeysFor([
		"apps/campus-web/src/features/conversation/assistant-ui-runtime.tsx",
		"apps/campus-web/e2e/qa.spec.ts",
	]);
	assert(conversationCommands.has(checkCommand(checkScripts.formatPolicy)));
	assert(conversationCommands.has(checkCommand(checkScripts.repoPolicy)));
	const k8sCommands = commandKeysFor([
		"infra/k8s/execution-runtime/overlays/nc-arm-6c-staging-full/kustomization.yaml",
	]);
	assert(k8sCommands.has(checkCommand(checkScripts.repoPolicy)));
	assert(k8sCommands.has(checkCommand(checkScripts.k8sGitopsPolicy)));
	assert(
		commandKeysFor(["infra/local/docker-compose.postgres.yml"]).has(
			checkCommand(checkScripts.repoPolicy),
		),
	);
	const gitopsCommands = commandKeysFor(["infra/gitops/secrets/runtime.sealedsecret.yaml"]);
	assert(gitopsCommands.has(checkCommand(checkScripts.k8sGitopsPolicy)));
	assert(
		commandKeysFor(["configs/runtime/tools.v4.json"]).has(checkCommand(checkScripts.runtimePolicy)),
	);
	assert(commandKeysFor(["apps/app-api/package.json"]).has(checkCommand(checkScripts.repoPolicy)));
	console.log("check_repo_static self-test passed.");
	return 0;
}

function parseArgs(argv: string[]): {
	affected: boolean;
	baseRef: string;
	ciWorkflowsOnly: boolean;
	formatOnly: boolean;
	selfTest: boolean;
	selfTestAll: boolean;
} {
	let affected = false;
	let baseRef = "origin/main";
	let ciWorkflowsOnly = false;
	let formatOnly = false;
	let selfTest = false;
	let selfTestAll = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--affected") {
			affected = true;
			continue;
		}
		if (arg === "--base") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("--base requires a value");
			}
			baseRef = value;
			index += 1;
			continue;
		}
		if (arg === "--self-test") {
			selfTest = true;
			continue;
		}
		if (arg === "--self-test-all") {
			selfTestAll = true;
			continue;
		}
		if (arg === "--format") {
			formatOnly = true;
			continue;
		}
		if (arg === "--ci-workflows") {
			ciWorkflowsOnly = true;
			continue;
		}
		throw new Error(`unsupported argument: ${arg}`);
	}
	return { affected, baseRef, ciWorkflowsOnly, formatOnly, selfTest, selfTestAll };
}

export function main(argv: string[]): number {
	const args = parseArgs(argv);
	if (args.selfTest) {
		return runSelfTest();
	}
	return runStaticChecks({
		affected: args.affected,
		baseRef: args.baseRef,
		ciWorkflowsOnly: args.ciWorkflowsOnly,
		formatOnly: args.formatOnly,
		selfTestAll: args.selfTestAll,
	});
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
