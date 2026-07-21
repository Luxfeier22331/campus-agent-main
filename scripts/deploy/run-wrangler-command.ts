import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROXY_ENV_KEYS = [
	"ALL_PROXY",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"all_proxy",
	"http_proxy",
	"https_proxy",
];

const CLOUDFLARE_NO_PROXY_HOSTS = [
	"api.cloudflare.com",
	"dash.cloudflare.com",
	"localhost",
	"127.0.0.1",
	"::1",
];

// The secret audit invokes this wrapper through another wrapper command. This
// marker carries the already-normalized vendor variable across that boundary
// without making CLOUDFLARE_API_TOKEN a supported repository input.
export const NORMALIZED_WRANGLER_ENV_MARKER = "CAMPUS_AGENT_WRANGLER_ENV_NORMALIZED";

function mergeNoProxyValue(currentValue: string | undefined): string {
	const entries = new Set(
		String(currentValue ?? "")
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean),
	);

	for (const host of CLOUDFLARE_NO_PROXY_HOSTS) {
		entries.add(host);
	}

	return Array.from(entries).join(",");
}

export function buildWranglerCommandEnv(
	baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const nextEnv = { ...baseEnv };
	const alreadyNormalized = baseEnv[NORMALIZED_WRANGLER_ENV_MARKER] === "1";
	const existingApiToken = baseEnv.CLOUDFLARE_API_TOKEN?.trim();
	delete nextEnv.CLOUDFLARE_API_TOKEN;
	const automationToken = baseEnv.CLOUDFLARE_AUTOMATION_TOKEN?.trim();
	if (automationToken) {
		nextEnv.CLOUDFLARE_API_TOKEN = automationToken;
	} else if (alreadyNormalized && existingApiToken) {
		nextEnv.CLOUDFLARE_API_TOKEN = existingApiToken;
	}
	delete nextEnv.CLOUDFLARE_AUTOMATION_TOKEN;
	delete nextEnv[NORMALIZED_WRANGLER_ENV_MARKER];
	for (const key of PROXY_ENV_KEYS) {
		delete nextEnv[key];
	}

	nextEnv.NO_PROXY = mergeNoProxyValue(baseEnv.NO_PROXY);
	nextEnv.no_proxy = mergeNoProxyValue(baseEnv.no_proxy ?? baseEnv.NO_PROXY);
	nextEnv.WRANGLER_DISABLE_EXPERIMENTAL_WARNING ??= "1";
	return nextEnv;
}

export function runWranglerCommand(
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: "inherit" | "pipe" } = {},
) {
	return spawnSync("pnpm", ["wrangler", ...args], {
		env: buildWranglerCommandEnv(options.env ?? process.env),
		stdio: options.stdio ?? "inherit",
		cwd: options.cwd,
	});
}

function parseCliArgs(argv: string[]): { cwd: string | undefined; wranglerArgs: string[] } {
	let cwd: string | undefined;
	const wranglerArgs: string[] = [];

	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--cwd") {
			cwd = argv[index + 1];
			index += 1;
			continue;
		}
		wranglerArgs.push(value);
	}

	return { cwd, wranglerArgs };
}

export function main(argv: string[] = process.argv.slice(2)): number {
	const { cwd, wranglerArgs } = parseCliArgs(argv);
	if (wranglerArgs.length === 0) {
		console.error(
			"Usage: pnpm exec tsx scripts/deploy/run-wrangler-command.ts [--cwd <dir>] <wrangler-args...>",
		);
		return 1;
	}

	const result = runWranglerCommand(wranglerArgs, {
		cwd,
		env: process.env,
		stdio: "inherit",
	});

	if (typeof result.status === "number") {
		return result.status;
	}

	return result.error ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	process.exit(main(process.argv.slice(2)));
}
