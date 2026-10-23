import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		fileParallelism: false,
		maxWorkers: 1,
		projects: [
			{
				extends: true,
				test: {
					name: "ops-node-fast",
					environment: "node",
					isolate: false,
					include: ["test/**/*.test.ts"],
					exclude: [
						...configDefaults.exclude,
						"test/browser/**",
						"test/**/*.integration.test.*",
						"test/**/*.isolated.test.*",
					],
					setupFiles: ["./test/setup.ts"],
					sequence: { groupOrder: 1 },
				},
			},
			{
				extends: true,
				test: {
					name: "ops-node-isolated",
					environment: "node",
					isolate: true,
					include: ["test/**/*.isolated.test.ts"],
					exclude: [...configDefaults.exclude, "test/browser/**", "test/**/*.integration.test.*"],
					setupFiles: ["./test/setup.ts"],
					sequence: { groupOrder: 2 },
				},
			},
			{
				extends: true,
				test: {
					name: "ops-dom-fast",
					environment: "jsdom",
					isolate: false,
					include: ["test/**/*.test.tsx"],
					exclude: [
						...configDefaults.exclude,
						"test/browser/**",
						"test/**/*.integration.test.*",
						"test/**/*.isolated.test.*",
					],
					setupFiles: ["./test/setup-dom.ts"],
					sequence: { groupOrder: 3 },
				},
			},
			{
				extends: true,
				test: {
					name: "ops-dom-isolated",
					environment: "jsdom",
					isolate: true,
					include: ["test/**/*.isolated.test.tsx"],
					exclude: [...configDefaults.exclude, "test/browser/**", "test/**/*.integration.test.*"],
					setupFiles: ["./test/setup-dom.ts"],
					sequence: { groupOrder: 4 },
				},
			},
		],
	},
});
