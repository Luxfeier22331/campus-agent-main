import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		fileParallelism: false,
		globalSetup: ["./test/app-api-product-db.global-setup.ts"],
		hookTimeout: 180_000,
		environment: "node",
		name: "app-api-shared-db-integration",
		maxWorkers: 1,
		testTimeout: 60_000,
		include: [
			"test/shared-product-db.integration.test.ts",
			"test/transport-schedule-postgres.integration.test.ts",
		],
	},
});
