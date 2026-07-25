import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		exclude: [...configDefaults.exclude, "test/browser/**", "test/**/*.integration.test.ts"],
		fileParallelism: false,
		maxWorkers: 1,
		setupFiles: ["./test/setup.ts"],
	},
});
