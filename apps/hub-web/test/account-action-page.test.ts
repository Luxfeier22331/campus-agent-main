import { describe, expect, it } from "vitest";

import accountActionPageSource from "../src/routes/account-action-page.tsx?raw";
import routeLayoutSource from "../src/routes/route-layout.tsx?raw";

describe("hub OAuth account action surface", () => {
	it("renders a dedicated MUC Wiki OAuth identity shell instead of the generic login copy", () => {
		expect(accountActionPageSource).toContain("resolveHubOAuthContext");
		expect(accountActionPageSource).toContain("oauthContext.client.productLabel");
		expect(accountActionPageSource).toContain("oauthContext.client.displayName");
		expect(accountActionPageSource).toContain("OAuthClientPanel");
		expect(accountActionPageSource).toContain("请求访问");
		expect(accountActionPageSource).toContain("授权请求已受信任");
		expect(accountActionPageSource).toContain("登录授权未完成");
	});

	it("keeps OAuth pages in a focused identity shell without launcher chrome", () => {
		expect(routeLayoutSource).toContain("isFocusedIdentityPath");
		expect(routeLayoutSource).toContain('pathname === "/account/federation/consent"');
		expect(routeLayoutSource).toContain('pathname === "/account/federation/error"');
		expect(routeLayoutSource).toContain('get("client_id") === "muc-wiki"');
		expect(routeLayoutSource).toContain("{isFocusedIdentitySurface ? null : <HubFooter />}");
	});
});
