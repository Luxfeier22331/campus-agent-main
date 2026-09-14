import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		environment: "node",
		fileParallelism: false,
		isolate: false,
		maxWorkers: 1,
		name: "app-api-node",
		pool: "threads",
		include: ["test/**/*.test.ts"],
		exclude: ["test/**/*.isolated.test.ts", "test/worker.test.ts", "test/**/*.integration.test.ts"],
	},
});
