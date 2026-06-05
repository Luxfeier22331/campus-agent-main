import { describe, expect, it } from "vitest";

import { resolveHubOAuthContext } from "../src/platform/auth/oauth-context";

describe("hub OAuth UI context", () => {
	it("resolves the admitted MUC Wiki client and canonical authorize path", () => {
		const context = resolveHubOAuthContext(
			"client_id=muc-wiki&response_type=code&scope=openid%20profile%20email&redirect_uri=https%3A%2F%2Fwiki.mucwiki-edge.link%2Fwiki%2FSpecial%3APluggableAuthLogin&return_to=%2Fchat",
		);

		expect(context).toMatchObject({
			client: {
				clientId: "muc-wiki",
				displayName: "MUC Wiki",
				hostLabel: "wiki.mucwiki-edge.link",
				productLabel: "MUC Wiki Hub",
				scopeItems: ["登录身份", "邮箱地址", "基本资料"],
			},
			isOAuthRequest: true,
		});
		expect(context?.authorizePath).toBe(
			"/api/federation/authorize?client_id=muc-wiki&response_type=code&scope=openid+profile+email&redirect_uri=https%3A%2F%2Fwiki.mucwiki-edge.link%2Fwiki%2FSpecial%3APluggableAuthLogin",
		);
	});

	it("does not present an OAuth shell for unknown clients", () => {
		expect(resolveHubOAuthContext("client_id=unknown-client&response_type=code")).toBeNull();
	});
});
