import { describe, expect, it } from "vitest";

import {
	buildSignedCampusOAuthQuery,
	parseCampusOAuthClient,
	resolveCampusOAuthContext,
	resolveSafeOAuthRedirectTarget,
} from "../src/platform/auth/oauth-context";

const SIGNED_SEARCH =
	"client_id=test-oauth-client&scope=openid+email+custom%3Aread&resource=https%3A%2F%2Fapi.example.test&sig=test-signature&exp=1893456000&ba_iat=1893455400000&ignored=drop&ba_param=ba_iat&ba_param=ba_param&ba_param=client_id&ba_param=exp&ba_param=resource&ba_param=scope";

describe("campus OAuth context", () => {
	it("preserves the provider-declared signed query including repeated parameters", () => {
		const signed = buildSignedCampusOAuthQuery(new URLSearchParams(SIGNED_SEARCH));

		expect(signed).toBe(
			"client_id=test-oauth-client&scope=openid+email+custom%3Aread&resource=https%3A%2F%2Fapi.example.test&sig=test-signature&exp=1893456000&ba_iat=1893455400000&ba_param=ba_iat&ba_param=ba_param&ba_param=client_id&ba_param=exp&ba_param=resource&ba_param=scope",
		);
		expect(signed).not.toContain("ignored");
	});

	it("uses generic scope labels and leaves unknown scopes visible", () => {
		expect(resolveCampusOAuthContext(SIGNED_SEARCH)).toMatchObject({
			clientId: "test-oauth-client",
			requestedScopes: ["openid", "email", "custom:read"],
			scopeItems: ["登录身份", "邮箱地址", "custom:read"],
		});
	});

	it("rejects unsigned consent state", () => {
		const context = resolveCampusOAuthContext("client_id=test-oauth-client&scope=openid");
		expect(context?.oauthQuery).toBeNull();
	});

	it("accepts only matching public client identity fields", () => {
		expect(
			parseCampusOAuthClient(
				{
					client_id: "test-oauth-client",
					client_name: "",
					client_uri: "https://oauth.example.test/product",
					client_secret: "ignored",
				},
				"test-oauth-client",
			),
		).toEqual({
			clientId: "test-oauth-client",
			displayName: "外部应用",
			hostLabel: "client_id: test-oauth-client",
		});
		expect(
			parseCampusOAuthClient({ client_id: "different-client" }, "test-oauth-client"),
		).toBeNull();
	});

	it("allows same-origin and HTTPS OAuth redirects only", () => {
		expect(resolveSafeOAuthRedirectTarget("/account", "https://campus.example.test")).toBe(
			"/account",
		);
		expect(
			resolveSafeOAuthRedirectTarget(
				"https://oauth.example.test/callback?code=abc",
				"https://campus.example.test",
			),
		).toBe("https://oauth.example.test/callback?code=abc");
		expect(
			resolveSafeOAuthRedirectTarget("javascript:alert(1)", "https://campus.example.test"),
		).toBeNull();
		expect(
			resolveSafeOAuthRedirectTarget(
				"http://oauth.example.test/callback",
				"https://campus.example.test",
			),
		).toBeNull();
	});
});
