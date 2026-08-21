import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		environment: "node",
		exclude: ["adapters/**/*.isolated.test.ts"],
		fileParallelism: false,
		include: ["adapters/**/*.test.ts", "test/**/*.test.ts"],
		maxWorkers: 1,
		name: "internal-portal-collection-fast",
		silent: "passed-only",
	},
});
