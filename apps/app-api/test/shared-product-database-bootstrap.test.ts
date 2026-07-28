// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	APP_AUTH_SCHEMA,
	APP_CHAT_SCHEMA,
	applySharedProductCurrentSchemaSql,
	readSharedProductBootstrapEnv,
} from "../src/script-support/shared-db/shared-product-database-bootstrap.ts";

describe("app-api shared product database bootstrap", () => {
	it("freezes app_auth/chat as fixed shared product schemas", () => {
		expect(APP_AUTH_SCHEMA).toBe("app_auth");
		expect(APP_CHAT_SCHEMA).toBe("chat");
	});

	it("reads bootstrap env from the app-api schema-admin connection only", () => {
		const env = readSharedProductBootstrapEnv({
			APP_API_DATABASE_SSLMODE: "require",
			APP_API_SCHEMA_DATABASE_URL: "postgresql://db.example/campus_agent",
		} as NodeJS.ProcessEnv);

		expect(env.authSchema).toBe("app_auth");
		expect(env.chatSchema).toBe("chat");
		expect(env.databaseUrl).toBe("postgresql://db.example/campus_agent");
		expect(env.databaseSslMode).toBe("require");
	});

	it("rejects invalid current-schema SQL before querying PostgreSQL", async () => {
		const query = vi.fn(async () => undefined);

		await expect(
			applySharedProductCurrentSchemaSql({ query }, "DELETE FROM chat.messages;"),
		).rejects.toThrow("Unsupported shared-product schema baseline statement shape");
		expect(query).not.toHaveBeenCalled();
	});
});
