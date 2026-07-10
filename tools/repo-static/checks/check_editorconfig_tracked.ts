import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const editorconfigTrackedPaths = [".editorconfig", ".gitattributes", ".gitignore", "**/.gitignore"];
const editorconfigExcludes = [".planning/", ".tmp/", ".worktrees/", "node_modules/"];

export function trackedEditorconfigFiles(root = repoRoot): string[] {
	return worktreePaths(root, editorconfigTrackedPaths).filter((path) => {
		const relpath = relativePosix(root, path);
		return !editorconfigExcludes.some((prefix) => relpath.startsWith(prefix)) && existsSync(path);
	});
}

export function editorconfigCheckerBinary(root = repoRoot): string {
	return join(root, "node_modules", ".bin", "editorconfig-checker");
}

export function materializeCheckTree(targetDir: string, files: string[], root = repoRoot): void {
	copyFileSync(join(root, ".editorconfig"), join(targetDir, ".editorconfig"));
	for (const path of files) {
		if (!existsSync(path)) {
			continue;
		}
		const destination = join(targetDir, relative(root, path));
		mkdirSync(dirname(destination), { recursive: true });
		copyFileSync(path, destination);
	}
}

function worktreePaths(root: string, pathspecs: string[]): string[] {
	const result = spawnSync(
		"git",
		[
			"-c",
			"core.quotePath=false",
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
			...pathspecs,
		],
		{ cwd: root, encoding: "buffer" },
	);
	if (result.status !== 0) {
		throw new Error(String(result.stderr || result.stdout || "git ls-files failed"));
	}
	const seen = new Set<string>();
	const paths: string[] = [];
	for (const item of result.stdout.toString("utf8").split("\0")) {
		if (item === "" || seen.has(item)) {
			continue;
		}
		seen.add(item);
		const path = join(root, item);
		if (existsSync(path)) {
			paths.push(path);
		}
	}
	return paths;
}

function relativePosix(root: string, path: string): string {
	return relative(root, path).replaceAll("\\", "/");
}

function expect(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function runSelfTest(): number {
	expect(
		editorconfigCheckerBinary(repoRoot) ===
			join(repoRoot, "node_modules", ".bin", "editorconfig-checker"),
		"editorconfig checker path regression",
	);
	const tempDir = mkdtempSync(join(tmpdir(), "editorconfig-check-"));
	try {
		materializeCheckTree(
			tempDir,
			[join(repoRoot, ".gitignore"), join(repoRoot, "apps", "campus-web", ".missing.gitignore")],
			repoRoot,
		);
		expect(existsSync(join(tempDir, ".editorconfig")), "expected materialized .editorconfig");
		expect(existsSync(join(tempDir, ".gitignore")), "expected materialized .gitignore");
		expect(
			!existsSync(join(tempDir, "apps", "campus-web", ".missing.gitignore")),
			"missing tracked files should stay skipped",
		);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
	console.log("check_editorconfig_tracked self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const files = trackedEditorconfigFiles();
	if (files.length === 0) {
		console.log(
			"No current-worktree EditorConfig-managed files matched the live-surface pathspecs.",
		);
		return 0;
	}
	const binary = editorconfigCheckerBinary();
	if (!existsSync(binary)) {
		throw new Error(
			"editorconfig-checker binary not found; run 'pnpm install' before invoking this lane.",
		);
	}
	const tempDir = mkdtempSync(join(tmpdir(), "editorconfig-check-"));
	try {
		materializeCheckTree(tempDir, files);
		const completed = spawnSync(binary, ["-no-color"], { cwd: tempDir, stdio: "inherit" });
		if (completed.error) {
			throw completed.error;
		}
		if (completed.status === 0) {
			console.log(`Validated ${files.length} EditorConfig-managed files from current worktree.`);
		}
		return completed.status ?? 1;
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
