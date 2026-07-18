import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		environment: "node",
		fileParallelism: false,
		include: ["test/**/*.test.ts"],
		maxWorkers: 1,
		name: "agent-runtime",
	},
});
