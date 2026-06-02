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
		environment: "node",
		exclude: ["test/**/*.worker.test.ts"],
		fileParallelism: false,
		include: ["test/**/*.test.ts", "test/**/*.test.tsx", "test/**/*.mjs.test.ts"],
		maxWorkers: 1,
	},
});
