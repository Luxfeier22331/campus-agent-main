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
		expect(BETTER_AUTH_TABLES).toEqual(["user", "session", "account", "verification"]);
	});

	it("reads bootstrap env from the app-api operator connection only", () => {
		const env = readSharedProductBootstrapEnv({
			APP_API_DATABASE_SSLMODE: "require",
			APP_API_OPERATOR_DATABASE_URL: "postgresql://db.example/campus_agent",
			AUTH_SHELL_ORIGIN: "https://hub.muc.wiki",
			BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
			PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
		} as NodeJS.ProcessEnv);

		expect(env.authSchema).toBe("app_auth");
		expect(env.chatSchema).toBe("chat");
		expect(env.databaseUrl).toBe("postgresql://db.example/campus_agent");
		expect(env.databaseSslMode).toBe("require");
		expect(env.publicChatOrigin).toBe("https://chat.example.com");
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
});
