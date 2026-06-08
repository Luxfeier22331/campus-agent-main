import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	test: {
		environment: "jsdom",
		exclude: ["test/**/*.worker.test.ts"],
		include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
		setupFiles: ["./test/setup.ts"],
	},
});
