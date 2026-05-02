import { describe, expect, it } from "vitest";
import packageManifestRaw from "../package.json?raw";
import indexSource from "../src/index.ts?raw";
import authClientSource from "../src/platform/auth/client.ts?raw";
import manifestSource from "../src/platform/launcher/manifest.ts?raw";
import routerSource from "../src/routes/app-router.tsx?raw";

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
		expect(manifestSource).not.toContain('slug: "wiki"');
		expect(manifestSource).toContain('slug: "legacy-wiki"');
		expect(manifestSource).toContain('href: "https://muc.wiki"');
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
});
