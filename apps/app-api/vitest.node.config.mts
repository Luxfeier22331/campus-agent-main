import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    environment: "node",
    name: "app-api-node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/worker.test.ts", "test/**/*.integration.test.ts"],
  },
});
