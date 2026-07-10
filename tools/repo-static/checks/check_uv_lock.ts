import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

export function buildUvLockCheckCommand(): string[] {
	return ["uv", "lock", "--check", "--offline"];
}

export function checkUvLock(root = repoRoot): string[] {
	if (!existsSync(join(root, "uv.lock"))) {
		return ["uv.lock: missing repo root uv.lock"];
	}
	const command = buildUvLockCheckCommand();
	const result = spawnSync(command[0], command.slice(1), {
		cwd: root,
		encoding: "utf8",
	});
	if (result.error) {
		return [`uv.lock: ${result.error.message}`];
	}
	if (result.status !== 0) {
		return [`uv.lock: ${(result.stderr || result.stdout || "").trim()}`];
	}
	return [];
}

function expectEqualJson(actual: unknown, expected: unknown, label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
	}
}

function runSelfTest(): number {
	expectEqualJson(buildUvLockCheckCommand(), ["uv", "lock", "--check", "--offline"], "uv command");
	console.log("check_uv_lock self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const failures = checkUvLock();
	if (failures.length > 0) {
		console.error("uv lock integrity check failed:");
		for (const failure of failures) {
			console.error(`- ${failure}`);
		}
		return 1;
	}
	console.log("Validated repo root uv.lock.");
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
