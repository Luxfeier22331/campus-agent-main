import { describe, expect, it } from "vitest";
import packageManifestRaw from "../package.json?raw";
import indexSource from "../src/index.ts?raw";
import authClientSource from "../src/platform/auth/client.ts?raw";
import manifestSource from "../src/platform/launcher/manifest.ts?raw";
import routeRegistrySource from "../src/platform/routes/route-registry.ts?raw";
import accountActionSource from "../src/routes/account-action-page.tsx?raw";
import accountPageSource from "../src/routes/account-page.tsx?raw";
import routerSource from "../src/routes/app-router.tsx?raw";
import launcherPageSource from "../src/routes/launcher-page.tsx?raw";
import routeLayoutSource from "../src/routes/route-layout.tsx?raw";
import appStylesSource from "../src/styles.css?raw";

const packageManifest = JSON.parse(packageManifestRaw) as {
	dependencies?: Record<string, string | undefined>;
	scripts?: Record<string, string | undefined>;
};
const routeSurfaceSource = [
	accountActionSource,
	accountPageSource,
	launcherPageSource,
	routeLayoutSource,
	routerSource,
].join("\n");

describe("hub source guardrails", () => {
	it("uses TanStack Router and rejects panel/docs substrates", () => {
		expect(packageManifest.dependencies).toHaveProperty("@tanstack/react-router");
		expect(packageManifest.dependencies).not.toHaveProperty("react-router-dom");
		expect(packageManifest.dependencies).not.toHaveProperty("react-admin");
		expect(packageManifest.dependencies).not.toHaveProperty("@mui/material");
		expect(routerSource).toContain("@tanstack/react-router");
		expect(routerSource).not.toContain("react-router-dom");
	});

	it("uses a dedicated local dev port instead of the Vite default", () => {
		expect(packageManifest.scripts?.dev).toContain("--host 127.0.0.1");
		expect(packageManifest.scripts?.dev).toContain("--port 27012");
		expect(packageManifest.scripts?.dev).toContain("--strictPort");
		expect(packageManifest.scripts?.dev).not.toContain("--port 5173");
	});

	it("does not expose a generic app-api proxy or internal wiki slug", () => {
		expect(indexSource).toContain("HUB_ALLOWED_APP_API_PATHS");
		expect(indexSource).not.toContain('url.pathname.startsWith("/api/")');
		expect(routeRegistrySource).not.toContain('slug: "wiki"');
		expect(routeRegistrySource).not.toContain('slug: "legacy-wiki"');
		expect(routeRegistrySource).toContain('slug: "muc-wiki"');
		expect(routeRegistrySource).toContain('href: "https://muc.wiki"');
		expect(routeRegistrySource).toContain('href: "https://hub.muc.wiki/docs"');
		expect(routeRegistrySource).toContain("http://localhost:27013");
		expect(routeRegistrySource).not.toContain("docs.muc.wiki");
		expect(routeSurfaceSource).not.toContain("旧版 MUC Wiki");
		expect(routeSurfaceSource).not.toContain("历史存档");
		expect(manifestSource).toContain("route-registry");
	});

	it("keeps the public launcher narrow and excludes account/admin/planned cards", () => {
		expect(routeRegistrySource).not.toContain('slug: "account"');
		expect(routeRegistrySource).not.toContain('slug: "panel"');
		expect(routeRegistrySource).not.toContain('slug: "map"');
		expect(routeRegistrySource).not.toContain('slug: "services"');
		expect(routeRegistrySource).not.toContain('slug: "notices"');
		expect(routeSurfaceSource).not.toContain("管理面板");
		expect(routeSurfaceSource).not.toContain("校园地图");
		expect(routeSurfaceSource).not.toContain("校园服务");
		expect(routeSurfaceSource).not.toContain("通知");
		expect(routeSurfaceSource).not.toContain("刷新状态");
		expect(routeSurfaceSource).not.toContain("Built for Academic Excellence");
		expect(routeSurfaceSource).not.toContain("关于我们");
		expect(routeSurfaceSource).not.toContain("使用条款");
		expect(routeSurfaceSource).not.toContain("隐私政策");
		expect(routeSurfaceSource).not.toContain("allowlist");
	});

	it("owns the account browser shell without becoming an auth backend", () => {
		expect(routerSource).toContain('path: "/account/login"');
		expect(routerSource).toContain('path: "/account/register"');
		expect(routerSource).toContain('path: "/account/forgot-password"');
		expect(routerSource).toContain('path: "/account/reset-password"');
		expect(routerSource).toContain('path: "/account/federation/consent"');
		expect(routerSource).toContain('path: "/account/federation/error"');
		expect(routeSurfaceSource).toContain("HubEmailPasswordForm");
		expect(routeSurfaceSource).toContain("HubPasswordRecoveryRequestForm");
		expect(routeSurfaceSource).toContain("HubPasswordRecoveryResetForm");
		expect(routeSurfaceSource).toContain("OAuthClientPanel");
		expect(routeSurfaceSource).toContain("FederationConsentPage");
		expect(routeSurfaceSource).toContain("FederationErrorPage");
		expect(routeSurfaceSource).toContain("重置密码");
		expect(routeSurfaceSource).toContain("账号服务暂不可用");
		expect(routeSurfaceSource).toContain("ResetTokenMissingState");
		expect(routeSurfaceSource).not.toMatch(/href=\{`\/api\/auth\/\$\{kind\}`\}/);
		expect(accountPageSource).not.toContain('to="/account/reset-password"');
		expect(packageManifest.dependencies).toHaveProperty("@better-auth/oauth-provider");
		expect(authClientSource).toContain("@better-auth/oauth-provider/client");
		expect(authClientSource).toContain("oauthProviderClient()");
		expect(authClientSource).toContain("createAuthClient");
		expect(authClientSource).toContain("x-captcha-response");
		expect(authClientSource).not.toContain("betterAuth(");
	});

	it("does not reintroduce fake internal app routes", () => {
		expect(routeSurfaceSource).not.toContain("EntryPlaceholderPage");
		expect(routeSurfaceSource).not.toContain("createEntryRoute");
		expect(routerSource).not.toContain('path: "/chat"');
		expect(routerSource).not.toContain('path: "/docs"');
		expect(routerSource).not.toContain('path: "/panel"');
		expect(routeSurfaceSource).not.toContain("to={entry.href}");
		expect(routeSurfaceSource).toContain("targetKind");
	});

	it("uses local shadcn-style primitives and rejects the old green theme", async () => {
		const legacyGreenTokens = [
			"#172018",
			"#f7f8f3",
			"#22543d",
			"#4b5c4f",
			"#6b7b42",
			"#8ea35d",
			"#edf2e5",
			"#17633a",
			"#43512f",
			"#cfd7c4",
			"hub-button",
			"hub-entry-card",
			"hub-form-field",
		];

		const uiPrimitiveModules = await Promise.all([
			import("../src/components/ui/badge"),
			import("../src/components/ui/button"),
			import("../src/components/ui/card"),
			import("../src/components/ui/input"),
			import("../src/components/ui/label"),
			import("../src/lib/utils"),
		]);

		for (const token of legacyGreenTokens) {
			expect(appStylesSource).not.toContain(token);
			expect(routeSurfaceSource).not.toContain(token);
		}
		expect(routeSurfaceSource).toContain("@/components/ui/button");
		expect(routeSurfaceSource).toContain("@/components/ui/card");
		expect(routeSurfaceSource).toContain("@/components/ui/input");
		expect(routeSurfaceSource).toContain("@/components/ui/label");
		for (const module of uiPrimitiveModules) {
			expect(Object.keys(module).length).toBeGreaterThan(0);
		}
	});
});
