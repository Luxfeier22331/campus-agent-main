// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	provisionMucWikiFederationClient,
	readMucWikiFederationClientProvisionInput,
} from "../src/script-support/provisioning/provision-muc-wiki-federation-client-lib.ts";

describe("muc-wiki federation client provision", () => {
	it("requires runtime-only secret and redirect URI inputs", () => {
		expect(() => readMucWikiFederationClientProvisionInput({}, [])).toThrow(
			"APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET is required.",
		);
		expect(() =>
			readMucWikiFederationClientProvisionInput(
				{
					APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET: "client-secret",
				},
				[],
			),
		).toThrow("APP_API_FEDERATION_MUC_WIKI_REDIRECT_URI is required.");
	});

	it("normalizes the controlled muc-wiki federation client policy", () => {
		const input = readMucWikiFederationClientProvisionInput(
			{
				APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET: "client-secret",
				APP_API_FEDERATION_MUC_WIKI_POST_LOGOUT_REDIRECT_URI:
					"https://muc.wiki/wiki/Special:UserLogout",
				APP_API_FEDERATION_MUC_WIKI_REDIRECT_URI:
					"https://muc.wiki/wiki/Special:PluggableAuthLogin",
			},
			[],
		);

		expect(input.clientSecret).toBe("client-secret");
		expect(input.redirectUris).toEqual(["https://muc.wiki/wiki/Special:PluggableAuthLogin"]);
		expect(input.postLogoutRedirectUris).toEqual(["https://muc.wiki/wiki/Special:UserLogout"]);
	});

	it("seeds app-owned product truth and Better Auth runtime client state", async () => {
		const executeSql = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });

		const summary = await provisionMucWikiFederationClient(
			{
				clientSecret: "client-secret",
				now: "2026-06-03T00:00:00.000Z",
				postLogoutRedirectUris: ["https://muc.wiki/wiki/Special:UserLogout"],
				redirectUris: ["https://muc.wiki/wiki/Special:PluggableAuthLogin"],
			},
			{ executeSql },
		);

		expect(summary).toEqual({
			clientId: "muc-wiki",
			claimsPolicyId: "muc-wiki-default",
			redirectUris: ["https://muc.wiki/wiki/Special:PluggableAuthLogin"],
			postLogoutRedirectUris: ["https://muc.wiki/wiki/Special:UserLogout"],
		});
		expect(executeSql).toHaveBeenCalledTimes(3);
		const sqlText = executeSql.mock.calls.map((call) => String(call[0])).join("\n");
		expect(sqlText).toContain('"identity"."federation_clients"');
		expect(sqlText).toContain('"identity"."federation_claims_policies"');
		expect(sqlText).toContain('"app_auth"."oauthClient"');
		expect(sqlText).not.toContain("client-secret");

		const runtimeClientCall = executeSql.mock.calls.find((call) =>
			String(call[0]).includes('"app_auth"."oauthClient"'),
		);
		expect(runtimeClientCall?.[1]).toEqual(
			expect.arrayContaining([
				"muc-wiki",
				expect.not.stringContaining("client-secret"),
				JSON.stringify(["openid", "profile", "email"]),
				JSON.stringify(["https://muc.wiki/wiki/Special:PluggableAuthLogin"]),
				JSON.stringify(["https://muc.wiki/wiki/Special:UserLogout"]),
			]),
		);
	});
});
