import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		environment: "node",
		fileParallelism: false,
		hookTimeout: 180_000,
		include: ["test/ingestion-control-postgres.database.integration.test.ts"],
		maxWorkers: 1,
		name: "ingestion-control-postgres-integration",
		testTimeout: 60_000,
	},
});
