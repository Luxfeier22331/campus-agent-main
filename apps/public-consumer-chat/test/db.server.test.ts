// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  buildPoolConfig,
  buildPostgresSearchPathConnectionString,
} from "../app/lib/db.server";

describe("postgres search_path connection helper", () => {
  it("adds the auth schema search_path for Better Auth migrations", () => {
    const nextUrl = buildPostgresSearchPathConnectionString(
      "postgres://postgres:secret@example.com:5432/postgres",
      ["auth", "public"],
    );

    expect(nextUrl).toContain("search_path%3Dauth%2Cpublic");
  });

  it("preserves existing query params while appending options", () => {
    const nextUrl = buildPostgresSearchPathConnectionString(
      "postgres://postgres:secret@example.com:5432/postgres?sslmode=require",
      ["auth", "public"],
    );

    expect(nextUrl).toContain("sslmode=require");
    expect(nextUrl).toContain("search_path%3Dauth%2Cpublic");
  });

  it("uses a conservative non-production pool profile for Supabase session mode", () => {
    const config = buildPoolConfig({
      connectionString: "postgres://postgres:secret@example.com:5432/postgres",
      databaseSslMode: "require",
      nodeEnv: "development",
    });

    expect(config.max).toBe(1);
    expect(config.allowExitOnIdle).toBe(true);
    expect(config.idleTimeoutMillis).toBe(5_000);
    expect(config.connectionTimeoutMillis).toBe(5_000);
  });

  it("keeps a bounded production pool profile", () => {
    const config = buildPoolConfig({
      connectionString: "postgres://postgres:secret@example.com:5432/postgres",
      databaseSslMode: "require",
      nodeEnv: "production",
    });

    expect(config.max).toBe(4);
    expect(config.allowExitOnIdle).toBe(false);
    expect(config.idleTimeoutMillis).toBe(30_000);
  });
});
