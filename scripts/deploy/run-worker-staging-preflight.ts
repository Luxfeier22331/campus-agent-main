import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadRepoStagingEnvFile } from "./lib/repo-env.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");

function fail(message) {
	console.error(message);
	process.exit(1);
}

function run(command: string, args: string[]): void {
	const result = spawnSync(command, args, {
		stdio: "inherit",
		cwd: repoRoot,
		env: process.env,
	});

	if (typeof result.status === "number" && result.status !== 0) {
		process.exit(result.status);
	}

	if (result.error) {
		fail(`Failed to run ${command}: ${result.error.message}`);
	}
}

function parseArgs(argv: string[]): { doctorSurface: string; commands: string[][] } {
	let doctorSurface: string | null = null;
	const commands: string[][] = [];

	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--doctor-surface") {
			doctorSurface = argv[index + 1] ?? null;
			index += 1;
			if (!doctorSurface) {
				fail("--doctor-surface requires a value.");
			}
			continue;
		}
		if (value === "--") {
			const command = argv.slice(index + 1);
			if (command.length === 0) {
				fail("-- must be followed by a command.");
			}
			commands.push(command);
			break;
		}
	}

	if (!doctorSurface) {
		fail(
			"Usage: pnpm exec tsx scripts/deploy/run-worker-staging-preflight.ts --doctor-surface <surface> [-- <command> [args...]]",
		);
	}

	return { doctorSurface, commands };
}

export function main(argv: string[] = process.argv.slice(2)): number {
	loadRepoStagingEnvFile(import.meta.url, "../..");
	const { doctorSurface, commands } = parseArgs(argv);
	run("pnpm", ["exec", "tsx", "scripts/deploy/doctor-env.ts", doctorSurface, "--json"]);
	for (const [command, ...args] of commands) {
		run(command, args);
	}
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	process.exit(main(process.argv.slice(2)));
}
