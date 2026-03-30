import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    fileParallelism: false,
    hookTimeout: 60_000,
    environment: "node",
    name: "app-api-shared-db-integration",
    testTimeout: 60_000,
    include: [
      "test/shared-product-db.integration.test.ts",
      "test/official-web-shared-db.integration.test.ts",
    ],
  },
});
