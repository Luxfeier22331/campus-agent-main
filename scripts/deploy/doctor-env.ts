import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { collectEnvDoctorStatus, renderTextReport } from "./doctor-env/core.ts";
import { runDoctorEnvSelfTest } from "./doctor-env/self-test.ts";
import { surfaceSpecs } from "./doctor-env/specs.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");

function parseArgs(argv: string[]): {
	checkPostgresConnectivity: boolean;
	json: boolean;
	repoRootArg: string;
	selfTest: boolean;
	surface: string;
} {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return {
			checkPostgresConnectivity: false,
			json: false,
			repoRootArg: repoRoot,
			selfTest: true,
			surface: "query",
		};
	}
	let repoRootArg = repoRoot;
	let json = false;
	let checkPostgresConnectivity = false;
	const positional: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--repo-root") {
			repoRootArg = argv[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (value === "--json") {
			json = true;
			continue;
		}
		if (value === "--check-postgres-connectivity") {
			checkPostgresConnectivity = true;
			continue;
		}
		if (value?.startsWith("--")) {
			throw new Error(`unsupported argument: ${value}`);
		}
		positional.push(value ?? "");
	}
	if (positional.length !== 1 || !repoRootArg) {
		throw new Error(
			`Usage: pnpm exec tsx scripts/deploy/doctor-env.ts <${Object.keys(surfaceSpecs).sort().join("|")}> [--repo-root <path>] [--json] [--check-postgres-connectivity]`,
		);
	}
	return {
		checkPostgresConnectivity,
		json,
		repoRootArg,
		selfTest: false,
		surface: positional[0] ?? "",
	};
}

export function main(argv: string[] = process.argv.slice(2)): number {
	const args = parseArgs(argv);
	if (args.selfTest) {
		return runDoctorEnvSelfTest();
	}
	const status = collectEnvDoctorStatus({
		checkPostgresConnectivity: args.checkPostgresConnectivity,
		env: { ...process.env },
		root: resolve(args.repoRootArg),
		surface: args.surface,
	});
	if (args.json) {
		console.log(JSON.stringify(status, null, 2));
	} else {
		process.stdout.write(renderTextReport(status));
	}
	return status.overall_ready ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main());
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
