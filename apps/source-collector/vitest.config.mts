import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: ["vitest.fast.config.mts", "vitest.isolated.config.mts"],
	},
});
