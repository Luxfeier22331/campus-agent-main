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
		fileParallelism: false,
		include: ["test/**/*.isolated.test.ts", "test/**/*.isolated.test.tsx"],
		maxWorkers: 1,
		pool: "threads",
		setupFiles: ["./test/setup.ts"],
		testTimeout: 15_000,
	},
});
