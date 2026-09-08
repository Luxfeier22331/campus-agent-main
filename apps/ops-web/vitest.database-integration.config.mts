import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		environment: "node",
		fileParallelism: false,
		globalSetup: ["./test/ops-web-postgres.global-setup.ts"],
		hookTimeout: 300_000,
		include: [
			"test/dining-bootstrap.integration.test.ts",
			"test/dining-content-store.integration.test.ts",
			"test/ops-web-database.integration.test.ts",
			"test/transport-store.integration.test.ts",
		],
		maxWorkers: 1,
		name: "ops-web-postgres-integration",
		testTimeout: 60_000,
	},
});
