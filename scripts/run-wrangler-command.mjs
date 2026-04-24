import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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

function mergeNoProxyValue(currentValue) {
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

export function buildWranglerCommandEnv(baseEnv = process.env) {
	const nextEnv = { ...baseEnv };
	for (const key of PROXY_ENV_KEYS) {
		delete nextEnv[key];
	}

	nextEnv.NO_PROXY = mergeNoProxyValue(baseEnv.NO_PROXY);
	nextEnv.no_proxy = mergeNoProxyValue(baseEnv.no_proxy ?? baseEnv.NO_PROXY);
	nextEnv.WRANGLER_DISABLE_EXPERIMENTAL_WARNING ??= "1";
	return nextEnv;
}

export function runWranglerCommand(args, options = {}) {
	return spawnSync("pnpm", ["wrangler", ...args], {
		env: buildWranglerCommandEnv(options.env ?? process.env),
		stdio: options.stdio ?? "inherit",
		cwd: options.cwd,
	});
}

function parseCliArgs(argv) {
	let cwd;
	const wranglerArgs = [];

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

function main() {
	const { cwd, wranglerArgs } = parseCliArgs(process.argv.slice(2));
	if (wranglerArgs.length === 0) {
		console.error("Usage: node scripts/run-wrangler-command.mjs [--cwd <dir>] <wrangler-args...>");
		process.exit(1);
	}

	const result = runWranglerCommand(wranglerArgs, {
		cwd,
		env: process.env,
		stdio: "inherit",
	});

	if (typeof result.status === "number") {
		process.exit(result.status);
	}

	process.exit(result.error ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
