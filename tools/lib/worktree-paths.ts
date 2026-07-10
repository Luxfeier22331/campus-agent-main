import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "..", "..");

export function worktreePaths(root: string, pathspecs: string[]): string[] {
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
