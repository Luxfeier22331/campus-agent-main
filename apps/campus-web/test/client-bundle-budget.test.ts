import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import type { CampusBundleGraph } from "../config/bundle-graph";
import {
	checkClientBundle,
	checkDocsClientBundle,
	collectStaticChunkClosure,
	measureRouteBundle,
} from "../scripts/check-client-bundle-budget";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { force: true, recursive: true });
	}
});

describe("campus-web bundle integrity and size warnings", () => {
	it("collects static dependencies without following dynamic imports", () => {
		const graph = createGraph();

		expect(collectStaticChunkClosure(graph, [graph.entry, "assets/map.js"])).toEqual([
			"assets/index.js",
			"assets/map.js",
			"assets/react.js",
		]);
	});

	it("measures the gzip size of a route static dependency closure", () => {
		const clientDir = createClientDirectory({
			"assets/index.css": "body { color: #111; }",
			"assets/index.js": "export const app = true;",
			"assets/map.css": ".map { display: grid; }",
			"assets/map.js": "export const map = true;",
			"assets/react.js": "export const react = true;",
		});
		const graph = createGraph();

		const measurement = measureRouteBundle({
			clientDir,
			facades: ["/src/app/routes/map-page.tsx"],
			graph,
		});

		expect(measurement.jsFiles).toEqual(["assets/index.js", "assets/map.js", "assets/react.js"]);
		expect(measurement.cssFiles).toEqual(["assets/index.css", "assets/map.css"]);
		expect(measurement.jsBytes).toBe(
			gzipBytes("export const app = true;") +
				gzipBytes("export const map = true;") +
				gzipBytes("export const react = true;"),
		);
		expect(measurement.cssBytes).toBe(
			gzipBytes("body { color: #111; }") + gzipBytes(".map { display: grid; }"),
		);
	});

	it("measures the app shell without following route imports", () => {
		const clientDir = createClientDirectory({
			"assets/index.css": "body { color: #111; }",
			"assets/index.js": "export const app = true;",
			"assets/map.js": "export const map = true;",
			"assets/react.js": "export const react = true;",
		});
		const graph = createGraph();

		const measurement = measureRouteBundle({ clientDir, facades: [], graph });

		expect(measurement.jsFiles).toEqual(["assets/index.js", "assets/react.js"]);
		expect(measurement.cssFiles).toEqual(["assets/index.css"]);
	});

	it("measures the docs entry without including the app shell", () => {
		const clientDir = createClientDirectory({
			"assets/docs.css": ".docs { display: grid; }",
			"assets/docs.js": "export const docs = true;",
			"assets/index.css": "body { color: #111; }",
			"assets/index.js": "export const app = true;",
			"assets/react.js": "export const react = true;",
		});
		const graph = createGraph();

		const measurement = measureRouteBundle({
			clientDir,
			entry: "docs",
			facades: [],
			graph,
		});

		expect(measurement.jsFiles).toEqual(["assets/docs.js", "assets/react.js"]);
		expect(measurement.cssFiles).toEqual(["assets/docs.css"]);
	});

	it("reports a large route as a warning without blocking the build", () => {
		const clientDir = createCompleteClientDirectory(incompressibleBytes(513 * 1024));
		const graphPath = writeGraph(clientDir, createCompleteAppGraph());

		const result = checkClientBundle(clientDir, graphPath);

		expect(result.failures).toEqual([]);
		expect(result.warnings.some((warning) => warning.startsWith("home route JS is"))).toBe(true);
		expect(
			result.warnings.some((warning) => warning.includes("warning threshold 512000 bytes")),
		).toBe(true);
	});

	it("does not warn for a route below the size threshold", () => {
		const clientDir = createCompleteClientDirectory();
		const graphPath = writeGraph(clientDir, createCompleteAppGraph());

		const result = checkClientBundle(clientDir, graphPath);

		expect(result.failures).toEqual([]);
		expect(result.warnings).toEqual([]);
	});

	it("keeps missing bundle assets as integrity failures", () => {
		const clientDir = createCompleteClientDirectory();
		const graphPath = writeGraph(clientDir, createCompleteAppGraph());
		fs.rmSync(path.join(clientDir, "assets/react.js"));

		const result = checkClientBundle(clientDir, graphPath);

		expect(result.failures).toContain("bundle graph asset is missing: assets/react.js");
		expect(result.warnings).toEqual([]);
	});

	it("reports a large docs entry as a warning without blocking the build", () => {
		const clientDir = createClientDirectory({
			"assets/docs.js": incompressibleBytes(513 * 1024),
			"assets/docs.css": ".docs { display: grid; }",
			"assets/react.js": "export const react = true;",
		});
		const graphPath = writeGraph(clientDir, createGraph());

		const result = checkDocsClientBundle(clientDir, graphPath);

		expect(result.failures).toEqual([]);
		expect(result.warnings.some((warning) => warning.startsWith("docs JS is"))).toBe(true);
	});

	it("keeps missing vendor registration as an integrity failure", () => {
		const clientDir = createCompleteClientDirectory();
		const graphPath = writeGraph(clientDir, createCompleteAppGraph());
		fs.rmSync(path.join(clientDir, "vendor/maplibre-gl/LICENSE.txt"));

		const result = checkClientBundle(clientDir, graphPath);

		expect(result.failures).toContain(
			"missing registered vendor asset vendor/maplibre-gl/LICENSE.txt",
		);
	});

	it("keeps bundle analysis metadata outside the deployable client directory", () => {
		const viteConfig = fs.readFileSync("vite.config.ts", "utf8");
		const bundleGraphPlugin = fs.readFileSync("config/bundle-graph.ts", "utf8");

		expect(viteConfig).toContain('".generated/bundle-graph.json"');
		expect(viteConfig).toContain('".generated/docs-bundle-graph.json"');
		expect(bundleGraphPlugin).not.toContain("this.emitFile");
	});
});

function createGraph(): CampusBundleGraph {
	return {
		chunks: {
			"assets/auth.js": {
				css: ["assets/auth.css"],
				dynamicImports: [],
				facadeModuleId: "/repo/src/components/auth/auth-dialog.tsx",
				imports: ["assets/react.js"],
				isEntry: false,
			},
			"assets/index.js": {
				css: ["assets/index.css"],
				dynamicImports: ["assets/auth.js", "assets/map.js"],
				facadeModuleId: "/repo/src/main.tsx",
				imports: ["assets/react.js"],
				isEntry: true,
			},
			"assets/docs.js": {
				css: ["assets/docs.css"],
				dynamicImports: [],
				facadeModuleId: null,
				imports: ["assets/react.js"],
				isEntry: false,
			},
			"assets/map.js": {
				css: ["assets/map.css"],
				dynamicImports: [],
				facadeModuleId: "/repo/src/app/routes/map-page.tsx",
				imports: ["assets/react.js"],
				isEntry: false,
			},
			"assets/react.js": {
				css: [],
				dynamicImports: [],
				facadeModuleId: null,
				imports: [],
				isEntry: false,
			},
		},
		docsEntry: "assets/docs.js",
		entry: "assets/index.js",
	};
}

function createCompleteAppGraph(): CampusBundleGraph {
	const graph = createGraph();
	const entryChunk = graph.chunks[graph.entry];
	if (!entryChunk) {
		throw new Error(`bundle graph is missing its entry chunk: ${graph.entry}`);
	}
	const routeFacades = [
		["home", "/repo/src/app/routes/home-page.tsx"],
		["map", "/repo/src/app/routes/map-page.tsx"],
		["dining", "/repo/src/app/routes/dining-page.tsx"],
		["groups", "/repo/src/app/routes/interest-groups-page.tsx"],
		["feedback", "/repo/src/app/routes/feedback-page.tsx"],
		["account", "/repo/src/app/routes/account-page.tsx"],
		["account-entry", "/repo/src/components/auth/user/product-account-entry.tsx"],
	] as const;

	for (const [name, facadeModuleId] of routeFacades) {
		const file = `assets/${name}.js`;
		graph.chunks[file] = {
			css: [`assets/${name}.css`],
			dynamicImports: [],
			facadeModuleId,
			imports: ["assets/react.js"],
			isEntry: false,
		};
		entryChunk.dynamicImports.push(file);
	}
	return graph;
}

function createCompleteClientDirectory(
	homeContents: string | Uint8Array = "export const home = true;",
): string {
	const files: Record<string, string | Uint8Array> = {
		"assets/account-entry.css": ".account-entry {}",
		"assets/account-entry.js": "export const accountEntry = true;",
		"assets/account.css": ".account {}",
		"assets/account.js": "export const account = true;",
		"assets/dining.css": ".dining {}",
		"assets/dining.js": "export const dining = true;",
		"assets/feedback.css": ".feedback {}",
		"assets/feedback.js": "export const feedback = true;",
		"assets/groups.css": ".groups {}",
		"assets/groups.js": "export const groups = true;",
		"assets/home.css": ".home {}",
		"assets/home.js": homeContents,
		"assets/index.css": "body { color: #111; }",
		"assets/index.js": "export const app = true;",
		"assets/map.css": ".map {}",
		"assets/map.js": "export const map = true;",
		"assets/react.js": "export const react = true;",
		"vendor/maplibre-gl/LICENSE.txt": "MapLibre license",
		"vendor/maplibre-gl/maplibre-gl-worker.mjs": "export const worker = true;",
		"vendor/maplibre-gl/maplibre-gl.css": ".maplibre {}",
		"vendor/maplibre-gl/maplibre-gl.mjs": "export const maplibre = true;",
		"vendor/maplibre-gl/maplibre-gl-runtime.mjs":
			"import * as maplibregl from './maplibre-gl.mjs'; window.maplibregl = maplibregl;",
	};
	return createClientDirectory(files);
}

function createClientDirectory(files: Record<string, string | Uint8Array>): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "campus-web-bundle-budget-"));
	temporaryDirectories.push(directory);
	for (const [relativePath, contents] of Object.entries(files)) {
		const filePath = path.join(directory, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, contents);
	}
	return directory;
}

function writeGraph(clientDir: string, graph: CampusBundleGraph): string {
	const graphPath = path.join(clientDir, "graph.json");
	fs.writeFileSync(graphPath, `${JSON.stringify(graph)}\n`);
	return graphPath;
}

function incompressibleBytes(size: number): Uint8Array {
	const bytes = new Uint8Array(size);
	let state = 0x12345678;
	for (let index = 0; index < bytes.length; index += 1) {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		bytes[index] = (state >>> 24) & 0xff;
	}
	return bytes;
}

function gzipBytes(contents: string | Uint8Array): number {
	return gzipSync(contents).byteLength;
}
