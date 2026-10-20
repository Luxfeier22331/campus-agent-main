import { cloudflareTest } from "@cloudflare/vitest-plugin";
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
		include: ["test/worker.test.ts"],
		maxWorkers: 1,
	},
});
