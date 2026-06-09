import { describe, expect, it } from "vitest";

import authRedirectSource from "../src/platform/auth/account-shell-redirect.ts?raw";
import nextAuthCompatSource from "../src/platform/vendor-compat/next-auth/react.tsx?raw";
import appRouterSource from "../src/routes/app-router.tsx?raw";
import sidebarUserNavSource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-user-nav.tsx?raw";

describe("public chat auth regressions", () => {
	it("keeps the active sidebar user-nav in the vendor runtime tree", () => {
		expect(sidebarUserNavSource).toContain('from "next/navigation"');
		expect(sidebarUserNavSource).toContain('from "next-auth/react"');
		expect(nextAuthCompatSource).toContain("signOutChatSession");
		expect(nextAuthCompatSource).toContain("ChatbotShellRuntimeContext");
	});

	it("keeps compatibility routes while removing repo-owned auth page implementations", () => {
		expect(appRouterSource).toContain('path: "/login"');
		expect(appRouterSource).toContain('path: "/register"');
		expect(appRouterSource).toContain('path: "/forgot-password"');
		expect(appRouterSource).toContain('path: "/reset-password"');
		expect(appRouterSource).toContain("CompatAuthRoute");
		expect(appRouterSource).not.toContain("../login/");
	});

	it("centralizes compatibility redirect semantics in a repo-owned helper", () => {
		expect(authRedirectSource).toContain("buildPublicChatAuthCompatPath");
		expect(authRedirectSource).toContain("buildAccountShellAuthRedirect");
		expect(authRedirectSource).toContain('"/account/login"');
		expect(authRedirectSource).toContain('"/account/register"');
		expect(authRedirectSource).toContain('"/account/forgot-password"');
		expect(authRedirectSource).toContain('"/account/reset-password"');
	});

	it("preserves reset-password token handoff instead of dropping the querystring", () => {
		expect(authRedirectSource).toContain('url.searchParams.get("token")');
		expect(authRedirectSource).toContain('redirectUrl.searchParams.set("token", token)');
	});
});
