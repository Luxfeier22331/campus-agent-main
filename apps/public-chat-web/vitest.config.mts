import path from "node:path";
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
	resolve: {
		alias: [
			{
				find: /^@\/lib\/errors$/,
				replacement: path.resolve(__dirname, "vendor/vercel-ai-chatbot/lib/errors.ts"),
			},
		],
	},
	test: {
		// The Workers pool is stable here only when files execute sequentially.
		// Parallel file startup can exhaust the Miniflare/WebSocket bridge and
		// surface intermittent `socket hang up` failures on full-suite runs.
		fileParallelism: false,
		maxWorkers: 1,
		include: ["test/**/*.test.ts"],
	},
});
