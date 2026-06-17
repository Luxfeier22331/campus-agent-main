import { afterEach, describe, expect, it, vi } from "vitest";

import {
	activateProviderConfigProfile,
	createProviderConfigProfile,
	listProviderConfigProfiles,
	updateProviderConfigProfile,
	validateProviderConfigProfile,
} from "../src/panel/operations/provider-config/api";

describe("provider config panel client", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("uses operator provider-config endpoints and does not expect raw keys in list responses", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					profiles: [
						{
							active: true,
							baseUrl: "https://provider.example/v1",
							kind: "prompt",
							model: "gpt-test",
							profileId: "provider_profile_1",
							provider: "openai",
							revision: 3,
							role: "primary_agent",
							secretConfigured: true,
							secretLast4: "1234",
							status: "active",
							timeoutMs: 30000,
							transport: "responses",
							updatedAt: "2026-06-16T00:00:00.000Z",
						},
					],
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			),
		);

		const result = await listProviderConfigProfiles();

		expect(result.profiles[0]).not.toHaveProperty("apiKey");
		expect(result.profiles[0]?.secretLast4).toBe("1234");
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/operator/provider-config/profiles",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("sends raw API keys only in create payloads", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(JSON.stringify({ profile: { profileId: "provider_profile_1" } }), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		);

		await createProviderConfigProfile({
			apiKey: "sk-secret",
			baseUrl: "https://provider.example/v1",
			kind: "prompt",
			model: "gpt-test",
			provider: "openai",
			role: "primary_agent",
			timeoutMs: 30000,
			transport: "responses",
		});

		const [, init] = fetchSpy.mock.calls[0] ?? [];
		expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/operator/provider-config/profiles");
		expect(init?.method).toBe("POST");
		expect(String(init?.body)).toContain("sk-secret");
	});

	it("updates existing draft profiles through patch payloads", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(JSON.stringify({ profile: { profileId: "provider_profile_1" } }), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		);

		await updateProviderConfigProfile("provider_profile_1", {
			baseUrl: "https://provider.example/v2",
			model: "gpt-new",
			timeoutMs: 45000,
		});

		const [, init] = fetchSpy.mock.calls[0] ?? [];
		expect(fetchSpy.mock.calls[0]?.[0]).toBe(
			"/api/operator/provider-config/profiles/provider_profile_1",
		);
		expect(init?.method).toBe("PATCH");
		expect(String(init?.body)).toContain("gpt-new");
		expect(String(init?.body)).not.toContain("apiKey");
	});

	it("validates and activates profiles through explicit commands", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ validation: { ok: true, status: "passed" } }), {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ profile: { active: true } }), {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
			);

		await validateProviderConfigProfile("provider_profile_1");
		await activateProviderConfigProfile("provider_profile_1");

		expect(fetchSpy.mock.calls.map((call) => [call[0], call[1]?.method])).toEqual([
			["/api/operator/provider-config/profiles/provider_profile_1/validate", "POST"],
			["/api/operator/provider-config/profiles/provider_profile_1/activate", "POST"],
		]);
	});
});
