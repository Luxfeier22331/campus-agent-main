import { existsSync } from "node:fs";
import { basename, extname, relative } from "node:path";
import { worktreePaths } from "../../lib/worktree-paths.ts";

const binarySuffixes = new Set([
	".avif",
	".gif",
	".ico",
	".jpeg",
	".jpg",
	".pdf",
	".png",
	".svg",
	".webp",
]);
const dockerNames = new Set([".hadolint.yaml"]);
const editorconfigNames = new Set([".editorconfig", ".gitattributes", ".gitignore"]);
const envSuffixes = [".env.example", ".local.example", ".dev.vars.example"];
const handwrittenDecompositionSuffixes = new Set([
	".cjs",
	".go",
	".js",
	".jsx",
	".mjs",
	".py",
	".ts",
	".tsx",
]);
const jsLikeSuffixes = new Set([
	".cjs",
	".css",
	".js",
	".json",
	".jsonc",
	".jsx",
	".mjs",
	".mts",
	".ts",
	".tsx",
]);
const markdownRootFiles = new Set([
	".github/pull_request_template.md",
	"AGENTS.md",
	"CODE_OF_CONDUCT.md",
	"CONTRIBUTING.md",
	"README.md",
	"SECURITY.md",
	"SUPPORT.md",
	"THIRD_PARTY_NOTICES.md",
]);
const rootBiomeFiles = new Set([
	".markdownlint-cli2.jsonc",
	"biome.jsonc",
	"package.json",
	"turbo.json",
]);
const rootLockFiles = new Set(["pnpm-lock.yaml", "uv.lock"]);
const rootSqlLintFiles = new Set([".sqlfluff"]);
const textLikeSuffixes = new Set([
	".cjs",
	".css",
	".env",
	".example",
	".go",
	".gitignore",
	".html",
	".java",
	".js",
	".json",
	".jsonc",
	".jsonl",
	".jsx",
	".md",
	".mdx",
	".mjs",
	".mts",
	".py",
	".sh",
	".sql",
	".toml",
	".ts",
	".tsx",
	".xml",
	".yaml",
	".yml",
]);
const webLintPrefixes = [
	"apps/",
	"configs/",
	"docs/reference/eval/",
	"jobs/",
	"packages/",
	"scripts/",
	"tests/",
	"tools/",
];
const repoStaticOnlyScripts = new Set([
	"tools/repo-static/checks/check_dependency_license_policy.ts",
	"tools/repo-static/checks/check_object_store_bucket_policy.ts",
	"tools/repo-static/checks/check_open_source_metadata.ts",
	"tools/repo-static/checks/check_public_asset_source_clean.ts",
	"tools/repo-static/checks/check_public_fixture_source_clean.ts",
	"tools/repo-static/checks/check_public_source_tokens.ts",
]);
const lintCandidatePathspecs = [
	"apps",
	"configs",
	"docs",
	"infra",
	"jobs",
	"packages",
	"scripts",
	"tests",
	"tools",
	".github",
	"AGENTS.md",
	"CODE_OF_CONDUCT.md",
	"CONTRIBUTING.md",
	"README.md",
	"SECURITY.md",
	"SUPPORT.md",
	"THIRD_PARTY_NOTICES.md",
	"package.json",
	"pnpm-lock.yaml",
	"uv.lock",
	"turbo.json",
	"biome.jsonc",
	".markdownlint-cli2.jsonc",
	".editorconfig",
	".gitattributes",
	".gitignore",
	".sqlfluff",
];

export function trackedLintCandidatePaths(root: string): string[] {
	return worktreePaths(root, lintCandidatePathspecs)
		.map((path) => relative(root, path).replaceAll("\\", "/"))
		.filter((path) => isLintCandidatePath(path) && existsSync(`${root}/${path}`))
		.sort();
}

export function trackedHandwrittenCodePaths(root: string): string[] {
	return trackedLintCandidatePaths(root).filter(isHandwrittenCodePath);
}

export function isHandwrittenCodePath(path: string): boolean {
	return (
		lintExclusionReason(path) === undefined && handwrittenDecompositionSuffixes.has(suffix(path))
	);
}

export function lintExclusionReason(path: string): string | undefined {
	if (path.startsWith(".planning/")) {
		return "planning_artifact";
	}
	if (path.startsWith(".tmp/")) {
		return "temporary_workspace_artifact";
	}
	if (path.startsWith(".worktrees/")) {
		return "worktree_runtime_artifact";
	}
	if (path.startsWith("apps/app-api/drizzle/") && path.endsWith(".sql")) {
		return "generated_drizzle_migration";
	}
	if (path.startsWith("apps/app-api/drizzle/meta/")) {
		return "generated_drizzle_metadata";
	}
	if (path.startsWith("docs/reference/muc-campus-qa-frontend-design/")) {
		return "design_reference_asset_snapshot";
	}
	if (path.startsWith("docs/runbooks/muc-wiki-visual-modernization-assets/")) {
		return "runbook_visual_asset_snapshot";
	}
	if (path.startsWith("docs/") && path.includes("/archive/")) {
		return "archived_reference_documentation";
	}
	if (binarySuffixes.has(suffix(path))) {
		return "binary_asset";
	}
	return;
}

export function lintFamiliesForPath(path: string): string[] {
	const families: string[] = [];
	if (isBiomeTrackedFile(path)) {
		families.push("web:lint");
	}
	if (isMarkdownTrackedFile(path)) {
		families.push("repo:static");
	}
	if (isPythonTrackedFile(path)) {
		families.push("repo:static");
	}
	if (isGoTrackedFile(path)) {
		families.push("ci:go");
	}
	if (path.endsWith(".yaml") || path.endsWith(".yml")) {
		families.push("repo:static");
	}
	if (path.endsWith(".toml")) {
		families.push("repo:static");
	}
	if (path.endsWith(".sh")) {
		families.push("repo:static");
	}
	if (path.endsWith(".xml")) {
		families.push("repo:static");
	}
	if (path.endsWith(".jsonl")) {
		families.push("repo:static");
	}
	if (repoStaticOnlyScripts.has(path)) {
		families.push("repo:static");
	}
	if (path.endsWith(".sql") || rootSqlLintFiles.has(path)) {
		families.push("repo:static");
	}
	if (isDockerTrackedFile(path)) {
		families.push("repo:static");
	}
	if (isEnvTrackedFile(path)) {
		families.push("repo:static");
	}
	if (isEditorconfigTrackedFile(path)) {
		families.push("repo:static");
	}
	if (rootLockFiles.has(path) || path.endsWith("/pnpm-lock.yaml")) {
		families.push("repo:static");
	}
	if (path.endsWith(".html")) {
		families.push("repo:static");
	}
	return [...new Set(families)];
}

export function auditLintCoverage(root: string): string[] {
	return trackedLintCandidatePaths(root).filter(
		(path) => lintExclusionReason(path) === undefined && lintFamiliesForPath(path).length === 0,
	);
}

function isBiomeTrackedFile(path: string): boolean {
	if (rootBiomeFiles.has(path)) {
		return true;
	}
	return (
		jsLikeSuffixes.has(suffix(path)) && webLintPrefixes.some((prefix) => path.startsWith(prefix))
	);
}

function isMarkdownTrackedFile(path: string): boolean {
	if (markdownRootFiles.has(path)) {
		return true;
	}
	if (path.startsWith(".github/ISSUE_TEMPLATE/")) {
		return path.endsWith(".md");
	}
	if (path.startsWith("docs/")) {
		return path.endsWith(".md") && !path.includes("/archive/");
	}
	if (
		["apps/", "jobs/", "packages/", "configs/", "infra/"].some((prefix) => path.startsWith(prefix))
	) {
		return path.endsWith(".md");
	}
	return false;
}

function isPythonTrackedFile(path: string): boolean {
	return (
		path.endsWith(".py") &&
		![".planning/", ".tmp/", ".worktrees/", "apps/app-api/drizzle/meta/"].some((prefix) =>
			path.startsWith(prefix),
		)
	);
}

function isGoTrackedFile(path: string): boolean {
	return path.startsWith("apps/execution-control/") && path.endsWith(".go");
}

function isDockerTrackedFile(path: string): boolean {
	return (
		basename(path).startsWith("Dockerfile") || path.endsWith(".dockerfile") || dockerNames.has(path)
	);
}

function isEnvTrackedFile(path: string): boolean {
	return envSuffixes.some((candidate) => path.endsWith(candidate));
}

function isEditorconfigTrackedFile(path: string): boolean {
	return editorconfigNames.has(basename(path));
}

function isLintCandidatePath(path: string): boolean {
	const name = basename(path);
	if (lintExclusionReason(path) !== undefined) {
		return true;
	}
	if (
		rootBiomeFiles.has(path) ||
		markdownRootFiles.has(path) ||
		rootLockFiles.has(path) ||
		rootSqlLintFiles.has(path)
	) {
		return true;
	}
	if (dockerNames.has(name) || editorconfigNames.has(name) || name.startsWith("Dockerfile")) {
		return true;
	}
	if (envSuffixes.some((candidate) => path.endsWith(candidate))) {
		return true;
	}
	return textLikeSuffixes.has(suffix(path));
}

function suffix(path: string): string {
	return extname(path).toLowerCase();
}
