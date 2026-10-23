import { createHash } from "node:crypto";

export const TEST_FEDERATION_CLIENT_ID = "test-oauth-client";
export const TEST_FEDERATION_CLIENT_SECRET = "test-oauth-client-secret";
export const TEST_FEDERATION_REDIRECT_URI = "https://oauth.example.test/callback";

export function hashTestOAuthClientSecret(clientSecret: string): string {
	return createHash("sha256").update(clientSecret, "utf8").digest("base64url");
}

export async function provisionTestOAuthClient(input: {
	executeSql(sql: string, params: unknown[]): Promise<unknown>;
	postLogoutRedirectUris?: string[];
	redirectUris?: string[];
}): Promise<void> {
	const redirectUris = input.redirectUris ?? [TEST_FEDERATION_REDIRECT_URI];
	const postLogoutRedirectUris = input.postLogoutRedirectUris ?? [
		"https://oauth.example.test/logout",
	];
	const now = new Date().toISOString();

	await input.executeSql(
		`
      insert into "app_auth"."oauthClient" (
        "id",
        "clientId",
        "clientSecret",
        "disabled",
        "skipConsent",
        "enableEndSession",
        "subjectType",
        "scopes",
        "createdAt",
        "updatedAt",
        "name",
        "redirectUris",
        "postLogoutRedirectUris",
        "tokenEndpointAuthMethod",
        "grantTypes",
        "responseTypes",
        "public",
        "type",
        "requirePKCE",
        "referenceId"
      ) values (
        $1, $2, $3, false, false, true, 'public', $4::jsonb, $5, $5, $6, $7::jsonb,
        $8::jsonb, 'client_secret_basic', $9::jsonb, $10::jsonb, false, 'web', true, $11
      )
      on conflict ("clientId") do update set
        "clientSecret" = excluded."clientSecret",
        "disabled" = excluded."disabled",
        "skipConsent" = excluded."skipConsent",
        "enableEndSession" = excluded."enableEndSession",
        "subjectType" = excluded."subjectType",
        "scopes" = excluded."scopes",
        "updatedAt" = excluded."updatedAt",
        "name" = excluded."name",
        "redirectUris" = excluded."redirectUris",
        "postLogoutRedirectUris" = excluded."postLogoutRedirectUris",
        "tokenEndpointAuthMethod" = excluded."tokenEndpointAuthMethod",
        "grantTypes" = excluded."grantTypes",
        "responseTypes" = excluded."responseTypes",
        "public" = excluded."public",
        "type" = excluded."type",
        "requirePKCE" = excluded."requirePKCE",
        "referenceId" = excluded."referenceId";
    `,
		[
			"oauth_client_test_oauth_client",
			TEST_FEDERATION_CLIENT_ID,
			hashTestOAuthClientSecret(TEST_FEDERATION_CLIENT_SECRET),
			JSON.stringify(["openid", "profile", "email"]),
			now,
			"Test OAuth Client",
			JSON.stringify(redirectUris),
			JSON.stringify(postLogoutRedirectUris),
			JSON.stringify(["authorization_code", "refresh_token"]),
			JSON.stringify(["code"]),
			"test/federation-client",
		],
	);
}
