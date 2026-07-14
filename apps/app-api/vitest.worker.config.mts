import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

export default defineProject({
	plugins: [
		cloudflareTest({
			main: "./src/index.ts",
			wrangler: {
				configPath: "./wrangler.toml",
			},
		}),
	],
	test: {
		fileParallelism: false,
		name: "app-api-worker",
		include: [
			"test/federation-runtime-readiness.test.ts",
			"test/worker.test.ts",
			"test/worker-scheduled-sweepers.test.ts",
		],
		maxWorkers: 1,
	},
});
