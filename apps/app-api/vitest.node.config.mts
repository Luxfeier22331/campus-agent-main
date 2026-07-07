import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		environment: "node",
		// This suite starts subprocess-based script smoke tests. Keep the Node
		// lane serial to avoid local/CI resource contention causing child
		// process startup timeouts during full app-api test runs.
		fileParallelism: false,
		maxWorkers: 1,
		name: "app-api-node",
		include: ["test/**/*.test.ts"],
		exclude: [
			"test/worker.test.ts",
			"test/worker-scheduled-sweepers.test.ts",
			"test/**/*.integration.test.ts",
		],
	},
});
