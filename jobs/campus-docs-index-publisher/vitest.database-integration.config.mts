import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		environment: "node",
		fileParallelism: false,
		hookTimeout: 180_000,
		include: ["test/catalog.database.integration.test.ts"],
		maxWorkers: 1,
		name: "campus-docs-index-publisher-postgres-integration",
		testTimeout: 60_000,
	},
});
