import { createHash } from "node:crypto";

const CLIENT_ID = "muc-wiki";
const CLIENT_NAME = "MUC Wiki";
const ALLOWED_SCOPES = ["openid", "profile", "email"];

interface FederationProvisionInput {
	clientSecret: string;
	now?: string;
	postLogoutRedirectUris: string[];
	redirectUris: string[];
}

interface FederationProvisionDeps {
	executeSql(sql: string, params: unknown[]): Promise<unknown>;
}

function readArgValue(argv: string[], flag: string): string | null {
	const index = argv.indexOf(flag);
	if (index === -1) {
		return null;
	}
	return argv[index + 1]?.trim() || null;
}

function readRequiredValue(value: string | undefined | null, key: string): string {
	const normalized = value?.trim();
	if (!normalized) {
		throw new Error(`${key} is required.`);
	}
	return normalized;
}

function readRequiredUrlList(value: string | undefined | null, key: string): string[] {
	const urls = readRequiredValue(value, key)
		.split(",")
		.map((item: string) => item.trim())
		.filter(Boolean)
		.map((item: string) => new URL(item).toString());
	if (urls.length === 0) {
		throw new Error(`${key} must contain at least one absolute URL.`);
	}
	return [...new Set(urls)];
}

export function hashBetterAuthClientSecret(clientSecret: string): string {
	return createHash("sha256").update(clientSecret, "utf8").digest("base64url");
}

export function readMucWikiFederationClientProvisionInput(
	env: NodeJS.ProcessEnv = process.env,
	argv: string[] = process.argv.slice(2),
): FederationProvisionInput {
	const clientSecret = readRequiredValue(
		readArgValue(argv, "--client-secret") || env.APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET,
		"APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET",
	);
	const redirectUris = readRequiredUrlList(
		readArgValue(argv, "--redirect-uri") || env.APP_API_FEDERATION_MUC_WIKI_REDIRECT_URI,
		"APP_API_FEDERATION_MUC_WIKI_REDIRECT_URI",
	);
	const postLogoutRedirectUris = readRequiredUrlList(
		readArgValue(argv, "--post-logout-redirect-uri") ||
			env.APP_API_FEDERATION_MUC_WIKI_POST_LOGOUT_REDIRECT_URI,
		"APP_API_FEDERATION_MUC_WIKI_POST_LOGOUT_REDIRECT_URI",
	);

	return {
		clientSecret,
		postLogoutRedirectUris,
		redirectUris,
	};
}

export function buildMucWikiFederationClientSeed(input: FederationProvisionInput) {
	const now = input.now ? new Date(input.now) : new Date();
	const nowIso = now.toISOString();

	return {
		appAuthClient: {
			clientId: CLIENT_ID,
			clientSecretHash: hashBetterAuthClientSecret(input.clientSecret),
			disabled: false,
			enableEndSession: true,
			grantTypes: ["authorization_code", "refresh_token"],
			id: "oauth_client_muc_wiki",
			metadata: {
				productOwner: "app_auth.oauthClient",
			},
			name: CLIENT_NAME,
			postLogoutRedirectUris: input.postLogoutRedirectUris,
			public: false,
			redirectUris: input.redirectUris,
			referenceId: `federation-client/${CLIENT_ID}`,
			requirePKCE: true,
			responseTypes: ["code"],
			scopes: ALLOWED_SCOPES,
			skipConsent: true,
			subjectType: "public",
			tokenEndpointAuthMethod: "client_secret_basic",
			type: "web",
		},
		createdAt: nowIso,
		updatedAt: nowIso,
	};
}

export async function provisionMucWikiFederationClient(
	input: FederationProvisionInput,
	deps: FederationProvisionDeps,
) {
	const seed = buildMucWikiFederationClientSeed(input);

	await deps.executeSql(
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
        "referenceId",
        "metadata"
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12::jsonb,
        $13::jsonb, $14, $15::jsonb, $16::jsonb, $17, $18, $19, $20, $21::jsonb
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
        "referenceId" = excluded."referenceId",
        "metadata" = excluded."metadata";
    `,
		[
			seed.appAuthClient.id,
			seed.appAuthClient.clientId,
			seed.appAuthClient.clientSecretHash,
			seed.appAuthClient.disabled,
			seed.appAuthClient.skipConsent,
			seed.appAuthClient.enableEndSession,
			seed.appAuthClient.subjectType,
			JSON.stringify(seed.appAuthClient.scopes),
			seed.createdAt,
			seed.updatedAt,
			seed.appAuthClient.name,
			JSON.stringify(seed.appAuthClient.redirectUris),
			JSON.stringify(seed.appAuthClient.postLogoutRedirectUris),
			seed.appAuthClient.tokenEndpointAuthMethod,
			JSON.stringify(seed.appAuthClient.grantTypes),
			JSON.stringify(seed.appAuthClient.responseTypes),
			seed.appAuthClient.public,
			seed.appAuthClient.type,
			seed.appAuthClient.requirePKCE,
			seed.appAuthClient.referenceId,
			JSON.stringify(seed.appAuthClient.metadata),
		],
	);

	return {
		clientId: CLIENT_ID,
		postLogoutRedirectUris: seed.appAuthClient.postLogoutRedirectUris,
		redirectUris: seed.appAuthClient.redirectUris,
	};
}
