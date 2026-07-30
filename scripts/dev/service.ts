import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import { loadLocalDevProfile } from "./profile";

type ServiceName = "app-api" | "campus-web" | "ops-web";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const profile = loadLocalDevProfile(repoRoot);
const service = process.argv[2] as ServiceName | undefined;
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

if (service === "app-api") {
	const appDir = resolve(repoRoot, "apps/app-api");
	const child = spawn(
		pnpm,
		[
			"exec",
			"tsx",
			"./scripts/run-with-local-env.ts",
			pnpm,
			"exec",
			"wrangler",
			"dev",
			"-e",
			"local",
			"--name",
			"app-api-local",
			"--ip",
			"127.0.0.1",
			"--port",
			String(profile.ports.appApi),
			"--env-file",
			".dev.vars.local",
		],
		{
			cwd: appDir,
			env: { ...process.env, WRANGLER_DISABLE_EXPERIMENTAL_WARNING: "1" },
			stdio: "inherit",
		},
	);
	forwardLifecycle([child]);
} else if (service === "campus-web") {
	const appDir = resolve(repoRoot, "apps/campus-web");
	const child = spawn(
		pnpm,
		[
			"exec",
			"vite",
			"--host",
			"127.0.0.1",
			"--port",
			String(profile.ports.campusWeb),
			"--strictPort",
		],
		{
			cwd: appDir,
			env: {
				...process.env,
				CLOUDFLARE_ENV: "local",
				WRANGLER_DISABLE_EXPERIMENTAL_WARNING: "1",
				XDG_CONFIG_HOME: resolve(repoRoot, ".wrangler-home"),
			},
			stdio: "inherit",
		},
	);
	forwardLifecycle([child]);
} else if (service === "ops-web") {
	const appDir = resolve(repoRoot, "apps/ops-web");
	const env = loadAppEnvironment(resolve(appDir, ".env.local"));
	const api = spawn(pnpm, ["exec", "tsx", "src/server/node.ts"], {
		cwd: appDir,
		env,
		stdio: "inherit",
	});
	const web = spawn(
		pnpm,
		["exec", "vite", "--host", "127.0.0.1", "--port", String(profile.ports.opsWeb), "--strictPort"],
		{
			cwd: appDir,
			env,
			stdio: "inherit",
		},
	);
	forwardLifecycle([api, web]);
} else {
	console.error("Usage: service.ts <app-api|campus-web|ops-web>.");
	process.exit(1);
}

function loadAppEnvironment(path: string): NodeJS.ProcessEnv {
	const fromFile = parseEnv(readFileSync(path, "utf8"));
	return { ...fromFile, ...process.env };
}

function forwardLifecycle(children: ChildProcess[]): void {
	let stopping = false;
	const stop = (signal: NodeJS.Signals) => {
		if (stopping) {
			return;
		}
		stopping = true;
		for (const child of children) {
			if (!child.killed) {
				child.kill(signal);
			}
		}
	};
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.on(signal, () => stop(signal));
	}
	for (const child of children) {
		child.on("error", (error) => {
			console.error(error.message);
			stop("SIGTERM");
			process.exitCode = 1;
		});
		child.on("exit", (code, signal) => {
			if (!stopping) {
				stop("SIGTERM");
			}
			if (signal) {
				process.exitCode = 1;
			} else if (code !== 0) {
				process.exitCode = code ?? 1;
			}
		});
	}
}
