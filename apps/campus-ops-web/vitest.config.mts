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
		// The ops workspace suite mounts route-heavy jsdom surfaces. Keep file
		// startup serial so full graph runs do not time out starting workers.
		fileParallelism: false,
		globals: true,
		include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
		maxWorkers: 1,
		setupFiles: ["./test/setup.ts"],
		testTimeout: 15_000,
	},
});
