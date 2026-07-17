// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createProviderConfigStore } from "../src/server/provider-config-store.ts";

describe("provider config PostgreSQL store", () => {
	it("maps candidates and verifies both owned tables", async () => {
		const query = vi.fn(async (sql: string) => {
			if (sql.includes("FROM provider_config.connections ORDER")) {
				return {
					rows: [
						{
							api_key_secret_json: {
								ciphertext: "aesgcm:a:b",
								fingerprint: "fingerprint",
								last4: "last",
							},
							base_url: "https://provider.example/v1",
							connection_id: "connection-1",
							created_at: "2026-07-16T00:00:00.000Z",
							created_by_json: { displayName: "Operator", principalId: "operator-1" },
							feature_config_json: {},
							features_json: ["prompt"],
							provider: "openai-compatible",
							revision: 1,
							updated_at: "2026-07-16T00:00:00.000Z",
							updated_by_json: { displayName: "Operator", principalId: "operator-1" },
						},
					],
				};
			}
			return { rows: [] };
		});
		const store = createProviderConfigStore({ query } as never);

		await expect(store.listConnections()).resolves.toMatchObject([
			{ connectionId: "connection-1", provider: "openai-compatible", revision: 1 },
		]);
		await store.verifyReadiness();

		expect(query).toHaveBeenCalledWith("SELECT 1 FROM provider_config.connections LIMIT 0");
		expect(query).toHaveBeenCalledWith("SELECT 1 FROM provider_config.profiles LIMIT 0");
	});
});
