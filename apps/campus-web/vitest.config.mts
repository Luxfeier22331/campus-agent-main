import path from "node:path";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const domScripts = [
	"runtime-config",
	"maplibre-boundary",
	"browser-answer-timing",
	"docs-data-source",
	"docs-router",
	"notices-content-html",
	"dining-floorplan-asset-loader",
].map((name) => `test/${name}.test.ts`);
const excluded = [
	...configDefaults.exclude,
	"test/**/*.worker.test.ts",
	"test/**/*.integration.test.ts",
	"test/**/*.browser.test.ts",
	"test/**/*.browser.test.tsx",
];

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "src"),
			"virtual-page-data": path.resolve(import.meta.dirname, "test/fixtures/virtual-page-data.ts"),
		},
	},
	test: {
		fileParallelism: false,
		maxWorkers: 1,
		projects: [
			{
				extends: true,
				test: {
					name: "campus-node-fast",
					environment: "node",
					isolate: false,
					include: ["test/**/*.test.ts"],
					exclude: [...excluded, "test/**/*.isolated.test.ts", ...domScripts],
					setupFiles: ["./test/setup-node.ts"],
					sequence: { groupOrder: 1 },
				},
			},
			{
				extends: true,
				test: {
					name: "campus-dom-fast",
					environment: "jsdom",
					isolate: false,
					include: ["test/**/*.test.tsx", ...domScripts],
					exclude: [...excluded, "test/**/*.isolated.test.tsx"],
					setupFiles: ["./test/setup.ts"],
					sequence: { groupOrder: 2 },
				},
			},
			{
				extends: true,
				test: {
					name: "campus-node-isolated",
					environment: "node",
					isolate: true,
					include: ["test/**/*.isolated.test.ts"],
					exclude: excluded,
					setupFiles: ["./test/setup-node.ts"],
					sequence: { groupOrder: 3 },
				},
			},
			{
				extends: true,
				test: {
					name: "campus-dom-isolated",
					environment: "jsdom",
					isolate: true,
					include: ["test/**/*.isolated.test.tsx"],
					exclude: excluded,
					setupFiles: ["./test/setup.ts"],
					sequence: { groupOrder: 4 },
				},
			},
		],
		testTimeout: 15_000,
	},
});
