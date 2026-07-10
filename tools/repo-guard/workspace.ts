import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { directoryNames, issue, type RepoGuardIssue, readText, relativePosix } from "./common.ts";

const expectedWorkspaces = new Set([
	"apps/agent-runtime",
	"apps/app-api",
	"apps/campus-web",
	"apps/execution-control",
	"apps/ingestion-control",
	"apps/operator-console-web",
	"apps/source-collector",
	"jobs/dining-sync",
	"jobs/learning-loop-candidates",
	"packages/contracts",
	"packages/domains/dining",
	"packages/eval-langfuse",
	"packages/ingest-core",
	"packages/ingestion-contracts",
	"packages/ragas-runner",
]);
const allowedAppDirs = new Set([
	"agent-runtime",
	"app-api",
	"campus-web",
	"execution-control",
	"ingestion-control",
	"operator-console-web",
	"source-collector",
]);
const allowedJobDirs = new Set(["dining-sync", "learning-loop-candidates"]);
const allowedUvWorkspaceMembers = [
	"packages/contracts",
	"packages/ingestion-contracts",
	"packages/ragas-runner",
];
const allowedUvLockManifestMembers = new Set([
	"campus-agent-workspace",
	"campus-contracts",
	"campus-ingestion-contracts",
	"campus-ragas-runner",
]);
const allowedTopLevelPackageDirs = new Set([
	"contracts",
	"domains",
	"eval-langfuse",
	"ingest-core",
	"ingestion-contracts",
	"ingestion-kernels-rs",
	"ragas-runner",
]);
const allowedDomainPackageDirs = new Set(["dining"]);
const allowedToolDirs = new Set(["lib", "repo-guard", "repo-static"]);

const appApiForbiddenCollectorReferences = [
	"apps/authenticated-notice-collector/src",
	"apps/official-web-collector/src",
	"apps/wechat-official-account-collector/src",
	"authenticated-notice-collector/src",
	"official-web-collector/src",
	"wechat-official-account-collector/src",
	"pnpm --filter authenticated-notice-collector",
	"pnpm --filter official-web-collector",
	"pnpm --filter wechat-official-account-collector",
	"pnpm --dir apps/authenticated-notice-collector",
	"pnpm --dir apps/official-web-collector",
	"pnpm --dir apps/wechat-official-account-collector",
];

const appApiTextSuffixes = new Set([".json", ".md", ".mjs", ".mts", ".ts", ".tsx"]);
const tsOnlyScriptRoots = [
	"scripts",
	"apps/app-api/scripts",
	"apps/campus-web/scripts",
	"apps/operator-console-web/scripts",
];
const forbiddenCommonScriptSuffixes = [".py", ".mjs", ".d.mts"];
const allowedTopLevelScriptFiles = new Set(["check_repo_guard.ts", "check_repo_static.ts"]);

export function auditWorkspaceGuard(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	for (const workspace of expectedWorkspaces) {
		if (!existsSync(join(root, workspace))) {
			issues.push(issue(workspace, "expected workspace directory is missing"));
		}
	}
	issues.push(...auditUvWorkspaceMembers(root));
	issues.push(...auditAppBoundaries(root));
	issues.push(...auditJobBoundaries(root));
	issues.push(...auditTopLevelPackageBoundaries(root));
	issues.push(...auditDomainPackageBoundaries(root));
	issues.push(...auditToolBoundaries(root));
	issues.push(...auditCommonScriptLanguage(root));
	issues.push(...auditTopLevelScriptEntrypoints(root));
	issues.push(...auditRootPythonTestBoundaries(root));
	issues.push(...auditAppApiCollectorBoundary(root));
	return issues;
}

function auditToolBoundaries(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	const toolsRoot = join(root, "tools");
	if (!existsSync(toolsRoot)) {
		return issues;
	}
	for (const entry of readdirSync(toolsRoot, { withFileTypes: true })) {
		if (!(entry.isDirectory() && allowedToolDirs.has(entry.name))) {
			issues.push(
				issue(
					`tools/${entry.name}`,
					"tools may only contain admitted repo-internal governance/checker paths",
				),
			);
		}
	}
	return issues;
}

function auditAppBoundaries(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	for (const name of directoryNames(join(root, "apps"))) {
		if (!hasRuntimeManifest(root, "apps", name)) {
			continue;
		}
		if (!allowedAppDirs.has(name)) {
			issues.push(
				issue(
					`apps/${name}`,
					"app runtime boundary is not admitted; add architecture ownership before adding apps entries",
				),
			);
		}
	}
	return issues;
}

function auditJobBoundaries(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	for (const name of directoryNames(join(root, "jobs"))) {
		if (!hasRuntimeManifest(root, "jobs", name)) {
			continue;
		}
		if (!allowedJobDirs.has(name)) {
			issues.push(
				issue(
					`jobs/${name}`,
					"job runtime boundary is not admitted; add architecture ownership before adding jobs entries",
				),
			);
		}
	}
	return issues;
}

function hasRuntimeManifest(root: string, parent: "apps" | "jobs", name: string): boolean {
	const path = join(root, parent, name);
	return ["package.json", "go.mod", "Cargo.toml", "wrangler.jsonc"].some((file) =>
		existsSync(join(path, file)),
	);
}

function auditTopLevelPackageBoundaries(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	for (const name of directoryNames(join(root, "packages"))) {
		if (allowedTopLevelPackageDirs.has(name)) {
			continue;
		}
		issues.push(
			issue(
				`packages/${name}`,
				"top-level packages must be admitted stable package boundaries; domain code belongs under packages/domains",
			),
		);
	}
	return issues;
}

function auditDomainPackageBoundaries(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	const domainsRoot = join(root, "packages/domains");
	for (const name of directoryNames(domainsRoot)) {
		const path = `packages/domains/${name}`;
		if (!allowedDomainPackageDirs.has(name)) {
			issues.push(
				issue(
					path,
					"domain packages must be explicitly admitted; add docs/data/contracts ownership before adding a packages/domains entry",
				),
			);
			continue;
		}
		for (const requiredFile of ["package.json", "tsconfig.json", "vitest.config.mts"]) {
			if (!existsSync(join(root, path, requiredFile))) {
				issues.push(issue(`${path}/${requiredFile}`, "admitted domain package file is missing"));
			}
		}
	}
	return issues;
}

function auditTopLevelScriptEntrypoints(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	for (const path of walkTopLevelFiles(join(root, "scripts"))) {
		const fileName = path.slice(path.lastIndexOf("/") + 1);
		if (allowedTopLevelScriptFiles.has(fileName)) {
			continue;
		}
		issues.push(
			issue(
				`scripts/${fileName}`,
				"top-level scripts are reserved for public entrypoints; put checks and helper scripts in a categorized scripts subdirectory",
			),
		);
	}
	return issues;
}

function walkTopLevelFiles(root: string): string[] {
	if (!existsSync(root)) {
		return [];
	}
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
		entry.isFile() ? [join(root, entry.name)] : [],
	);
}

function auditUvWorkspaceMembers(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	const pyproject = parseToml(readText(join(root, "pyproject.toml"))) as Record<string, unknown>;
	const members = workspaceMembers(pyproject);
	const expected = new Set(allowedUvWorkspaceMembers);
	for (const member of members) {
		if (!expected.has(member)) {
			issues.push(
				issue(
					"pyproject.toml",
					`uv workspace member is not an admitted Python package/runtime boundary: ${member}`,
				),
			);
		}
	}
	for (const member of allowedUvWorkspaceMembers) {
		if (!members.has(member)) {
			issues.push(issue("pyproject.toml", `expected uv workspace member is missing: ${member}`));
		}
	}
	const uvLock = parseToml(readText(join(root, "uv.lock"))) as Record<string, unknown>;
	const lockMembers = uvLockManifestMembers(uvLock);
	for (const member of lockMembers) {
		if (!allowedUvLockManifestMembers.has(member)) {
			issues.push(
				issue(
					"uv.lock",
					`uv lock manifest member is not an admitted Python package/runtime boundary: ${member}`,
				),
			);
		}
	}
	for (const member of allowedUvLockManifestMembers) {
		if (!lockMembers.has(member)) {
			issues.push(issue("uv.lock", `expected uv lock manifest member is missing: ${member}`));
		}
	}
	return issues;
}

function workspaceMembers(pyproject: Record<string, unknown>): Set<string> {
	const tool = recordValue(pyproject.tool);
	const uv = recordValue(tool?.uv);
	const workspace = recordValue(uv?.workspace);
	const members = Array.isArray(workspace?.members) ? workspace.members : [];
	return new Set(members.filter((item): item is string => typeof item === "string"));
}

function uvLockManifestMembers(uvLock: Record<string, unknown>): Set<string> {
	const manifest = recordValue(uvLock.manifest);
	const members = Array.isArray(manifest?.members) ? manifest.members : [];
	return new Set(members.filter((item): item is string => typeof item === "string"));
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function auditRootPythonTestBoundaries(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	for (const path of walkFiles(join(root, "tests"))) {
		const relativePath = relativePosix(root, path);
		if (!relativePath.endsWith(".py")) {
			continue;
		}
		issues.push(
			issue(
				relativePath,
				"root Python tests must stay scoped to admitted Python package/runtime islands; repo governance and common tooling tests belong in TS",
			),
		);
	}
	return issues;
}

function auditCommonScriptLanguage(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	for (const scriptRoot of tsOnlyScriptRoots) {
		for (const path of walkFiles(join(root, scriptRoot))) {
			const relativePath = path.slice(root.length + 1).replaceAll("\\", "/");
			if (forbiddenCommonScriptSuffixes.some((suffix) => relativePath.endsWith(suffix))) {
				issues.push(
					issue(
						relativePath,
						"repo governance and common app scripts must be TypeScript; keep Python only in explicit Python package/runtime boundaries",
					),
				);
			}
		}
	}
	return issues;
}

function auditAppApiCollectorBoundary(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	const appApiRoot = join(root, "apps/app-api");
	for (const path of walkAppApiFiles(appApiRoot)) {
		if (!appApiTextSuffixes.has(suffix(path))) {
			continue;
		}
		const text = readText(path);
		const relativePath = path.slice(root.length + 1).replaceAll("\\", "/");
		for (const forbidden of appApiForbiddenCollectorReferences) {
			if (text.includes(forbidden)) {
				issues.push(
					issue(
						relativePath,
						`app-api must not depend on collector runtime entrypoint: ${forbidden}`,
					),
				);
			}
		}
	}
	return issues;
}

function walkFiles(root: string): string[] {
	if (!existsSync(root)) {
		return [];
	}
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			return walkFiles(path);
		}
		return entry.isFile() ? [path] : [];
	});
}

const walkAppApiFiles = walkFiles;

function suffix(path: string): string {
	const index = path.lastIndexOf(".");
	return index === -1 ? "" : path.slice(index);
}
