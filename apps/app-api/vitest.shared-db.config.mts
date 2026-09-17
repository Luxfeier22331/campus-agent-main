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
			"test/account-admin-postgres.integration.test.ts",
			"test/chat-feedback-postgres.integration.test.ts",
			"test/account-journeys-postgres.integration.test.ts",
			"test/account-lifecycle-postgres.integration.test.ts",
			"test/campus-groups-postgres.integration.test.ts",
			"test/dining-submissions-postgres.integration.test.ts",
			"test/dining-lifecycle-media-postgres.integration.test.ts",
			"test/dining-lifecycle-postgres.integration.test.ts",
			"test/dining-reviews-postgres.integration.test.ts",
			"test/email-access-postgres.integration.test.ts",
			"test/runtime-run-postgres.integration.test.ts",
			"test/shared-product-db.integration.test.ts",
		],
	},
});
