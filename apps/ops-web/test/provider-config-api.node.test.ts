// @vitest-environment node

import { ProviderConfigError } from "@campus-agent/provider-config";
import { describe, expect, it, vi } from "vitest";
import { createOpsApp } from "../src/server/app.ts";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission.ts";
import type { ProviderConfigService } from "../src/server/provider-config-service.ts";

describe("provider config API", () => {
	it("allows service identities to read but never mutate provider config", async () => {
		const service = providerService();
		const app = createOpsApp({
			admission: createAllowAllOpsAdmission({ principalClass: "service", serviceId: "ops-reader" }),
			providerConfigService: service,
		});

		expect((await app.request("/api/ops/provider-config/connections")).status).toBe(200);
		const write = await app.request(
			"https://ops.example.test/api/ops/provider-config/connections",
			{
				body: "{}",
				headers: { "content-type": "application/json", origin: "https://ops.example.test" },
				method: "POST",
			},
		);

		expect(write.status).toBe(403);
		expect(service.createConnection).not.toHaveBeenCalled();
	});

	it("projects the human actor and preserves 422 validation responses", async () => {
		const service = providerService();
		vi.mocked(service.createConnection).mockRejectedValueOnce(
			new ProviderConfigError("validation_failed", "baseUrl 无效。", 422, { field: "baseUrl" }),
		);
		const app = createOpsApp({
			admission: createAllowAllOpsAdmission({
				displayName: "值班员",
				operatorId: "operator-1",
			}),
			providerConfigService: service,
		});

		const response = await app.request(
			"https://ops.example.test/api/ops/provider-config/connections",
			{
				body: JSON.stringify({ baseUrl: "invalid" }),
				headers: { "content-type": "application/json", origin: "https://ops.example.test" },
				method: "POST",
			},
		);

		expect(response.status).toBe(422);
		await expect(response.json()).resolves.toEqual({
			error: { code: "validation_failed", field: "baseUrl", message: "baseUrl 无效。" },
		});
		expect(service.createConnection).toHaveBeenCalledWith(
			{ baseUrl: "invalid" },
			{ displayName: "值班员", principalId: "operator-1" },
		);
	});
});

function providerService(): ProviderConfigService {
	return {
		activate: vi.fn(),
		createConnection: vi.fn(),
		createProfile: vi.fn(),
		listConnections: vi.fn(async () => ({ connections: [] })),
		listProfiles: vi.fn(async () => ({ profiles: [], runtime: emptyRuntime() })),
		runtimeStatus: vi.fn(async () => emptyRuntime()),
		updateConnection: vi.fn(),
		updateProfile: vi.fn(),
		validate: vi.fn(),
		verifyReadiness: vi.fn(async () => undefined),
	};
}

function emptyRuntime() {
	return {
		configured: false,
		digest: null,
		profiles: {},
		publicationId: null,
		publishedAt: null,
		publishedBy: null,
	};
}
