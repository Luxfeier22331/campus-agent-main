import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": new URL("./src", import.meta.url).pathname,
		},
	},
	test: {
		environment: "jsdom",
		exclude: ["test/**/*.worker.test.ts"],
		globals: true,
		include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
		setupFiles: ["./test/setup.ts"],
		testTimeout: 15_000,
	},
});
