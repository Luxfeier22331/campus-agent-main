import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import type { CampusBundleGraph } from "../config/bundle-graph";
import {
	collectStaticChunkClosure,
	measureRouteBundle,
} from "../scripts/check-client-bundle-budget";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { force: true, recursive: true });
	}
});

describe("campus-web route bundle budgets", () => {
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

function createClientDirectory(files: Record<string, string>): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "campus-web-bundle-budget-"));
	temporaryDirectories.push(directory);
	for (const [relativePath, contents] of Object.entries(files)) {
		const filePath = path.join(directory, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, contents);
	}
	return directory;
}

function gzipBytes(contents: string): number {
	return gzipSync(contents).byteLength;
}
