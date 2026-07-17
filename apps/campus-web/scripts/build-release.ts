import { spawnSync } from "node:child_process";
import { assertDocsReleaseId } from "../src/docs-reader-build/docs-release.ts";

interface ReleaseBuildArgs {
	releaseId: string;
	staging: boolean;
}

export function parseReleaseBuildArgs(argv: string[]): ReleaseBuildArgs {
	let releaseId = "";
	let staging = false;
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--staging") {
			staging = true;
			continue;
		}
		if (token === "--release-id") {
			const value = argv[index + 1]?.trim();
			if (!value || value.startsWith("--")) {
				throw new Error(`${token} requires a value.`);
			}
			releaseId = value;
			index += 1;
			continue;
		}
		throw new Error(`unknown release build argument: ${token}`);
	}
	assertDocsReleaseId(releaseId);
	return {
		releaseId,
		staging,
	};
}

function run(command: string, args: string[]): void {
	const result = spawnSync(command, args, { stdio: "inherit" });
	if (result.status === 0) {
		return;
	}
	throw result.error ?? new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
}

function buildRelease(input: ReleaseBuildArgs): void {
	run("pnpm", [
		"exec",
		"tsx",
		"./scripts/build-published-reader-docs.ts",
		"--release-id",
		input.releaseId,
	]);
	if (input.staging) {
		run("pnpm", [
			"exec",
			"tsx",
			"../../scripts/deploy/run-worker-staging-build.ts",
			"--",
			"vite",
			"build",
		]);
		run("pnpm", ["exec", "tsx", "./scripts/check-client-bundle-budget.ts"]);
		return;
	}
	run("pnpm", ["run", "build:app"]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		buildRelease(parseReleaseBuildArgs(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
