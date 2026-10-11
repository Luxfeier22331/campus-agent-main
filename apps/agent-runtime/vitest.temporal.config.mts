import { defineProject } from "vitest/config";
export default defineProject({
	test: {
		environment: "node",
		fileParallelism: false,
		include: ["test/temporal-workflow.test.ts"],
		maxWorkers: 1,
		name: "agent-runtime-temporal",
	},
});
