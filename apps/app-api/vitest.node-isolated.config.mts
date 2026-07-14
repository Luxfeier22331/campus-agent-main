import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		environment: "node",
		fileParallelism: false,
		maxWorkers: 1,
		name: "app-api-node-isolated",
		include: ["test/**/*.isolated.test.ts"],
	},
});
