import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import type { CampusBundleGraph } from "../config/bundle-graph";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shellBudget = {
	cssLimit: 20 * 1024,
	jsLimit: 110 * 1024,
};
const routeBudgets = [
	{
		cssLimit: 24 * 1024,
		facades: ["/src/app/routes/home-page.tsx"],
		jsLimit: 285 * 1024,
		name: "home",
	},
	{
		cssLimit: 24 * 1024,
		facades: [
			"/src/app/routes/map-page.tsx",
			"/src/components/auth/user/product-account-entry.tsx",
		],
		jsLimit: 240 * 1024,
		name: "map",
	},
	{
		cssLimit: 24 * 1024,
		facades: ["/src/app/routes/dining-page.tsx"],
		jsLimit: 175 * 1024,
		name: "dining",
	},
	{
		cssLimit: 24 * 1024,
		facades: ["/src/app/routes/services-page.tsx"],
		jsLimit: 250 * 1024,
		name: "services",
	},
	{
		cssLimit: 24 * 1024,
		facades: ["/src/app/routes/feedback-page.tsx"],
		jsLimit: 220 * 1024,
		name: "feedback",
	},
	{
		cssLimit: 72 * 1024,
		facades: ["/src/app/routes/account-page.tsx"],
		jsLimit: 390 * 1024,
		name: "account",
	},
] as const;
const allowedVendorBudgets = new Map([
	["vendor/maplibre-gl/maplibre-gl.js", Math.floor(1.3 * 1024 * 1024)],
	["vendor/maplibre-gl/maplibre-gl.css", 96 * 1024],
	["vendor/maplibre-gl/LICENSE.txt", 16 * 1024],
]);

export interface RouteBundleMeasurement {
	cssBytes: number;
	cssFiles: string[];
	jsBytes: number;
	jsFiles: string[];
}

export function measureRouteBundle(input: {
	clientDir: string;
	facades: readonly string[];
	graph: CampusBundleGraph;
}): RouteBundleMeasurement {
	const roots = [input.graph.entry];
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
	return {
		cssBytes: sumGzipBytes(input.clientDir, cssFiles),
		cssFiles,
		jsBytes: sumGzipBytes(input.clientDir, jsFiles),
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
): string[] {
	const failures: string[] = [];
	if (!fs.existsSync(graphPath)) {
		return [
			"missing generated bundle graph; run the campus-web build before checking bundle budget",
		];
	}
	const graph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as CampusBundleGraph;
	const shellMeasurement = measureRouteBundle({ clientDir, facades: [], graph });
	if (shellMeasurement.jsBytes > shellBudget.jsLimit) {
		failures.push(
			`app shell JS is ${formatBytes(shellMeasurement.jsBytes)} gzip, limit ${formatBytes(shellBudget.jsLimit)}`,
		);
	}
	if (shellMeasurement.cssBytes > shellBudget.cssLimit) {
		failures.push(
			`app shell CSS is ${formatBytes(shellMeasurement.cssBytes)} gzip, limit ${formatBytes(shellBudget.cssLimit)}`,
		);
	}
	console.log(
		`app shell: ${formatBytes(shellMeasurement.jsBytes)} JS gzip, ${formatBytes(shellMeasurement.cssBytes)} CSS gzip`,
	);
	for (const budget of routeBudgets) {
		let measurement: RouteBundleMeasurement;
		try {
			measurement = measureRouteBundle({ clientDir, facades: budget.facades, graph });
		} catch (error) {
			failures.push(error instanceof Error ? error.message : String(error));
			continue;
		}
		if (measurement.jsBytes > budget.jsLimit) {
			failures.push(
				`${budget.name} route JS is ${formatBytes(measurement.jsBytes)} gzip, limit ${formatBytes(budget.jsLimit)}`,
			);
		}
		if (measurement.cssBytes > budget.cssLimit) {
			failures.push(
				`${budget.name} route CSS is ${formatBytes(measurement.cssBytes)} gzip, limit ${formatBytes(budget.cssLimit)}`,
			);
		}
		console.log(
			`${budget.name}: ${formatBytes(measurement.jsBytes)} JS gzip, ${formatBytes(measurement.cssBytes)} CSS gzip`,
		);
	}
	checkVendorFiles(clientDir, failures);
	return failures;
}

function sumGzipBytes(clientDir: string, files: string[]): number {
	return files.reduce((total, file) => {
		const filePath = path.join(clientDir, file);
		if (!fs.existsSync(filePath)) {
			throw new Error(`bundle graph asset is missing: ${file}`);
		}
		return total + gzipSync(fs.readFileSync(filePath)).byteLength;
	}, 0);
}

function checkVendorFiles(clientDir: string, failures: string[]): void {
	const vendorDir = path.join(clientDir, "vendor");
	const seen = new Set<string>();
	if (fs.existsSync(vendorDir)) {
		for (const vendorFile of walkFiles(vendorDir)) {
			const relativePath = toPosix(path.relative(clientDir, vendorFile));
			seen.add(relativePath);
			const limit = allowedVendorBudgets.get(relativePath);
			if (!limit) {
				failures.push(`${relativePath} is not registered as an allowed vendor asset`);
				continue;
			}
			const size = fs.statSync(vendorFile).size;
			if (size > limit) {
				failures.push(`${relativePath} is ${formatBytes(size)}, limit ${formatBytes(limit)}`);
			}
		}
	}
	for (const [relativePath] of allowedVendorBudgets) {
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
	return `${(bytes / 1024).toFixed(1)} KiB`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const clientDir = path.join(appRoot, "dist/client");
	const failures = checkClientBundle(clientDir);
	if (failures.length > 0) {
		console.error("campus-web client bundle budget check failed:");
		for (const failure of failures) {
			console.error(`- ${failure}`);
		}
		process.exitCode = 1;
	} else {
		console.log("campus-web route bundle budgets passed.");
	}
}
