import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		environment: "node",
		fileParallelism: false,
		hookTimeout: 180_000,
		include: ["test/migration.database.integration.test.ts"],
		maxWorkers: 1,
		name: "dining-sync-database-integration",
		testTimeout: 60_000,
	},
});
