import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");

const profiles = {
	chat: {
		cwd: "apps/app-api",
		command: ["pnpm", "exec", "tsx", "./e2e/chat-e2e.ts"],
	},
	"chat-dev": {
		cwd: "apps/app-api",
		command: ["pnpm", "exec", "tsx", "./e2e/chat-e2e-local-dev.ts"],
	},
	"chat-local-provider": {
		cwd: "apps/app-api",
		command: ["pnpm", "exec", "tsx", "./e2e/chat-e2e-local-provider.ts"],
	},
	"chat-staging": {
		cwd: ".",
		command: [
			"pnpm",
			"exec",
			"tsx",
			"./scripts/deploy/run-with-staging-smoke-env.ts",
			"--cwd",
			"apps/app-api",
			"pnpm",
			"exec",
			"tsx",
			"./e2e/chat-durable-staging.ts",
			"--chat-base-url",
			"https://api-staging.mucwiki-edge.link",
		],
	},
	"chat-memory-staging": {
		cwd: ".",
		command: [
			"pnpm",
			"exec",
			"tsx",
			"./scripts/deploy/run-with-staging-smoke-env.ts",
			"--cwd",
			"apps/app-api",
			"pnpm",
			"exec",
			"tsx",
			"./e2e/chat-memory-staging.ts",
		],
	},
	"docs-gated-staging": {
		cwd: ".",
		command: [
			"pnpm",
			"exec",
			"tsx",
			"./scripts/deploy/run-with-staging-smoke-env.ts",
			"--cwd",
			"apps/app-api",
			"pnpm",
			"exec",
			"tsx",
			"./e2e/docs-gated-staging.ts",
		],
	},
} as const;

type ProfileName = keyof typeof profiles;

function printUsage(): void {
	console.error(
		[
			"Usage: pnpm exec tsx scripts/smoke/app-api.ts <profile> [args...]",
			"",
			"Profiles:",
			...Object.keys(profiles).map((profile) => `  - ${profile}`),
		].join("\n"),
	);
}

function parseProfile(value: string | undefined): ProfileName {
	if (value === "--help" || value === "-h") {
		printUsage();
		process.exit(0);
	}
	if (value && value in profiles) {
		return value as ProfileName;
	}
	printUsage();
	process.exit(2);
}

const [profileArg, ...forwardedArgs] = process.argv.slice(2);
const profile = profiles[parseProfile(profileArg)];
const result = spawnSync(profile.command[0], [...profile.command.slice(1), ...forwardedArgs], {
	cwd: resolve(repoRoot, profile.cwd),
	env: process.env,
	stdio: "inherit",
});

if (result.error) {
	throw result.error;
}
process.exit(result.status ?? 1);
