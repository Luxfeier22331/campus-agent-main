import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		exclude: ["test/**/*.worker.test.ts"],
		fileParallelism: false,
		include: ["test/**/*.test.ts"],
		maxWorkers: 1,
		testTimeout: 15_000,
	},
});
