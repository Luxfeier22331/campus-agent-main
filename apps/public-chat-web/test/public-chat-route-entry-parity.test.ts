import { describe, expect, it } from "vitest";

import appShellSource from "../src/platform/chat/app-shell.tsx?raw";
import appRouterSource from "../src/routes/app-router.tsx?raw";

describe("public chat route entry parity", () => {
	it("does not keep repo-owned route status cards on chat entry routes", () => {
		expect(appRouterSource).not.toContain("RouteStatusCard");
		expect(appRouterSource).not.toContain("Loading chat");
		expect(appRouterSource).not.toContain("Checking your session...");
		expect(appRouterSource).not.toContain("Chat unavailable");
		expect(appRouterSource).not.toContain("Access blocked");
		expect(appRouterSource).not.toContain("Preparing chat");
	});

	it("keeps route entry gating in the route layer instead of the chat shell", () => {
		expect(appRouterSource).toContain("ChatbotShellRuntimeProvider");
		expect(appRouterSource).toContain('session.kind === "loading"');
		expect(appRouterSource).toContain('session.kind === "unauthenticated"');
		expect(appRouterSource).toContain('session.kind === "error"');
		expect(appRouterSource).toContain("ChatRouteErrorFallback");
		expect(appRouterSource).toContain("重新连接");
		expect(appRouterSource).toContain("!session.principal.canChat");
		expect(appRouterSource).toContain("FullDocumentRedirect");
		expect(appRouterSource).toContain('buildPublicChatAuthCompatPath("login"');
	});

	it("keeps auth compatibility routes redirect-only inside the route layer", () => {
		expect(appRouterSource).toContain('path: "/login"');
		expect(appRouterSource).toContain('path: "/register"');
		expect(appRouterSource).toContain('path: "/forgot-password"');
		expect(appRouterSource).toContain('path: "/reset-password"');
		expect(appRouterSource).toContain("window.location.replace(window.location.href)");
		expect(appRouterSource).not.toContain("../login/");
	});

	it("removes repo-owned route entry fallback and SPA login redirect logic from the chat shell", () => {
		expect(appShellSource).not.toContain("readChatRouteRedirectTarget");
		expect(appShellSource).not.toContain("ChatShellBootstrapFallback");
		expect(appShellSource).not.toContain("ThemeProvider");
		expect(appShellSource).not.toContain("TooltipProvider");
		expect(appShellSource).not.toContain('router.replace("/login")');
		expect(appShellSource).not.toContain('session.kind === "error"');
		expect(appShellSource).not.toContain("!session.principal.canChat");
		expect(appShellSource).not.toContain('session.kind !== "authenticated"');
	});
});
