import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCampusWeb, parseCampusWebBuildArgs } from "./build-campus-web.ts";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function parseCampusWebDeployArgs(argv: string[]): void {
	const input = parseCampusWebBuildArgs(argv);
	if (input.staging) {
		throw new Error("Campus Web deployment does not accept --staging.");
	}
}

export async function deployCampusWeb(): Promise<void> {
	await buildCampusWeb({ staging: false });
	run("pnpm", [
		"exec",
		"tsx",
		"../../scripts/deploy/verify-worker-deploy-config.ts",
		"dist/campus_web/wrangler.json",
		"APP_API=app-api",
	]);
	run("pnpm", [
		"exec",
		"tsx",
		"../../scripts/deploy/run-wrangler-command.ts",
		"deploy",
		"--config",
		"dist/campus_web/wrangler.json",
	]);
}

function run(command: string, args: string[]): void {
	const result = spawnSync(command, args, { cwd: APP_ROOT, stdio: "inherit" });
	if (result.status === 0) {
		return;
	}
	throw result.error ?? new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	Promise.resolve()
		.then(() => {
			parseCampusWebDeployArgs(process.argv.slice(2));
			return deployCampusWeb();
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.stack || error.message : String(error));
			process.exit(1);
		});
}
