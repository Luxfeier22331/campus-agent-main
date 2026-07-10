import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const biomeTrackedPathspecs = [
	".markdownlint-cli2.jsonc",
	"biome.jsonc",
	"package.json",
	"turbo.json",
	"apps",
	"jobs",
	"packages",
	"configs",
	"docs/reference/eval",
	"scripts",
	"tests",
	"tools",
];

export function trackedBiomeFiles(root = repoRoot): string[] {
	return worktreePaths(biomeTrackedPathspecs, root);
}

export function checkBiomeTracked(root = repoRoot): number {
	const files = trackedBiomeFiles(root);
	if (files.length === 0) {
		console.log("No current-worktree files matched the Biome live-surface pathspecs.");
		return 0;
	}
	const result = spawnSync(
		"pnpm",
		["exec", "biome", "check", "--files-ignore-unknown=true", ...files],
		{ cwd: root, stdio: "inherit" },
	);
	return result.status ?? 1;
}

function worktreePaths(pathspecs: string[], root: string): string[] {
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
		if (existsSync(join(root, item))) {
			paths.push(item);
		}
	}
	return paths;
}

function runSelfTest(): number {
	const expected = worktreePaths(biomeTrackedPathspecs, repoRoot);
	const actual = trackedBiomeFiles(repoRoot);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error("trackedBiomeFiles did not match git ls-files output");
	}
	if (!actual.includes("package.json")) {
		throw new Error("trackedBiomeFiles should include package.json");
	}
	console.log("check_biome_tracked self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	return checkBiomeTracked();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
