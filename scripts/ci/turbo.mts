import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Compute this inside the selected toolchain, not before entering a Nix shell.
export function nodeRuntimeEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	return {
		...env,
		CAMPUS_NODE_RUNTIME: JSON.stringify({
			node: process.version,
			platform: process.platform,
			arch: process.arch,
		}),
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const result = spawnSync("pnpm", ["exec", "turbo", "run", ...process.argv.slice(2)], {
		env: nodeRuntimeEnvironment(),
		stdio: "inherit",
	});
	if (result.error) {
		throw result.error;
	}
	process.exitCode = result.status ?? 1;
}
