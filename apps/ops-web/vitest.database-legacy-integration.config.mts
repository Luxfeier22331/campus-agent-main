import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		environment: "node",
		fileParallelism: false,
		globalSetup: ["./test/ops-web-postgres-legacy.global-setup.ts"],
		hookTimeout: 300_000,
		include: ["test/ops-web-database-legacy.integration.test.ts"],
		maxWorkers: 1,
		name: "ops-web-postgres-legacy-integration",
		testTimeout: 60_000,
	},
});
