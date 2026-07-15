import { spawnSync } from "node:child_process";

function fail(message) {
	console.error(message);
	process.exit(1);
}

export function resolveGitSha(short = false) {
	const result = spawnSync("git", ["rev-parse", ...(short ? ["--short"] : []), "HEAD"], {
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

export function resolveGitShortSha() {
	return resolveGitSha(true);
}

export function resolveStagingSentryRelease(
	appName,
	override = process.env.STAGING_SENTRY_RELEASE,
) {
	const trimmedOverride = override?.trim();
	if (trimmedOverride) {
		return trimmedOverride;
	}

	return `${appName}@staging-${resolveGitShortSha()}`;
}
