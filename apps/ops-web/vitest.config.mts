import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		exclude: [...configDefaults.exclude, "test/browser/**", "test/**/*.integration.test.ts"],
		setupFiles: ["./test/setup.ts"],
	},
});
