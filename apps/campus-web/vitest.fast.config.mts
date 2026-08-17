import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const campusWebRoot = import.meta.dirname;

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": path.resolve(campusWebRoot, "src"),
			"virtual-page-data": path.resolve(campusWebRoot, "test/fixtures/virtual-page-data.ts"),
		},
	},
	test: {
		environment: "jsdom",
		exclude: [
			"test/**/*.isolated.test.ts",
			"test/**/*.isolated.test.tsx",
			"test/**/*.worker.test.ts",
		],
		fileParallelism: false,
		include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
		isolate: false,
		maxWorkers: 1,
		setupFiles: ["./test/setup.ts"],
		testTimeout: 15_000,
	},
});
