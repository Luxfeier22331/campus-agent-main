import { spawnSync } from "node:child_process";

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

export function resolveGitSha(): string {
	const result = spawnSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	});

	if (result.status !== 0) {
		fail("Unable to derive the release identity from git rev-parse HEAD.");
	}

	const commitSha = result.stdout?.trim();
	if (!commitSha) {
		fail("Unable to derive the release identity because git returned an empty commit SHA.");
	}

	return commitSha;
}
