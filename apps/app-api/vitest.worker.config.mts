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
		name: "app-api-worker",
		include: ["test/worker.test.ts"],
	},
});
