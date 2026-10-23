import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		environment: "node",
		fileParallelism: false,
		hookTimeout: 120_000,
		include: ["test/**/*.database.integration.test.ts"],
		maxWorkers: 1,
		name: "notice-index-publisher-database-integration",
		testTimeout: 30_000,
	},
});
