import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		environment: "node",
		fileParallelism: false,
		include: ["adapters/**/*.isolated.test.ts"],
		maxWorkers: 1,
		name: "source-collector-isolated",
		silent: "passed-only",
		testTimeout: 15_000,
	},
});
