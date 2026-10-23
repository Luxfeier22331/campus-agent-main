import { spawnSync } from "node:child_process";
import {
	appendFileSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DOCS_SHARD_TOTAL, parseDocsShardTotal } from "../config/docs-shard.ts";
import type { ReaderObjectStoreClient } from "../src/docs-reader-build/published-reader-types.ts";
import { loadCampusWebBuildEnvironment, omitObjectStoreEnvironment } from "./build-process-env.ts";
import {
	type BundleCheckResult,
	checkClientBundle,
	checkDocsClientBundle,
} from "./check-client-bundle-budget.ts";
import { prepareDocsContent } from "./prepare-docs-content.ts";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_OUTPUT_ROOT = resolve(APP_ROOT, "dist/client");
const DOCS_CLIENT_OUTPUT_ROOT = resolve(APP_ROOT, "dist/docs-client");
const APP_BUNDLE_GRAPH_PATH = resolve(APP_ROOT, ".generated/bundle-graph.json");
const DOCS_BUNDLE_GRAPH_PATH = resolve(APP_ROOT, ".generated/docs-bundle-graph.json");

export interface CampusWebBuildArgs {
	staging: boolean;
}

export interface CampusWebBuildInput extends CampusWebBuildArgs {
	docsClient?: ReaderObjectStoreClient;
	env?: NodeJS.ProcessEnv;
	refreshDocs?: boolean;
}

export function parseCampusWebBuildArgs(argv: string[]): CampusWebBuildArgs {
	let staging = false;
	for (const token of argv) {
		if (token === "--") {
			continue;
		}
		if (token === "--staging") {
			staging = true;
			continue;
		}
		throw new Error(`unknown campus web build argument: ${token}`);
	}
	return { staging };
}

export async function buildCampusWeb(input: CampusWebBuildInput): Promise<void> {
	const sourceEnvironment =
		input.docsClient || (input.env ?? process.env).CAMPUS_WEB_DOCS_SNAPSHOT
			? (input.env ?? process.env)
			: loadCampusWebBuildEnvironment(
					input.env === undefined ? {} : { processEnvironment: input.env },
				);
	const content = await prepareDocsContent({
		...(input.docsClient ? { client: input.docsClient } : {}),
		env: sourceEnvironment,
		pages: true,
		refresh: input.refreshDocs ?? false,
	});
	const env: NodeJS.ProcessEnv = {
		...omitObjectStoreEnvironment(sourceEnvironment),
		CAMPUS_WEB_DOCS_CONTENT_ROOT: content.root,
		WRANGLER_DISABLE_EXPERIMENTAL_WARNING: "1",
		XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME?.trim() || "./.wrangler-home",
	};
	const appEnv: NodeJS.ProcessEnv = {
		...env,
		CAMPUS_WEB_BUILD_TARGET: "app",
	};
	if (input.staging) {
		run(
			"pnpm",
			["exec", "tsx", "../../scripts/deploy/run-worker-staging-build.ts", "--", "vite", "build"],
			appEnv,
		);
	} else {
		run("pnpm", ["exec", "vite", "build"], appEnv);
	}
	buildDocsClient(env);
	checkBundleBudgets();
}

/**
 * Build the docs client in shards and merge each shard into the app client
 * output. Each shard runs in its own process so its bundler memory is released
 * before the next one starts; peak memory then tracks the shard size rather
 * than the total documentation page count.
 */
function buildDocsClient(env: NodeJS.ProcessEnv): void {
	const shardTotal = resolveDocsShardTotal(env);
	const graphs: string[] = [];
	for (let shard = 0; shard < shardTotal; shard += 1) {
		run("pnpm", ["exec", "vite", "build"], {
			...env,
			CAMPUS_WEB_BUILD_TARGET: "docs",
			CAMPUS_WEB_DOCS_SHARD_INDEX: String(shard),
			CAMPUS_WEB_DOCS_SHARD_TOTAL: String(shardTotal),
		});
		mergeDocsClientBuild();
		graphs.push(readDocsBundleGraph(shard));
	}
	writeMergedDocsBundleGraph(graphs);
}

function resolveDocsShardTotal(env: NodeJS.ProcessEnv): number {
	const raw = env.CAMPUS_WEB_DOCS_SHARD_TOTAL?.trim();
	return raw ? parseDocsShardTotal(raw) : DEFAULT_DOCS_SHARD_TOTAL;
}

function readDocsBundleGraph(shard: number): string {
	if (!existsSync(DOCS_BUNDLE_GRAPH_PATH)) {
		throw new Error(`docs build shard ${shard} did not write a bundle graph.`);
	}
	return readFileSync(DOCS_BUNDLE_GRAPH_PATH, "utf8");
}

/**
 * Merge per-shard bundle graphs so the budget check sees every docs chunk.
 * Shards share the docs entry and common chunks; identical chunk names must
 * describe identical chunks, otherwise the merged output is not coherent.
 */
function writeMergedDocsBundleGraph(sources: readonly string[]): void {
	const chunks: Record<string, unknown> = {};
	let docsEntry: string | undefined;
	let entry: string | undefined;
	for (const source of sources) {
		const graph = JSON.parse(source) as {
			chunks: Record<string, unknown>;
			docsEntry?: string;
			entry: string;
		};
		for (const [name, chunk] of Object.entries(graph.chunks)) {
			const existing = chunks[name];
			if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(chunk)) {
				throw new Error(`docs bundle graph shards disagree about chunk ${name}`);
			}
			chunks[name] = chunk;
		}
		if (graph.docsEntry !== undefined) {
			if (docsEntry !== undefined && docsEntry !== graph.docsEntry) {
				throw new Error("docs bundle graph shards disagree about the docs entry");
			}
			docsEntry = graph.docsEntry;
		}
		entry ??= graph.entry;
	}
	if (!entry) {
		throw new Error("docs bundle graph shards did not report an entry.");
	}
	writeFileSync(
		DOCS_BUNDLE_GRAPH_PATH,
		`${JSON.stringify({ chunks, ...(docsEntry ? { docsEntry } : {}), entry }, null, 2)}\n`,
		"utf8",
	);
}

function mergeDocsClientBuild(): void {
	assertDocsClientFiles(DOCS_CLIENT_OUTPUT_ROOT, "docs build");
	for (const name of ["assets", "docs"] as const) {
		const source = resolve(DOCS_CLIENT_OUTPUT_ROOT, name);
		if (!existsSync(source)) {
			throw new Error(`docs build is missing ${name}: ${source}`);
		}
		mergeDirectory(source, resolve(CLIENT_OUTPUT_ROOT, name));
	}
	assertDocsClientFiles(CLIENT_OUTPUT_ROOT, "Campus Web build");
	rmSync(DOCS_CLIENT_OUTPUT_ROOT, { force: true, recursive: true });
}

function assertDocsClientFiles(root: string, label: string): void {
	for (const relativePath of ["docs/index.html", "docs/404.html"]) {
		const target = resolve(root, relativePath);
		if (!(existsSync(target) && statSync(target).isFile())) {
			throw new Error(`${label} is missing ${relativePath}: ${target}`);
		}
	}
}

function mergeDirectory(source: string, destination: string): void {
	const sourceStat = statSync(source);
	if (!sourceStat.isDirectory()) {
		throw new Error(`docs build output is not a directory: ${source}`);
	}
	mkdirSync(destination, { recursive: true });
	for (const entry of readdirSync(source, { withFileTypes: true })) {
		const sourcePath = resolve(source, entry.name);
		const destinationPath = resolve(destination, entry.name);
		if (entry.isDirectory()) {
			mergeDirectory(sourcePath, destinationPath);
			continue;
		}
		if (!entry.isFile()) {
			throw new Error(`docs build output has an unsupported entry: ${sourcePath}`);
		}
		if (existsSync(destinationPath)) {
			const destinationStat = statSync(destinationPath);
			if (!(destinationStat.isFile() && sameFileContents(sourcePath, destinationPath))) {
				throw new Error(`docs build output conflicts with app asset: ${destinationPath}`);
			}
			continue;
		}
		mkdirSync(dirname(destinationPath), { recursive: true });
		copyFileSync(sourcePath, destinationPath);
	}
}

function sameFileContents(left: string, right: string): boolean {
	const leftBytes = readFileSync(left);
	const rightBytes = readFileSync(right);
	return (
		leftBytes.byteLength === rightBytes.byteLength &&
		leftBytes.every((value, index) => value === rightBytes[index])
	);
}

function checkBundleBudgets(): void {
	assertHtmlAssetReferences(CLIENT_OUTPUT_ROOT);
	const checks: BundleCheckResult[] = [
		checkClientBundle(CLIENT_OUTPUT_ROOT, APP_BUNDLE_GRAPH_PATH),
		checkDocsClientBundle(CLIENT_OUTPUT_ROOT, DOCS_BUNDLE_GRAPH_PATH),
	];
	const failures = checks.flatMap((check) => check.failures);
	const warnings = checks.flatMap((check) => check.warnings);
	if (warnings.length > 0) {
		console.warn("campus-web client bundle size warnings:");
		for (const warning of warnings) {
			console.warn(`- ${warning}`);
		}
	}
	appendBundleSummary({ failures, warnings });
	if (failures.length === 0) {
		console.log("campus-web client bundle integrity check passed.");
		return;
	}
	console.error("campus-web client bundle integrity check failed:");
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	throw new Error("campus-web client bundle integrity check failed.");
}

function assertHtmlAssetReferences(root: string): void {
	const missing: string[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const filePath = resolve(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(filePath);
				continue;
			}
			if (!(entry.isFile() && entry.name.endsWith(".html"))) {
				continue;
			}
			const html = readFileSync(filePath, "utf8");
			for (const match of html.matchAll(/(?:src|href)="([^"]+)"/gu)) {
				const reference = match[1];
				if (
					!reference ||
					reference.startsWith("#") ||
					reference.startsWith("data:") ||
					reference.startsWith("http://") ||
					reference.startsWith("https://") ||
					!isCampusHtmlAssetReference(reference)
				) {
					continue;
				}
				const target = resolve(root, reference.replace(/^\//u, ""));
				if (!(existsSync(target) && statSync(target).isFile())) {
					missing.push(`${filePath}: ${reference}`);
				}
			}
		}
	}
	if (missing.length > 0) {
		throw new Error(`Campus Web HTML references missing assets:\n${missing.join("\n")}`);
	}
}

function isCampusHtmlAssetReference(reference: string): boolean {
	return (
		reference.startsWith("/assets/") ||
		reference.startsWith("/campus-map/") ||
		reference.startsWith("/vendor/") ||
		reference === "/favicon.ico" ||
		reference === "/theme-bootstrap.js"
	);
}

function appendBundleSummary(input: BundleCheckResult): void {
	const summaryPath = process.env.GITHUB_STEP_SUMMARY?.trim();
	if (!summaryPath) {
		return;
	}
	const lines = [
		"### Campus Web bundle report",
		"",
		input.warnings.length > 0
			? "Bundle size warnings were recorded; they do not block this build."
			: "No bundle size warnings were recorded.",
		"",
	];
	if (input.warnings.length > 0) {
		lines.push("| Warning |", "| --- |", ...input.warnings.map((warning) => `| ${warning} |`), "");
	}
	if (input.failures.length > 0) {
		lines.push(
			"| Integrity failure |",
			"| --- |",
			...input.failures.map((failure) => `| ${failure} |`),
			"",
		);
	}
	appendFileSync(summaryPath, `${lines.join("\n")}\n`, "utf8");
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): void {
	const result = spawnSync(command, args, { cwd: APP_ROOT, env, stdio: "inherit" });
	if (result.status === 0) {
		return;
	}
	throw result.error ?? new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	buildCampusWeb(parseCampusWebBuildArgs(process.argv.slice(2))).catch((error) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
