import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["vitest.node.config.mts", "vitest.worker.config.mts"],
  },
});
