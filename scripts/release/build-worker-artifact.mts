import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface WorkerConfig {
	[key: string]: unknown;
	main: string;
	assets?: { directory: string; [key: string]: unknown };
	env?: { staging?: Partial<WorkerConfig> };
}

export function buildWorkerArtifact(app: string, destination: string, sourceSha: string): void {
	if (!["app-api", "campus-web", "edge-router", "status-web"].includes(app)) {
		throw new Error("Unknown Worker");
	}
	const appRoot = resolve("apps", app);
	const run = (args: string[]) => execFileSync("pnpm", args, { cwd: appRoot, stdio: "inherit" });
	if (app === "campus-web") {
		if (!process.env.CAMPUS_WEB_DOCS_SNAPSHOT) {
			throw new Error("Campus Web requires a fixed Docs snapshot");
		}
		run(["build:staging"]);
	} else {
		run(["build"]);
	}
	mkdirSync(destination, { recursive: true });
	cpSync(resolve(appRoot, "dist"), resolve(destination, "dist"), { recursive: true });
	let config: WorkerConfig;
	if (app === "campus-web") {
		config = JSON.parse(readFileSync(resolve(appRoot, "dist/campus_web/wrangler.json"), "utf8"));
		const configRoot = resolve(appRoot, "dist/campus_web");
		const relocate = (value: string) => {
			const path = resolve(configRoot, value);
			if (!path.startsWith(`${appRoot}/dist/`)) {
				throw new Error(`Worker build path outside dist: ${value}`);
			}
			return path.slice(appRoot.length + 1);
		};
		config.main = relocate(config.main);
		assert(config.assets, "Campus Web build requires assets");
		config.assets.directory = relocate(config.assets.directory);
	} else {
		const require = createRequire(resolve(appRoot, "package.json"));
		const original: WorkerConfig = require("smol-toml").parse(
			readFileSync(resolve(appRoot, "wrangler.toml"), "utf8"),
		);
		assert(original.env, "Worker configuration requires environments");
		config = { ...original, ...original.env.staging, main: "dist/worker/index.js" };
		delete config.env;
		if (original.assets) {
			cpSync(resolve(appRoot, original.assets.directory), resolve(destination, "assets"), {
				recursive: true,
			});
			config.assets = { ...original.assets, directory: "assets" };
		}
	}
	// Bindings are declarations; GitOps supplies the selected environment values.
	delete config.vars;
	delete config.build;
	delete config.env;
	config.name = `${app}-staging`;
	config.no_bundle = true;
	config.upload_source_maps = false;
	writeFileSync(resolve(destination, "wrangler.json"), `${JSON.stringify(config, null, 2)}\n`);
	writeFileSync(
		resolve(destination, "worker.json"),
		`${JSON.stringify({ schemaVersion: 1, workerName: `${app}-staging`, sourceSha })}\n`,
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const [app, destination, sourceSha] = process.argv.slice(2);
	if (!(app && destination && sourceSha && /^[a-f0-9]{40}$/.test(sourceSha))) {
		throw new Error("Usage: build-worker-artifact <app> <directory> <Source SHA>");
	}
	buildWorkerArtifact(app, resolve(destination), sourceSha);
}
