// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const appRoot = join(import.meta.dirname, "..");

const readAppFile = (relativePath: string) =>
  readFileSync(join(appRoot, relativePath), "utf8");

describe("public-consumer-chat scaffold contracts", () => {
  it("switches package scripts and dependencies to TanStack Start", () => {
    const packageJson = JSON.parse(readAppFile("package.json")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };

    expect(packageJson.scripts.dev).toBeTruthy();
    expect(packageJson.scripts.build).toBeTruthy();
    expect(packageJson.scripts.start).toBeTruthy();
    expect(packageJson.scripts).not.toHaveProperty("dev:client");
    expect(packageJson.scripts).not.toHaveProperty("dev:server");

    expect(packageJson.dependencies).toHaveProperty("@tanstack/react-start");
    expect(packageJson.dependencies).toHaveProperty("@tanstack/react-router");
    expect(packageJson.dependencies).toHaveProperty("better-auth");
    expect(packageJson.dependencies).toHaveProperty("lucide-react");
    expect(packageJson.dependencies).toHaveProperty("motion");
    expect(packageJson.dependencies).toHaveProperty("pg");
    expect(packageJson.dependencies).not.toHaveProperty("react-router-dom");
    expect(packageJson.dependencies).not.toHaveProperty("hono");
    expect(packageJson.dependencies).not.toHaveProperty("@hono/node-server");
  });

  it("adds the TanStack Start route and server boundary files", () => {
    const requiredFiles = [
      "app/components/chat/chat-composer.tsx",
      "app/components/chat/chat-confirm-dialog.tsx",
      "app/components/chat/chat-greeting.tsx",
      "app/components/chat/chat-history-list.tsx",
      "app/components/chat/chat-icons.tsx",
      "app/components/chat/chat-message-list.tsx",
      "app/components/chat/chat-page.tsx",
      "app/components/chat/chat-shell.tsx",
      "app/components/chat/sidebar-user-nav.tsx",
      "app/hooks/use-scroll-to-bottom.ts",
      "app/start.ts",
      "app/routes/index.tsx",
      "app/routes/__root.tsx",
      "app/routes/login.tsx",
      "app/routes/chat.tsx",
      "app/routes/chat.index.tsx",
      "app/routes/chat.$conversationId.tsx",
      "app/routes/api.auth.$.ts",
      "app/routes/api.conversations.ts",
      "app/routes/api.conversations.$conversationId.ts",
      "app/routes/api.answer.ts",
      "app/router.tsx",
      "app/routeTree.gen.ts",
      "app/lib/auth.server.ts",
      "app/lib/auth-client.ts",
      "app/lib/env.server.ts",
      "app/lib/db.server.ts",
      "app/lib/session.server.ts",
      "app/lib/public-chat-client.ts",
      "app/lib/conversations.server.ts",
    ];

    for (const relativePath of requiredFiles) {
      expect(existsSync(join(appRoot, relativePath)), relativePath).toBe(true);
    }
  });

  it("defines a postgres env contract and schema entry instead of sqlite", () => {
    const source = readAppFile("app/lib/env.server.ts");

    expect(source).toContain("PUBLIC_CONSUMER_CHAT_DATABASE_URL");
    expect(source).toContain("PUBLIC_CONSUMER_CHAT_AUTH_SCHEMA");
    expect(source).toContain("PUBLIC_CONSUMER_CHAT_CHAT_SCHEMA");
    expect(source).toContain("PUBLIC_CONSUMER_CHAT_INGESTION_REGISTRY_SCHEMA");
    expect(source).toContain("Supabase Postgres");
    expect(source).not.toContain("PUBLIC_CONSUMER_CHAT_DB_PATH");
    expect(source).not.toContain("sqlite");
  });

  it("uses official TanStack Start host wiring instead of direct vinxi or manual router bootstraps", () => {
    const packageJson = JSON.parse(readAppFile("package.json")) as {
      scripts: Record<string, string>;
    };
    const viteConfig = readAppFile("vite.config.ts");
    const authApiRoute = readAppFile("app/routes/api.auth.$.ts");
    const conversationsApiRoute = readAppFile("app/routes/api.conversations.ts");
    const chatRoute = readAppFile("app/routes/chat.tsx");

    expect(packageJson.scripts.dev).toBe("vite dev --host 127.0.0.1 --port 3000");
    expect(packageJson.scripts.build).toBe("vite build");
    expect(packageJson.scripts.start).toBe("node scripts/start-dist-server.mjs");
    expect(viteConfig).toContain("tanstackStart");
    expect(viteConfig).toContain('srcDirectory: "app"');
    expect(authApiRoute).toContain('createFileRoute("/api/auth/$")');
    expect(conversationsApiRoute).toContain('createFileRoute("/api/conversations")');
    expect(conversationsApiRoute).not.toContain("DEV_OWNER_ID");
    expect(chatRoute).toContain("Outlet");
  });

  it("defines an app-specific not-found boundary instead of the TanStack Router fallback paragraph", () => {
    const rootRoute = readAppFile("app/routes/__root.tsx");

    expect(rootRoute).toContain("notFoundComponent");
    expect(rootRoute).toContain("PageNotFound");
    expect(rootRoute).toContain("/chat");
    expect(rootRoute).toContain("/login");
    expect(rootRoute).not.toContain("<p>Not Found</p>");
  });

  it("routes consume a shared chatbot-style page scaffold instead of inlining the whole shell", () => {
    const chatIndexRoute = readAppFile("app/routes/chat.index.tsx");
    const chatConversationRoute = readAppFile("app/routes/chat.$conversationId.tsx");
    const chatPage = readAppFile("app/components/chat/chat-page.tsx");
    const chatShell = readAppFile("app/components/chat/chat-shell.tsx");
    const confirmDialog = readAppFile("app/components/chat/chat-confirm-dialog.tsx");
    const chatComposer = readAppFile("app/components/chat/chat-composer.tsx");
    const chatIcons = readAppFile("app/components/chat/chat-icons.tsx");
    const chatGreeting = readAppFile("app/components/chat/chat-greeting.tsx");
    const chatMessageList = readAppFile("app/components/chat/chat-message-list.tsx");
    const rootRoute = readAppFile("app/routes/__root.tsx");
    const sidebarUserNav = readAppFile("app/components/chat/sidebar-user-nav.tsx");

    expect(chatIndexRoute).toContain("ChatPage");
    expect(chatConversationRoute).toContain("ChatPage");
    expect(chatPage).toContain("ChatShell");
    expect(chatPage).toContain("ChatComposer");
    expect(chatPage).toContain("ChatMessageList");
    expect(chatPage).toContain("ChatConfirmDialog");
    expect(chatPage).not.toContain("window.confirm");
    expect(chatShell).toContain("SidebarUserNav");
    expect(chatShell).toContain("chat-sidebar-rail");
    expect(chatShell).toContain("MenuIcon");
    expect(chatShell).toContain("PanelLeftIcon");
    expect(chatShell).toContain('from "motion/react"');
    expect(chatComposer).toContain("SendIcon");
    expect(confirmDialog).toContain('role="dialog"');
    expect(confirmDialog).toContain('from "motion/react"');
    expect(chatGreeting).toContain('from "motion/react"');
    expect(chatMessageList).toContain('from "motion/react"');
    expect(chatIcons).toContain('from "lucide-react"');
    expect(rootRoute).toContain("MotionConfig");
    expect(sidebarUserNav).toContain('from "motion/react"');
  });

  it("chat routes refresh client-visible history after mutations instead of trusting stale loader snapshots", () => {
    const chatIndexRoute = readAppFile("app/routes/chat.index.tsx");
    const chatConversationRoute = readAppFile("app/routes/chat.$conversationId.tsx");

    expect(chatIndexRoute).toContain("listConversationsClient");
    expect(chatIndexRoute).toContain("useEffect");
    expect(chatConversationRoute).toContain("listConversationsClient");
    expect(chatConversationRoute).toContain("getConversationClient");
    expect(chatConversationRoute).toContain("useEffect");
  });
});
