import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import {
	loadCampusWebBuildEnvironment,
	omitObjectStoreEnvironment,
} from "../../apps/campus-web/scripts/build-process-env.ts";
import { loadLocalDevProfile } from "./profile";

type ServiceName = "app-api" | "campus-web" | "ops-web" | "ops-web-api" | "ops-web-api-fixture";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const profile = loadLocalDevProfile(repoRoot);
const service = process.argv[2] as ServiceName | undefined;
const serviceArgs = process.argv.slice(3);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

void main().catch((error) => {
	console.error(error instanceof Error ? error.stack || error.message : String(error));
	process.exitCode = 1;
});

async function main(): Promise<void> {
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
		if (serviceArgs.length > 0) {
			throw new Error("campus-web development does not accept arguments.");
		}
		const campusEnv = loadCampusWebEnvironment(appDir);
		const docsContentRoot = prepareCampusWebDocs(appDir, campusEnv);
		const webEnv = {
			...omitObjectStoreEnvironment(campusEnv),
			CAMPUS_WEB_DOCS_CONTENT_ROOT: docsContentRoot,
			CLOUDFLARE_ENV: "local",
			WRANGLER_DISABLE_EXPERIMENTAL_WARNING: "1",
			XDG_CONFIG_HOME: resolve(repoRoot, ".wrangler-home"),
		};
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
				env: webEnv,
				stdio: "inherit",
			},
		);
		forwardLifecycle([child]);
	} else if (service === "ops-web" || service === "ops-web-api") {
		const appDir = resolve(repoRoot, "apps/ops-web");
		if (serviceArgs.length > 0) {
			throw new Error(`${service} development does not accept arguments.`);
		}
		const env = loadAppEnvironment(resolve(appDir, ".env.local"));
		const api = spawn(pnpm, ["exec", "tsx", "src/server/node.ts"], {
			cwd: appDir,
			env,
			stdio: "inherit",
		});
		if (service === "ops-web-api") {
			forwardLifecycle([api]);
			return;
		}
		const web = spawn(
			pnpm,
			[
				"exec",
				"vite",
				"--host",
				"127.0.0.1",
				"--port",
				String(profile.ports.opsWeb),
				"--strictPort",
			],
			{
				cwd: appDir,
				env: {
					...env,
					OPS_WEB_API_ORIGIN: `http://127.0.0.1:${profile.ports.opsWebApi}`,
				},
				stdio: "inherit",
			},
		);
		forwardLifecycle([api, web]);
	} else if (service === "ops-web-api-fixture") {
		if (serviceArgs.length > 0) {
			throw new Error("ops-web-api-fixture development does not accept arguments.");
		}
		const child = spawn(
			pnpm,
			[
				"--dir",
				"apps/ops-web",
				"exec",
				"tsx",
				"test/fixtures/internal-portal-automation-server.ts",
				"--port",
				String(profile.ports.opsWebApi),
			],
			{
				cwd: repoRoot,
				env: process.env,
				stdio: "inherit",
			},
		);
		forwardLifecycle([child]);
	} else {
		console.error(
			"Usage: service.ts <app-api|campus-web|ops-web|ops-web-api|ops-web-api-fixture>.",
		);
		process.exitCode = 1;
	}
}

function prepareCampusWebDocs(appDir: string, env: NodeJS.ProcessEnv): string {
	const result = spawnSync(pnpm, ["exec", "tsx", "./scripts/prepare-docs-content.ts"], {
		cwd: appDir,
		encoding: "utf8",
		env,
		stdio: "pipe",
	});
	if (result.status !== 0) {
		if (result.stderr) {
			process.stderr.write(result.stderr);
		}
		throw (
			result.error ??
			new Error(`Campus Web docs preparation exited with status ${result.status ?? "unknown"}.`)
		);
	}
	let value: unknown;
	try {
		value = JSON.parse(result.stdout.trim());
	} catch {
		throw new Error("Campus Web docs preparation returned invalid output.");
	}
	if (!(value && typeof value === "object" && !Array.isArray(value))) {
		throw new Error("Campus Web docs preparation returned invalid output.");
	}
	const root = (value as Record<string, unknown>).root;
	if (typeof root !== "string" || !root) {
		throw new Error("Campus Web docs preparation did not produce a content root.");
	}
	return root;
}

function loadAppEnvironment(path: string): NodeJS.ProcessEnv {
	const fromFile = parseEnv(readFileSync(path, "utf8"));
	return { ...fromFile, ...process.env };
}

function loadCampusWebEnvironment(appDir: string): NodeJS.ProcessEnv {
	const appEnvironmentPath = resolve(appDir, ".dev.vars.local");
	if (!existsSync(appEnvironmentPath)) {
		throw new Error("Campus Web local environment is missing; run pnpm dev:init first.");
	}
	return loadCampusWebBuildEnvironment({
		appRoot: appDir,
		processEnvironment: process.env,
		repoRoot,
	});
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
