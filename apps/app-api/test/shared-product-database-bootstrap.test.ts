// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	APP_AUTH_SCHEMA,
	APP_CHAT_SCHEMA,
	BETTER_AUTH_TABLES,
	classifyBetterAuthTableOwnership,
	readSharedProductBootstrapEnv,
} from "../scripts/shared-product-database-bootstrap.mjs";

describe("app-api shared product database bootstrap", () => {
	it("freezes app_auth/chat as fixed shared product schemas", () => {
		expect(APP_AUTH_SCHEMA).toBe("app_auth");
		expect(APP_CHAT_SCHEMA).toBe("chat");
		expect(BETTER_AUTH_TABLES).toEqual([
			"user",
			"session",
			"account",
			"verification",
			"oauthClient",
			"oauthRefreshToken",
			"oauthAccessToken",
			"oauthConsent",
			"jwks",
		]);
	});

	it("reads bootstrap env from the app-api operator connection only", () => {
		const env = readSharedProductBootstrapEnv({
			APP_API_DATABASE_SSLMODE: "require",
			APP_API_OPERATOR_DATABASE_URL: "postgresql://db.example/campus_agent",
			AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
			BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
		} as NodeJS.ProcessEnv);

		expect(env.authSchema).toBe("app_auth");
		expect(env.chatSchema).toBe("chat");
		expect(env.databaseUrl).toBe("postgresql://db.example/campus_agent");
		expect(env.databaseSslMode).toBe("require");
		expect(env.authShellOrigin).toBe("https://campus.muc.wiki");
	});

	it("rejects legacy public better-auth tables instead of adopting them", () => {
		expect(() =>
			classifyBetterAuthTableOwnership({
				authSchema: "app_auth",
				authSchemaTables: [],
				publicSchemaTables: ["user", "session", "account", "verification"],
			}),
		).toThrow("Legacy Better Auth tables in public are no longer supported");
	});

	it("rejects split better-auth ownership across public and app_auth", () => {
		expect(() =>
			classifyBetterAuthTableOwnership({
				authSchema: "app_auth",
				authSchemaTables: ["user"],
				publicSchemaTables: ["session", "account", "verification"],
			}),
		).toThrow("Conflicting Better Auth table placement detected");
	});

	it("admits additive Better Auth plugin table migrations inside app_auth", () => {
		expect(
			classifyBetterAuthTableOwnership({
				authSchema: "app_auth",
				authSchemaTables: ["user", "session", "account", "verification"],
				publicSchemaTables: [],
			}),
		).toBe("target_schema_needs_migration");
	});
});
