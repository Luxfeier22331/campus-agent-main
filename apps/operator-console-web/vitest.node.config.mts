import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environmentMatchGlobs: [["test/**/*.test.tsx", "jsdom"]],
		include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
		setupFiles: ["test/setup.ts"],
		exclude: ["test/worker.test.ts"],
	},
});
