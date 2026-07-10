import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreePaths } from "../../lib/worktree-paths.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const currentRepoRoot = join(scriptDir, "../../..");

const markdownTrackedPaths = [
	"README.md",
	"AGENTS.md",
	"CONTRIBUTING.md",
	"CODE_OF_CONDUCT.md",
	"SECURITY.md",
	"SUPPORT.md",
	".github/pull_request_template.md",
	".github/ISSUE_TEMPLATE",
	"docs",
	"apps",
	"jobs",
	"packages",
	"configs",
	"infra",
];

const rootMarkdownFiles = new Set([
	"README.md",
	"AGENTS.md",
	"CONTRIBUTING.md",
	"CODE_OF_CONDUCT.md",
	"SECURITY.md",
	"SUPPORT.md",
	".github/pull_request_template.md",
]);

export function trackedMarkdownFiles(root = currentRepoRoot): string[] {
	return worktreePaths(root, markdownTrackedPaths).filter((path) => {
		const relpath = relativePosix(root, path);
		return isTrackedMarkdownCandidate(relpath) && existsSync(path);
	});
}

export function isTrackedMarkdownCandidate(path: string): boolean {
	if (path.startsWith(".planning/")) {
		return false;
	}
	if (path.includes("/vendor/") || path.includes("/node_modules/")) {
		return false;
	}
	if (path.startsWith("docs/")) {
		if (path.includes("/archive/")) {
			return false;
		}
		return path.endsWith(".md");
	}
	if (rootMarkdownFiles.has(path)) {
		return true;
	}
	if (path.startsWith(".github/ISSUE_TEMPLATE/")) {
		return path.endsWith(".md");
	}
	if (
		["apps/", "jobs/", "packages/", "configs/", "infra/"].some((prefix) => path.startsWith(prefix))
	) {
		return path.endsWith(".md");
	}
	return false;
}

export function markdownlintCommand(files: string[], root = currentRepoRoot): string[] {
	return [
		"pnpm",
		"exec",
		"markdownlint-cli2",
		"--config",
		".markdownlint-cli2.jsonc",
		...files.map((path) => relativePosix(root, path)),
	];
}

function relativePosix(root: string, path: string): string {
	return relative(root, path).replaceAll("\\", "/");
}

function expect(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function expectEqualJson(actual: unknown, expected: unknown, label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
	}
}

function runSelfTest(): number {
	const config = JSON.parse(
		readFileSync(join(currentRepoRoot, ".markdownlint-cli2.jsonc"), "utf8"),
	);
	expectEqualJson(
		config,
		{
			config: {
				MD013: false,
				MD033: {
					allowed_elements: ["role", "invariants", "task", "output_contract", "CourseMapSection"],
				},
			},
		},
		"markdownlint config",
	);
	const files = trackedMarkdownFiles(currentRepoRoot).map((path) =>
		relativePosix(currentRepoRoot, path),
	);
	expect(files.includes("apps/app-api/README.md"), "app-api README should be checked");
	expect(files.includes("jobs/dining-sync/README.md"), "dining sync README should be checked");
	expect(files.includes("infra/otel/README.md"), "infra README should be checked");
	expect(files.includes("SECURITY.md"), "SECURITY.md should be checked");
	expect(
		!files.includes("apps/public-docs/docs/index.md"),
		"nested generated public docs should not be checked",
	);
	expect(!files.some((path) => path.includes("/vendor/")), "vendor markdown should be skipped");
	expect(
		markdownlintCommand([
			join(currentRepoRoot, "README.md"),
			join(currentRepoRoot, "docs/reference/testing-and-verification-lanes.md"),
		]).includes("README.md"),
		"markdownlint command should use repo-relative paths",
	);
	console.log("check_markdown_tracked self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const files = trackedMarkdownFiles();
	if (files.length === 0) {
		console.log("No current-worktree Markdown files matched the live-surface pathspecs.");
		return 0;
	}
	const command = markdownlintCommand(files);
	const completed = spawnSync(command[0], command.slice(1), {
		cwd: currentRepoRoot,
		stdio: "inherit",
	});
	return completed.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
