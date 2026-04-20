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
    // Parallel file startup can exhaust the Miniflare/WebSocket bridge and
    // surface intermittent `socket hang up` failures on full-suite runs.
    fileParallelism: false,
    maxWorkers: 1,
    include: ["test/**/*.test.ts"],
  },
});
