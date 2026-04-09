import { describe, expect, it } from "vitest";

import packageManifestRaw from "../package.json?raw";
import mainSource from "../src/main.tsx?raw";
import activeChatSource from "../src/platform/chat/use-active-chat.tsx?raw";
import tsconfigSource from "../tsconfig.json?raw";
import appSidebarSource from "../vendor/vercel-ai-chatbot/components/chat/app-sidebar.tsx?raw";
import sidebarHistoryItemSource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-history-item.tsx?raw";
import sidebarHistorySource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-history.tsx?raw";
import sidebarUserNavSource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-user-nav.tsx?raw";
import viteConfigSource from "../vite.config.ts?raw";

const packageManifest = JSON.parse(packageManifestRaw) as {
  dependencies?: Record<string, string | undefined>;
};

describe("public chat router cutover", () => {
  it("mounts a dedicated route app instead of the legacy public-chat app entry", () => {
    expect(mainSource).toContain("./routes/app-router");
    expect(mainSource).not.toContain("./public-chat/app");
  });

  it("uses TanStack Router instead of react-router-dom in the runtime path", () => {
    expect(packageManifest.dependencies).toHaveProperty("@tanstack/react-router");
    expect(packageManifest.dependencies).not.toHaveProperty("react-router-dom");
    expect(activeChatSource).toContain("@platform/router");
    expect(activeChatSource).not.toContain("react-router-dom");
  });

  it("binds chat runtime navigation and session to repo-owned platform seams rather than next shims", () => {
    expect(appSidebarSource).toContain("@platform/router");
    expect(appSidebarSource).not.toContain('from "next/link"');
    expect(appSidebarSource).not.toContain('from "next/navigation"');

    expect(sidebarHistorySource).toContain("@platform/router");
    expect(sidebarHistorySource).not.toContain('from "next/navigation"');

    expect(sidebarHistoryItemSource).toContain("@platform/router");
    expect(sidebarHistoryItemSource).not.toContain('from "next/link"');

    expect(sidebarUserNavSource).toContain("@platform/router");
    expect(sidebarUserNavSource).toContain("@platform/auth/client");
    expect(sidebarUserNavSource).not.toContain('from "next/navigation"');
    expect(sidebarUserNavSource).not.toContain('from "next-auth/react"');
  });

  it("removes runtime alias ownership for next navigation/auth shims", () => {
    expect(viteConfigSource).not.toContain('"next-auth/react"');
    expect(viteConfigSource).not.toContain('"next-auth"');
    expect(viteConfigSource).not.toContain('"next/link"');
    expect(viteConfigSource).not.toContain('"next/navigation"');

    expect(tsconfigSource).not.toContain('"next-auth/react"');
    expect(tsconfigSource).not.toContain('"next-auth"');
    expect(tsconfigSource).not.toContain('"next/link"');
    expect(tsconfigSource).not.toContain('"next/navigation"');
  });
});
