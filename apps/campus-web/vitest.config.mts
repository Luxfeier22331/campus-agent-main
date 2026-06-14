import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			"virtual-page-data": path.resolve(__dirname, "test/fixtures/virtual-page-data.ts"),
		},
	},
	test: {
		environment: "jsdom",
		exclude: ["test/**/*.worker.test.ts"],
		// The UI suite mounts full app surfaces with jsdom. Keep file startup
		// serial so CI graph runs do not starve Vitest workers under load.
		fileParallelism: false,
		include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
		maxWorkers: 1,
		setupFiles: ["./test/setup.ts"],
		testTimeout: 15_000,
	},
});
