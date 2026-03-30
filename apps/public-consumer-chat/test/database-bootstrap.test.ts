// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  classifyBetterAuthTableOwnership,
} from "../scripts/lib/database-bootstrap.mjs";

describe("database bootstrap ownership guard", () => {
  it("treats empty Better Auth placement as a fresh bootstrap", () => {
    expect(
      classifyBetterAuthTableOwnership({
        authSchemaTables: [],
        publicSchemaTables: [],
      }),
    ).toBe("fresh");
  });

  it("detects legacy public-schema Better Auth tables for adoption", () => {
    expect(
      classifyBetterAuthTableOwnership({
        authSchemaTables: [],
        publicSchemaTables: ["account", "session", "user", "verification"],
      }),
    ).toBe("legacy_public_schema");
  });

  it("accepts the target auth schema once all Better Auth tables are moved", () => {
    expect(
      classifyBetterAuthTableOwnership({
        authSchemaTables: ["account", "session", "user", "verification"],
        publicSchemaTables: [],
      }),
    ).toBe("target_schema");
  });

  it("fails closed on partial or conflicting Better Auth placement", () => {
    expect(() =>
      classifyBetterAuthTableOwnership({
        authSchemaTables: ["user"],
        publicSchemaTables: ["session", "account", "verification"],
      }),
    ).toThrow("Conflicting Better Auth table placement");
  });
});
