import { describe, expect, it } from "vitest";
import packageManifestRaw from "../package.json?raw";
import indexSource from "../src/index.ts?raw";
import authClientSource from "../src/platform/auth/client.ts?raw";
import manifestSource from "../src/platform/launcher/manifest.ts?raw";
import routeRegistrySource from "../src/platform/routes/route-registry.ts?raw";
import routerSource from "../src/routes/app-router.tsx?raw";
import appStylesSource from "../src/styles.css?raw";

const packageManifest = JSON.parse(packageManifestRaw) as {
	dependencies?: Record<string, string | undefined>;
	scripts?: Record<string, string | undefined>;
};

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
		expect(routeRegistrySource).toContain('slug: "legacy-wiki"');
		expect(routeRegistrySource).toContain('href: "https://muc.wiki"');
		expect(manifestSource).toContain("route-registry");
	});

	it("owns the account browser shell without becoming an auth backend", () => {
		expect(routerSource).toContain('path: "/account/login"');
		expect(routerSource).toContain('path: "/account/register"');
		expect(routerSource).toContain('path: "/account/forgot-password"');
		expect(routerSource).toContain('path: "/account/reset-password"');
		expect(routerSource).toContain("HubEmailPasswordForm");
		expect(routerSource).toContain("HubPasswordRecoveryRequestForm");
		expect(routerSource).toContain("HubPasswordRecoveryResetForm");
		expect(routerSource).not.toMatch(/href=\{`\/api\/auth\/\$\{kind\}`\}/);
		expect(authClientSource).toContain("createAuthClient");
		expect(authClientSource).toContain("x-captcha-response");
		expect(authClientSource).not.toContain("betterAuth(");
	});

	it("does not reintroduce fake internal app routes", () => {
		expect(routerSource).not.toContain("EntryPlaceholderPage");
		expect(routerSource).not.toContain("createEntryRoute");
		expect(routerSource).not.toContain('path: "/chat"');
		expect(routerSource).not.toContain('path: "/docs"');
		expect(routerSource).not.toContain('path: "/panel"');
		expect(routerSource).not.toContain("to={entry.href}");
		expect(routerSource).toContain("targetKind");
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
			expect(routerSource).not.toContain(token);
		}
		expect(routerSource).toContain("@/components/ui/button");
		expect(routerSource).toContain("@/components/ui/card");
		expect(routerSource).toContain("@/components/ui/input");
		expect(routerSource).toContain("@/components/ui/label");
		for (const module of uiPrimitiveModules) {
			expect(Object.keys(module).length).toBeGreaterThan(0);
		}
	});
});
