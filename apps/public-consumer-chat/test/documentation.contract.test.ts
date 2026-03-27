// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

describe("04.7 documentation contracts", () => {
  it("updates the boundary handoff to the accepted host and storage direction", () => {
    const source = readRepoFile(
      ".planning/phases/04.7-public-consumer-chat-app-design/04.7-CONSUMER-APP-BOUNDARY-HANDOFF.md",
    );

    expect(source).toContain("TanStack Start");
    expect(source).toContain("Better Auth");
    expect(source).toContain("Supabase Postgres");
    expect(source).toContain("Qdrant");
    expect(source).toContain("auth");
    expect(source).toContain("chat");
    expect(source).toContain("Worker-side identity material 不能被当作 canonical app identity");
    expect(source).toContain("不采用裸 `TanStack Router + 外挂后端壳`");
    expect(source).toContain("不采用 `D1 for auth`");
  });

  it("updates the implementation handoff to freeze the runtime and persistence boundary", () => {
    const source = readRepoFile(
      ".planning/phases/04.7-public-consumer-chat-app-design/04.7-IMPLEMENTATION-HANDOFF.md",
    );

    expect(source).toContain("TanStack Start");
    expect(source).toContain("Better Auth");
    expect(source).toContain("Supabase Postgres");
    expect(source).toContain("Qdrant");
    expect(source).toContain("auth/chat 同库分 schema");
    expect(source).toContain("Worker admission 仍然只是 outer access control");
    expect(source).toContain("不把 app auth / conversation API 回灌到 `apps/supervisor-api`");
    expect(source).toContain("不采用 `D1 for auth`");
  });

  it("rewrites the app README away from the Vite Hono SQLite scaffold", () => {
    const source = readRepoFile("apps/public-consumer-chat/README.md");

    expect(source).toContain("TanStack Start");
    expect(source).toContain("Better Auth");
    expect(source).toContain("Supabase Postgres");
    expect(source).toContain("Qdrant");
    expect(source).toContain("same-site");
    expect(source).toContain("Worker admission is not canonical app identity truth");
    expect(source).not.toContain("Vite dev client");
    expect(source).not.toContain("app-local Hono server");
    expect(source).not.toContain("PUBLIC_CONSUMER_CHAT_DB_PATH");
    expect(source).not.toContain("public-consumer-chat.db");
  });

  it("documents repo root supervisor-api env defaults that align with public-consumer-chat live mode", () => {
    const source = readRepoFile(".env.example");

    expect(source).toContain("API_BEARER_TOKEN=local-dev-token");
    expect(source).toContain("API_DEFAULT_ACTOR_GROUPS=students");
    expect(source).toContain("API_DEFAULT_ACTOR_ROLES=student");
    expect(source).toContain("API_DEFAULT_CAMPUS_SCOPE=main");
    expect(source).toContain("SUPERVISOR_API_BEARER_TOKEN");
    expect(source).toContain("must match");
  });
});
