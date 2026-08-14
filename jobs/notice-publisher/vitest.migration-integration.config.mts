import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		environment: "node",
		fileParallelism: false,
		hookTimeout: 120_000,
		include: ["test/migrate.integration.test.ts"],
		maxWorkers: 1,
		name: "notice-publisher-migration-integration",
		testTimeout: 30_000,
	},
});
