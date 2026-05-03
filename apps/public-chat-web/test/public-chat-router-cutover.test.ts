import { describe, expect, it } from "vitest";

import packageManifestRaw from "../package.json?raw";
import mainSource from "../src/main.tsx?raw";
import activeChatSource from "../src/platform/chat/use-active-chat.tsx?raw";
import tsconfigSource from "../tsconfig.json?raw";
import appSidebarSource from "../vendor/vercel-ai-chatbot/components/chat/app-sidebar.tsx?raw";
import sidebarHistorySource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-history.tsx?raw";
import sidebarHistoryItemSource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-history-item.tsx?raw";
import sidebarUserNavSource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-user-nav.tsx?raw";
import viteConfigSource from "../vite.config.ts?raw";

const packageManifest = JSON.parse(packageManifestRaw) as {
	dependencies?: Record<string, string | undefined>;
};

describe("public chat router cutover", () => {
	it("mounts a dedicated route app instead of the legacy public-chat app entry", () => {
		expect(mainSource).toContain("./routes/app-router");
		expect(mainSource).toContain("PublicChatAppFrame");
		expect(mainSource).not.toContain("./public-chat/app");
	});

	it("uses TanStack Router instead of react-router-dom in the runtime path", () => {
		expect(packageManifest.dependencies).toHaveProperty("@tanstack/react-router");
		expect(packageManifest.dependencies).not.toHaveProperty("react-router-dom");
		expect(activeChatSource).toContain("@platform/router");
		expect(activeChatSource).not.toContain("react-router-dom");
	});

	it("binds chat runtime navigation and session to repo-owned platform seams rather than next shims", () => {
		expect(appSidebarSource).toContain('from "next/link"');
		expect(appSidebarSource).toContain('from "next/navigation"');
		expect(appSidebarSource).toContain('from "next-auth"');
		expect(appSidebarSource).not.toContain("@platform/router");

		expect(sidebarHistorySource).toContain('from "next/navigation"');
		expect(sidebarHistorySource).toContain('from "next-auth"');
		expect(sidebarHistorySource).not.toContain("@platform/router");

		expect(sidebarHistoryItemSource).toContain('from "next/link"');

		expect(sidebarUserNavSource).toContain('from "next/navigation"');
		expect(sidebarUserNavSource).toContain('from "next-auth"');
		expect(sidebarUserNavSource).toContain('from "next-auth/react"');
		expect(sidebarUserNavSource).not.toContain("@platform/router");
		expect(sidebarUserNavSource).not.toContain("@platform/auth/client");
	});

	it("constrains runtime alias ownership to exact donor-compat specifiers", () => {
		expect(viteConfigSource).toContain("find: /^next\\/link$/");
		expect(viteConfigSource).toContain("find: /^next\\/navigation$/");
		expect(viteConfigSource).toContain("find: /^next\\/image$/");
		expect(viteConfigSource).toContain("find: /^next-auth\\/react$/");
		expect(viteConfigSource).toContain("find: /^next-auth$/");
		expect(viteConfigSource).toContain("find: /^@streamdown\\/code$/");
		expect(viteConfigSource).toContain("find: /^@\\/app\\/\\(chat\\)\\/actions$/");
		expect(viteConfigSource).toContain("find: /^@\\/hooks\\/use-active-chat$/");
		expect(viteConfigSource).toContain("find: /^@\\/hooks\\/use-chat-visibility$/");
		expect(viteConfigSource).not.toContain("find: /^next\\/form$/");
		expect(viteConfigSource).not.toContain("find: /^@\\/app\\/\\(auth\\)\\/layout$/");
		expect(viteConfigSource).not.toContain("find: /^@\\/components\\/chat\\/auth-form$/");

		expect(tsconfigSource).toContain('"next/link"');
		expect(tsconfigSource).toContain('"next/navigation"');
		expect(tsconfigSource).toContain('"next/image"');
		expect(tsconfigSource).toContain('"next-auth/react"');
		expect(tsconfigSource).toContain('"next-auth"');
		expect(tsconfigSource).toContain('"@streamdown/code"');
		expect(tsconfigSource).toContain('"@/app/(chat)/actions"');
		expect(tsconfigSource).toContain('"@/hooks/use-active-chat"');
		expect(tsconfigSource).toContain('"@/hooks/use-chat-visibility"');
		expect(tsconfigSource).not.toContain('"next/form"');
		expect(tsconfigSource).not.toContain('"@/app/(auth)/layout"');
		expect(tsconfigSource).not.toContain('"@/components/chat/auth-form"');
	});
});
