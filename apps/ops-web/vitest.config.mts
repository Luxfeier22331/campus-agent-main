import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		fileParallelism: false,
		maxWorkers: 1,
		projects: [
			{
				test: {
					name: "ops-node",
					environment: "node",
					include: ["test/**/*.test.ts"],
					exclude: [...configDefaults.exclude, "test/browser/**", "test/**/*.integration.test.ts"],
					fileParallelism: false,
					maxWorkers: 1,
					isolate: true,
					sequence: { groupOrder: 1 },
					setupFiles: ["./test/setup.ts"],
				},
			},
			{
				test: {
					name: "ops-dom",
					environment: "jsdom",
					include: ["test/**/*.test.tsx"],
					exclude: [...configDefaults.exclude, "test/browser/**", "test/**/*.integration.test.tsx"],
					fileParallelism: false,
					maxWorkers: 1,
					isolate: true,
					sequence: { groupOrder: 2 },
					setupFiles: ["./test/setup-dom.ts"],
				},
			},
		],
	},
});
