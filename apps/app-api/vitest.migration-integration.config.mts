import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		environment: "node",
		fileParallelism: false,
		hookTimeout: 180_000,
		include: ["test/app-api-migration-upgrade.integration.test.ts"],
		maxWorkers: 1,
		name: "app-api-migration-integration",
		testTimeout: 60_000,
	},
});
