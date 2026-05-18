import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			main: "./src/index.ts",
			wrangler: {
				configPath: "./wrangler.test.toml",
			},
		}),
	],
	test: {
		// The Workers pool is stable here only when files execute sequentially.
		// Parallel startup can leave the Cloudflare test bridge stuck before the
		// worker suite begins executing assertions.
		fileParallelism: false,
		maxWorkers: 1,
		include: ["test/worker.test.ts"],
	},
});
