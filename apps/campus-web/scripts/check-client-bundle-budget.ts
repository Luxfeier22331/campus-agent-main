import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import type { CampusBundleGraph } from "../config/bundle-graph";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleSizeWarningBytes = 500 * 1024;
const routeFacades = [
	{
		facades: ["/src/app/routes/home-page.tsx"],
		name: "home",
	},
	{
		facades: [
			"/src/app/routes/map-page.tsx",
			"/src/components/auth/user/product-account-entry.tsx",
		],
		name: "map",
	},
	{
		facades: ["/src/app/routes/dining-page.tsx"],
		name: "dining",
	},
	{
		facades: ["/src/app/routes/interest-groups-page.tsx"],
		name: "groups",
	},
	{
		facades: ["/src/app/routes/feedback-page.tsx"],
		name: "feedback",
	},
	{
		facades: ["/src/app/routes/account-page.tsx"],
		name: "account",
	},
] as const;
const allowedVendorSizeReferences = new Map([
	["vendor/maplibre-gl/maplibre-gl.mjs", Math.floor(600 * 1024)],
	["vendor/maplibre-gl/maplibre-gl-worker.mjs", 32 * 1024],
	["vendor/maplibre-gl/maplibre-gl-shared.mjs", 600 * 1024],
	["vendor/maplibre-gl/maplibre-gl.css", 96 * 1024],
	["vendor/maplibre-gl/maplibre-gl-runtime.mjs", 2 * 1024],
	["vendor/maplibre-gl/LICENSE.txt", 16 * 1024],
]);

export interface RouteBundleMeasurement {
	cssBytes: number;
	cssFileBytes: Record<string, number>;
	cssFiles: string[];
	jsBytes: number;
	jsFileBytes: Record<string, number>;
	jsFiles: string[];
}

export interface BundleCheckResult {
	failures: string[];
	warnings: string[];
}

export function measureRouteBundle(input: {
	clientDir: string;
	entry?: "app" | "docs";
	facades: readonly string[];
	graph: CampusBundleGraph;
}): RouteBundleMeasurement {
	const entry = input.entry === "docs" ? input.graph.docsEntry : input.graph.entry;
	if (!entry) {
		throw new Error(`bundle graph is missing ${input.entry ?? "app"} entry`);
	}
	const roots = [entry];
	for (const facade of input.facades) {
		const match = Object.entries(input.graph.chunks).find(([, chunk]) =>
			chunk.facadeModuleId?.endsWith(facade),
		);
		if (!match) {
			throw new Error(`bundle graph is missing route facade ${facade}`);
		}
		roots.push(match[0]);
	}
	const jsFiles = collectStaticChunkClosure(input.graph, roots);
	const cssFiles = [
		...new Set(jsFiles.flatMap((file) => input.graph.chunks[file]?.css ?? [])),
	].sort();
	const jsFileBytes = measureGzipBytes(input.clientDir, jsFiles);
	const cssFileBytes = measureGzipBytes(input.clientDir, cssFiles);
	return {
		cssBytes: sumBytes(cssFileBytes),
		cssFileBytes,
		cssFiles,
		jsBytes: sumBytes(jsFileBytes),
		jsFileBytes,
		jsFiles,
	};
}

export function collectStaticChunkClosure(
	graph: CampusBundleGraph,
	roots: readonly string[],
): string[] {
	const visited = new Set<string>();
	const pending = [...roots];
	while (pending.length > 0) {
		const file = pending.pop();
		if (!file || visited.has(file)) {
			continue;
		}
		const chunk = graph.chunks[file];
		if (!chunk) {
			throw new Error(`bundle graph references missing chunk ${file}`);
		}
		visited.add(file);
		pending.push(...chunk.imports);
	}
	return [...visited].sort();
}

export function checkClientBundle(
	clientDir: string,
	graphPath = path.join(appRoot, ".generated/bundle-graph.json"),
): BundleCheckResult {
	const failures: string[] = [];
	const warnings: string[] = [];
	if (!fs.existsSync(graphPath)) {
		return {
			failures: [
				"missing generated bundle graph; run the campus-web build before checking bundle integrity",
			],
			warnings,
		};
	}
	let graph: CampusBundleGraph;
	try {
		graph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as CampusBundleGraph;
	} catch (error) {
		return {
			failures: [
				`generated bundle graph is invalid: ${error instanceof Error ? error.message : String(error)}`,
			],
			warnings,
		};
	}
	try {
		const shellMeasurement = measureRouteBundle({ clientDir, facades: [], graph });
		logMeasurement("app shell", shellMeasurement);
		addSizeWarnings("app shell", shellMeasurement, warnings);
	} catch (error) {
		failures.push(errorMessage(error));
	}
	for (const route of routeFacades) {
		let measurement: RouteBundleMeasurement;
		try {
			measurement = measureRouteBundle({
				clientDir,
				entry: "app",
				facades: route.facades,
				graph,
			});
		} catch (error) {
			failures.push(errorMessage(error));
			continue;
		}
		logMeasurement(`${route.name} route`, measurement);
		addSizeWarnings(`${route.name} route`, measurement, warnings);
	}
	checkVendorFiles(clientDir, failures, warnings);
	return { failures, warnings };
}

export function checkDocsClientBundle(
	clientDir: string,
	graphPath = path.join(appRoot, ".generated/docs-bundle-graph.json"),
): BundleCheckResult {
	if (!fs.existsSync(graphPath)) {
		return {
			failures: [
				"missing generated docs bundle graph; run the campus-web docs build before checking bundle integrity",
			],
			warnings: [],
		};
	}
	let graph: CampusBundleGraph;
	try {
		graph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as CampusBundleGraph;
	} catch (error) {
		return {
			failures: [
				`generated docs bundle graph is invalid: ${error instanceof Error ? error.message : String(error)}`,
			],
			warnings: [],
		};
	}
	let measurement: RouteBundleMeasurement;
	try {
		measurement = measureRouteBundle({
			clientDir,
			entry: "docs",
			facades: [],
			graph,
		});
	} catch (error) {
		return { failures: [errorMessage(error)], warnings: [] };
	}
	const warnings: string[] = [];
	logMeasurement("docs", measurement);
	addSizeWarnings("docs", measurement, warnings);
	return { failures: [], warnings };
}

function measureGzipBytes(clientDir: string, files: string[]): Record<string, number> {
	return Object.fromEntries(
		files.map((file) => {
			const filePath = path.join(clientDir, file);
			if (!fs.existsSync(filePath)) {
				throw new Error(`bundle graph asset is missing: ${file}`);
			}
			return [file, gzipSync(fs.readFileSync(filePath)).byteLength];
		}),
	);
}

function sumBytes(files: Record<string, number>): number {
	return Object.values(files).reduce((total, bytes) => total + bytes, 0);
}

function checkVendorFiles(clientDir: string, failures: string[], warnings: string[]): void {
	const vendorDir = path.join(clientDir, "vendor");
	const seen = new Set<string>();
	if (fs.existsSync(vendorDir)) {
		for (const vendorFile of walkFiles(vendorDir)) {
			const relativePath = toPosix(path.relative(clientDir, vendorFile));
			seen.add(relativePath);
			const reference = allowedVendorSizeReferences.get(relativePath);
			if (!reference) {
				failures.push(`${relativePath} is not registered as an allowed vendor asset`);
				continue;
			}
			const size = fs.statSync(vendorFile).size;
			if (size > reference) {
				warnings.push(
					`${relativePath} is ${formatBytes(size)} raw; reference ${formatBytes(reference)}`,
				);
			}
		}
	}
	for (const [relativePath] of allowedVendorSizeReferences) {
		if (!seen.has(relativePath)) {
			failures.push(`missing registered vendor asset ${relativePath}`);
		}
	}
}

function* walkFiles(directory: string): Generator<string> {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			yield* walkFiles(entryPath);
		} else if (entry.isFile()) {
			yield entryPath;
		}
	}
}

function toPosix(value: string): string {
	return value.split(path.sep).join("/");
}

function formatBytes(bytes: number): string {
	return `${bytes} bytes (${(bytes / 1024).toFixed(1)} KiB)`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function logMeasurement(label: string, measurement: RouteBundleMeasurement): void {
	console.log(
		`${label}: ${formatBytes(measurement.jsBytes)} JS gzip, ${formatBytes(measurement.cssBytes)} CSS gzip`,
	);
	const assets = [
		...Object.entries(measurement.jsFileBytes).map(([file, bytes]) => ({
			bytes,
			file,
			kind: "JS",
		})),
		...Object.entries(measurement.cssFileBytes).map(([file, bytes]) => ({
			bytes,
			file,
			kind: "CSS",
		})),
	]
		.sort((left, right) => right.bytes - left.bytes || left.file.localeCompare(right.file))
		.slice(0, 5);
	for (const asset of assets) {
		console.log(`  ${asset.kind} ${asset.file}: ${formatBytes(asset.bytes)} gzip`);
	}
}

function addSizeWarnings(
	label: string,
	measurement: RouteBundleMeasurement,
	warnings: string[],
): void {
	for (const [kind, bytes] of [
		["JS", measurement.jsBytes],
		["CSS", measurement.cssBytes],
	] as const) {
		if (bytes > bundleSizeWarningBytes) {
			warnings.push(
				`${label} ${kind} is ${formatBytes(bytes)} gzip; warning threshold ${formatBytes(bundleSizeWarningBytes)} gzip`,
			);
		}
	}
	for (const [file, bytes] of Object.entries({
		...measurement.jsFileBytes,
		...measurement.cssFileBytes,
	})) {
		if (bytes > bundleSizeWarningBytes) {
			warnings.push(
				`${file} is ${formatBytes(bytes)} gzip; warning threshold ${formatBytes(bundleSizeWarningBytes)} gzip`,
			);
		}
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const clientDir = path.join(appRoot, "dist/client");
	const result = checkClientBundle(clientDir);
	if (result.warnings.length > 0) {
		console.warn("campus-web client bundle size warnings:");
		for (const warning of result.warnings) {
			console.warn(`- ${warning}`);
		}
	}
	if (result.failures.length > 0) {
		console.error("campus-web client bundle integrity check failed:");
		for (const failure of result.failures) {
			console.error(`- ${failure}`);
		}
		process.exitCode = 1;
	} else {
		console.log("campus-web client bundle integrity check passed.");
	}
}
