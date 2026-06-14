import { boolean, index, jsonb, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const auth = pgSchema("app_auth");

export const user = auth.table(
	"user",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		email: text("email").notNull(),
		emailVerified: boolean("emailVerified").notNull().default(false),
		image: text("image"),
		createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
	},
	(table) => ({
		emailUnique: uniqueIndex("user_email_uidx").on(table.email),
	}),
);

export const session = auth.table(
	"session",
	{
		id: text("id").primaryKey(),
		token: text("token").notNull(),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
		ipAddress: text("ipAddress"),
		userAgent: text("userAgent"),
		createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
	},
	(table) => ({
		tokenUnique: uniqueIndex("session_token_uidx").on(table.token),
		userIdIndex: index("session_userId_idx").on(table.userId),
	}),
);

export const account = auth.table(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("accountId").notNull(),
		providerId: text("providerId").notNull(),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("accessToken"),
		refreshToken: text("refreshToken"),
		idToken: text("idToken"),
		accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true }),
		refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true }),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
	},
	(table) => ({
		userIdIndex: index("account_userId_idx").on(table.userId),
	}),
);

export const verification = auth.table(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
		createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
	},
	(table) => ({
		identifierIndex: index("verification_identifier_idx").on(table.identifier),
	}),
);

export const oauthClient = auth.table(
	"oauthClient",
	{
		id: text("id").primaryKey(),
		clientId: text("clientId").notNull(),
		clientSecret: text("clientSecret"),
		disabled: boolean("disabled").default(false),
		skipConsent: boolean("skipConsent"),
		enableEndSession: boolean("enableEndSession"),
		subjectType: text("subjectType"),
		scopes: jsonb("scopes"),
		userId: text("userId").references(() => user.id),
		createdAt: timestamp("createdAt", { withTimezone: true }),
		updatedAt: timestamp("updatedAt", { withTimezone: true }),
		name: text("name"),
		uri: text("uri"),
		icon: text("icon"),
		contacts: jsonb("contacts"),
		tos: text("tos"),
		policy: text("policy"),
		softwareId: text("softwareId"),
		softwareVersion: text("softwareVersion"),
		softwareStatement: text("softwareStatement"),
		redirectUris: jsonb("redirectUris").notNull(),
		postLogoutRedirectUris: jsonb("postLogoutRedirectUris"),
		tokenEndpointAuthMethod: text("tokenEndpointAuthMethod"),
		grantTypes: jsonb("grantTypes"),
		responseTypes: jsonb("responseTypes"),
		public: boolean("public"),
		type: text("type"),
		requirePKCE: boolean("requirePKCE"),
		referenceId: text("referenceId"),
		metadata: jsonb("metadata"),
	},
	(table) => ({
		clientIdUnique: uniqueIndex("oauthClient_clientId_uidx").on(table.clientId),
		userIdIndex: index("oauthClient_userId_idx").on(table.userId),
	}),
);

export const oauthRefreshToken = auth.table(
	"oauthRefreshToken",
	{
		id: text("id").primaryKey(),
		token: text("token").notNull(),
		clientId: text("clientId")
			.notNull()
			.references(() => oauthClient.clientId),
		sessionId: text("sessionId").references(() => session.id, { onDelete: "set null" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id),
		referenceId: text("referenceId"),
		expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
		createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
		revoked: timestamp("revoked", { withTimezone: true }),
		authTime: timestamp("authTime", { withTimezone: true }),
		scopes: jsonb("scopes").notNull(),
	},
	(table) => ({
		clientIdIndex: index("oauthRefreshToken_clientId_idx").on(table.clientId),
		sessionIdIndex: index("oauthRefreshToken_sessionId_idx").on(table.sessionId),
		userIdIndex: index("oauthRefreshToken_userId_idx").on(table.userId),
	}),
);

export const oauthAccessToken = auth.table(
	"oauthAccessToken",
	{
		id: text("id").primaryKey(),
		token: text("token").notNull(),
		clientId: text("clientId")
			.notNull()
			.references(() => oauthClient.clientId),
		sessionId: text("sessionId").references(() => session.id, { onDelete: "set null" }),
		userId: text("userId").references(() => user.id),
		referenceId: text("referenceId"),
		refreshId: text("refreshId").references(() => oauthRefreshToken.id),
		expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
		createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
		scopes: jsonb("scopes").notNull(),
	},
	(table) => ({
		tokenUnique: uniqueIndex("oauthAccessToken_token_uidx").on(table.token),
		clientIdIndex: index("oauthAccessToken_clientId_idx").on(table.clientId),
		sessionIdIndex: index("oauthAccessToken_sessionId_idx").on(table.sessionId),
		userIdIndex: index("oauthAccessToken_userId_idx").on(table.userId),
		refreshIdIndex: index("oauthAccessToken_refreshId_idx").on(table.refreshId),
	}),
);

export const oauthConsent = auth.table(
	"oauthConsent",
	{
		id: text("id").primaryKey(),
		clientId: text("clientId")
			.notNull()
			.references(() => oauthClient.clientId),
		userId: text("userId").references(() => user.id),
		referenceId: text("referenceId"),
		scopes: jsonb("scopes").notNull(),
		createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
	},
	(table) => ({
		clientIdIndex: index("oauthConsent_clientId_idx").on(table.clientId),
		userIdIndex: index("oauthConsent_userId_idx").on(table.userId),
	}),
);

export const jwks = auth.table("jwks", {
	id: text("id").primaryKey(),
	publicKey: text("publicKey").notNull(),
	privateKey: text("privateKey").notNull(),
	createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
	expiresAt: timestamp("expiresAt", { withTimezone: true }),
});

export const appAuthSchema = {
	user,
	session,
	account,
	verification,
	oauthClient,
	oauthRefreshToken,
	oauthAccessToken,
	oauthConsent,
	jwks,
};
