// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createOpsApp } from "../src/server/app";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { ProviderConfigAdminResponseError } from "../src/server/provider-config-client";

const status = {
	activeRevision: 0,
	connections: [],
	profiles: [],
	roles: [
		{ configured: false, role: "primary_agent" as const },
		{ configured: false, role: "rag_query_embedding" as const },
		{ configured: false, role: "rag_reranker" as const },
	],
	sampledAt: "2026-07-14T10:00:00.000Z",
};

describe("ops provider config BFF", () => {
	it("keeps service principals read-only", async () => {
		const command = vi.fn();
		const app = createOpsApp({
			admission: createAllowAllOpsAdmission({ principalClass: "service", serviceId: "smoke" }),
			env: {
				OPS_WEB_PROVIDER_CONFIG_WRITE_HUMAN_EMAIL_ALLOWLIST: "ops@example.test",
				OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test",
			},
			providerConfigClient: { command, getStatus: async () => status },
		});
		const read = await app.request("http://ops.test/api/ops/provider-config");
		expect(read.status).toBe(200);
		expect(await read.json()).toMatchObject({ writeAllowed: false });
		const write = await app.request("http://ops.test/api/ops/provider-config/connections", {
			body: "{}",
			headers: { "content-type": "application/json", origin: "http://ops.test" },
			method: "POST",
		});
		expect(write.status).toBe(403);
		expect(command).not.toHaveBeenCalled();
	});

	it("requires same-origin writes from an allowlisted human", async () => {
		const command = vi.fn().mockResolvedValue({ connection: { connectionId: "connection_1" } });
		const app = createOpsApp({
			admission: createAllowAllOpsAdmission({ email: "ops@example.test", principalClass: "human" }),
			env: {
				OPS_WEB_PROVIDER_CONFIG_WRITE_HUMAN_EMAIL_ALLOWLIST: "ops@example.test",
				OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test",
			},
			providerConfigClient: { command, getStatus: async () => status },
		});
		const rejected = await app.request("http://ops.test/api/ops/provider-config/connections", {
			body: "{}",
			headers: { "content-type": "application/json", origin: "http://attacker.test" },
			method: "POST",
		});
		expect(rejected.status).toBe(403);
		const accepted = await app.request("http://ops-web:5178/api/ops/provider-config/connections", {
			body: JSON.stringify({ provider: "openai" }),
			headers: {
				"content-type": "application/json",
				"idempotency-key": "cmd-1",
				origin: "https://ops.example.test",
				"sec-fetch-site": "same-origin",
			},
			method: "POST",
		});
		expect(accepted.status).toBe(200);
		expect(command).toHaveBeenCalledWith(
			"/connections",
			{ provider: "openai" },
			"ops@example.test",
			"cmd-1",
		);
	});

	it("preserves provider admin response status and body", async () => {
		const upstream = new Response(
			JSON.stringify({
				error: { code: "provider_activation_conflict", message: "revision conflict" },
			}),
			{ headers: { "content-type": "application/json" }, status: 409 },
		);
		const app = createOpsApp({
			admission: createAllowAllOpsAdmission(),
			providerConfigClient: {
				command: vi.fn(),
				getStatus: async () => {
					throw new ProviderConfigAdminResponseError(upstream);
				},
			},
		});

		const response = await app.request("http://ops.test/api/ops/provider-config");

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: { code: "provider_activation_conflict", message: "revision conflict" },
		});
	});
});
