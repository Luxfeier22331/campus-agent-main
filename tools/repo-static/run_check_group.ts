import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../..");

export interface CheckGroupEntry {
	label: string;
	script: string;
	args?: string[];
	selfTestArgs?: string[];
}

export function runCheckGroup(
	entries: CheckGroupEntry[],
	argv: string[] = process.argv.slice(2),
): number {
	const selfTest = argv.length === 1 && argv[0] === "--self-test";
	if (argv.length > 0 && !selfTest) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	for (const entry of entries) {
		console.log(`==> ${entry.label}`);
		const result = spawnSync(
			"pnpm",
			[
				"exec",
				"tsx",
				entry.script,
				...(selfTest ? (entry.selfTestArgs ?? ["--self-test"]) : (entry.args ?? [])),
			],
			{ cwd: repoRoot, stdio: "inherit" },
		);
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

export function runMain(importMetaUrl: string, entries: CheckGroupEntry[]): void {
	if (process.argv[1] && fileURLToPath(importMetaUrl) === resolve(process.argv[1])) {
		try {
			process.exit(runCheckGroup(entries));
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	}
}
