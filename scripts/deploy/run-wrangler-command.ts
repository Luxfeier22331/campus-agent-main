import { spawnSync } from "node:child_process";

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

const SENSITIVE_ENV_KEYS = ["CLOUDFLARE_API_TOKEN", "SENTRY_AUTH_TOKEN"] as const;

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
	for (const key of PROXY_ENV_KEYS) {
		delete nextEnv[key];
	}

	nextEnv.NO_PROXY = mergeNoProxyValue(baseEnv.NO_PROXY);
	nextEnv.no_proxy = mergeNoProxyValue(baseEnv.no_proxy ?? baseEnv.NO_PROXY);
	nextEnv.WRANGLER_DISABLE_EXPERIMENTAL_WARNING ??= "1";
	return nextEnv;
}

function redactWranglerOutput(value: string, env: NodeJS.ProcessEnv): string {
	let redacted = value;
	for (const key of SENSITIVE_ENV_KEYS) {
		const secret = env[key]?.trim();
		if (secret) {
			redacted = redacted.split(secret).join("[redacted]");
		}
	}
	return redacted.replace(/Bearer\s+[^\s]+/giu, "Bearer [redacted]");
}

export function formatWranglerFailure(
	result: ReturnType<typeof spawnSync>,
	operation: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const details: string[] = [];
	if (typeof result.status === "number") {
		details.push(`exit ${result.status}`);
	}
	if (result.signal) {
		details.push(`signal ${result.signal}`);
	}
	if (result.error) {
		details.push(result.error.message);
	}
	const stderr = String(result.stderr ?? "").trim();
	if (stderr) {
		details.push(redactWranglerOutput(stderr, env));
	}
	return `${operation} failed${details.length > 0 ? ` (${details.join("; ")})` : ""}.`;
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
