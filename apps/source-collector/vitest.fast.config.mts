import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		environment: "node",
		exclude: ["adapters/**/*.isolated.test.ts"],
		fileParallelism: false,
		include: ["adapters/**/*.test.ts", "test/**/*.test.ts"],
		isolate: false,
		maxWorkers: 1,
		name: "source-collector-fast",
		silent: "passed-only",
	},
});
