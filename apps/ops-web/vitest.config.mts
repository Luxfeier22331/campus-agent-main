import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		exclude: [...configDefaults.exclude, "test/browser/**"],
		setupFiles: ["./test/setup.ts"],
	},
});
