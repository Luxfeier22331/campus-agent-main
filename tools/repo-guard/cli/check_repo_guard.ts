import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditCollaborationGuard } from "../collaboration.ts";
import type { RepoGuardIssue } from "../common.ts";
import { auditRepoConfigGuard, auditRuntimeArtifactStatusLanguage } from "../config.ts";
import { auditDocsGuard } from "../docs.ts";
import { auditExecutionGuard } from "../execution.ts";
import { auditWorkspaceGuard } from "../workspace.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

export function auditRepoGuard(root = repoRoot): RepoGuardIssue[] {
	return [
		...auditDocsGuard(root),
		...auditWorkspaceGuard(root),
		...auditCollaborationGuard(root),
		...auditRepoConfigGuard(root),
		...auditExecutionGuard(root),
	].sort((left, right) =>
		`${left.path}\0${left.message}`.localeCompare(`${right.path}\0${right.message}`),
	);
}

function runSelfTest(): number {
	const currentIssues = auditRepoGuard(repoRoot);
	if (currentIssues.length > 0) {
		throw new Error(`current repo guard should pass, got ${JSON.stringify(currentIssues)}`);
	}
	withFixture((root) => {
		writeText(
			join(root, "pyproject.toml"),
			`[tool.uv.workspace]
members = [
  "packages/contracts",
  "packages/ingestion-contracts",
	  "packages/ragas-runner",
	  "apps/app-api",
]
`,
		);
		writeText(join(root, "uv.lock"), '[manifest]\nmembers = ["campus-app-api"]\n');
		writeText(join(root, "scripts/old-helper.mjs"), "console.log('old helper');\n");
		writeText(join(root, "apps/app-api/scripts/old-helper.py"), "print('old helper')\n");
		writeText(join(root, "tests/test_old_governance.py"), "def test_old_governance():\n    pass\n");
		const issues = auditWorkspaceGuard(root);
		expectIssue(
			issues,
			{
				path: "scripts/old-helper.mjs",
				message:
					"repo governance and common app scripts must be TypeScript; keep Python only in explicit Python package/runtime boundaries",
			},
			"common script language guard",
		);
		expectIssue(
			issues,
			{
				path: "apps/app-api/scripts/old-helper.py",
				message:
					"repo governance and common app scripts must be TypeScript; keep Python only in explicit Python package/runtime boundaries",
			},
			"common app script language guard",
		);
		expectIssue(
			issues,
			{
				path: "pyproject.toml",
				message:
					"uv workspace member is not an admitted Python package/runtime boundary: apps/app-api",
			},
			"uv workspace member guard",
		);
		expectIssue(
			issues,
			{
				path: "uv.lock",
				message:
					"uv lock manifest member is not an admitted Python package/runtime boundary: campus-app-api",
			},
			"uv lock manifest guard",
		);
		expectIssue(
			issues,
			{
				path: "uv.lock",
				message: "expected uv lock manifest member is missing: campus-agent-workspace",
			},
			"uv lock required workspace member guard",
		);
		expectIssue(
			issues,
			{
				path: "tests/test_old_governance.py",
				message:
					"root Python tests must stay scoped to admitted Python package/runtime islands; repo governance and common tooling tests belong in TS",
			},
			"root Python governance test guard",
		);
	});
	withFixture((root) => {
		writeDefaultPythonWorkspace(root);
		writeText(join(root, "uv.lock"), defaultUvLockManifest());
		writeText(join(root, "packages", "unknown-package", "package.json"), "{}\n");
		const issues = auditWorkspaceGuard(root);
		expectIssue(
			issues,
			{
				path: "packages/unknown-package",
				message:
					"top-level packages must be admitted stable package boundaries; domain code belongs under packages/domains",
			},
			"unadmitted top-level package guard",
		);
	});
	withFixture((root) => {
		writeDefaultPythonWorkspace(root);
		writeText(join(root, "uv.lock"), defaultUvLockManifest());
		writeText(join(root, "tools", "deploy", "legacy.ts"), "export {};\n");
		writeText(join(root, "tools", "legacy.ts"), "export {};\n");
		const issues = auditWorkspaceGuard(root);
		expectIssue(
			issues,
			{
				path: "tools/deploy",
				message: "tools may only contain admitted repo-internal governance/checker paths",
			},
			"unadmitted tools boundary guard",
		);
		expectIssue(
			issues,
			{
				path: "tools/legacy.ts",
				message: "tools may only contain admitted repo-internal governance/checker paths",
			},
			"top-level tools file guard",
		);
	});
	withFixture((root) => {
		writeDefaultPythonWorkspace(root);
		writeText(join(root, "uv.lock"), defaultUvLockManifest());
		writeText(join(root, "apps", "unknown-runtime", "package.json"), "{}\n");
		const issues = auditWorkspaceGuard(root);
		expectIssue(
			issues,
			{
				path: "apps/unknown-runtime",
				message:
					"app runtime boundary is not admitted; add architecture ownership before adding apps entries",
			},
			"unadmitted app boundary guard",
		);
	});
	withFixture((root) => {
		writeDefaultPythonWorkspace(root);
		writeText(join(root, "uv.lock"), defaultUvLockManifest());
		writeText(join(root, "jobs", "unknown-job", "package.json"), "{}\n");
		const issues = auditWorkspaceGuard(root);
		expectIssue(
			issues,
			{
				path: "jobs/unknown-job",
				message:
					"job runtime boundary is not admitted; add architecture ownership before adding jobs entries",
			},
			"unadmitted job boundary guard",
		);
	});
	withFixture((root) => {
		writeDefaultPythonWorkspace(root);
		writeText(join(root, "packages", "domains", "navigation", "package.json"), "{}\n");
		const issues = auditWorkspaceGuard(root);
		expectIssue(
			issues,
			{
				path: "packages/domains/navigation",
				message:
					"domain packages must be explicitly admitted; add docs/data/contracts ownership before adding a packages/domains entry",
			},
			"unadmitted domain package guard",
		);
	});
	withFixture((root) => {
		writeDefaultPythonWorkspace(root);
		writeText(join(root, "packages", "domains", "dining", "package.json"), "{}\n");
		writeText(join(root, "packages", "domains", "dining", "tsconfig.json"), "{}\n");
		const issues = auditWorkspaceGuard(root);
		expectIssue(
			issues,
			{
				path: "packages/domains/dining/vitest.config.mts",
				message: "admitted domain package file is missing",
			},
			"admitted domain package required files guard",
		);
	});
	withFixture((root) => {
		writeText(
			join(root, "configs", "runtime", "workflow-artifacts.v2.json"),
			'{"support_status_values":["planned_contract_gap"],"notes":"future rollout"}\n',
		);
		const issues = auditRuntimeArtifactStatusLanguage(root);
		expectIssue(
			issues,
			{
				path: "configs/runtime/workflow-artifacts.v2.json",
				message:
					"runtime artifact support status must use closed_no_runtime, not planned gap wording",
			},
			"runtime artifact status language guard",
		);
		expectIssue(
			issues,
			{
				path: "configs/runtime/workflow-artifacts.v2.json",
				message: "runtime artifact notes must describe current support, not future rollout plans",
			},
			"runtime artifact future rollout language guard",
		);
	});
	console.log("check_repo_guard self-test passed.");
	return 0;
}

function writeDefaultPythonWorkspace(root: string): void {
	writeText(
		join(root, "pyproject.toml"),
		`[tool.uv.workspace]
members = [
	  "packages/contracts",
	  "packages/ingestion-contracts",
	  "packages/ragas-runner",
	]
`,
	);
	writeText(join(root, "uv.lock"), defaultUvLockManifest());
}

function defaultUvLockManifest(): string {
	return `[manifest]
members = [
	"campus-agent-workspace",
	"campus-contracts",
	"campus-ingestion-contracts",
	"campus-ragas-runner",
]
`;
}

function expectIssue(issues: RepoGuardIssue[], expected: RepoGuardIssue, label: string): void {
	if (!issues.some((issue) => issue.path === expected.path && issue.message === expected.message)) {
		throw new Error(
			`${label} missing expected issue ${JSON.stringify(expected)} in ${JSON.stringify(issues)}`,
		);
	}
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "repo-guard-"));
	try {
		callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeText(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, "utf8");
}

export function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const issues = auditRepoGuard();
	if (issues.length > 0) {
		console.error("Repo guard check failed:");
		for (const item of issues) {
			console.error(`- ${item.path}: ${item.message}`);
		}
		return 1;
	}
	console.log("Validated repo guard.");
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
