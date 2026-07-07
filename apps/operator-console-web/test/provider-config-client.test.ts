import { afterEach, describe, expect, it, vi } from "vitest";

import {
	activateProviderConfigProfile,
	createProviderConfigConnection,
	createProviderConfigProfile,
	listProviderConfigConnections,
	listProviderConfigProfiles,
	updateProviderConfigConnection,
	updateProviderConfigProfile,
	validateProviderConfigProfile,
} from "../src/panel/operations/provider-config/api";

describe("provider config panel client", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("lists provider connections without expecting raw keys", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					connections: [
						{
							baseUrl: "https://provider.example/v1",
							connectionId: "provider_connection_1",
							features: ["prompt"],
							provider: "openai-compatible",
							revision: 1,
							secretConfigured: true,
							secretLast4: "1234",
							updatedAt: "2026-06-16T00:00:00.000Z",
						},
					],
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			),
		);

		const result = await listProviderConfigConnections();

		expect(result.connections[0]).not.toHaveProperty("apiKey");
		expect(result.connections[0]?.secretLast4).toBe("1234");
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/operator/provider-config/connections",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("lists provider profiles without expecting raw keys", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					profiles: [
						{
							active: true,
							baseUrl: "https://provider.example/v1",
							connectionId: "provider_connection_1",
							kind: "prompt",
							model: "gpt-test",
							profileId: "provider_profile_1",
							provider: "openai-compatible",
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

	it("sends raw API keys only in connection payloads", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(JSON.stringify({ connection: { connectionId: "provider_connection_1" } }), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		);

		await createProviderConfigConnection({
			apiKey: "sk-secret",
			baseUrl: "https://provider.example/v1",
			features: ["prompt"],
			provider: "openai-compatible",
		});

		const [, init] = fetchSpy.mock.calls[0] ?? [];
		expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/operator/provider-config/connections");
		expect(init?.method).toBe("POST");
		expect(String(init?.body)).toContain("sk-secret");
	});

	it("creates profiles by referencing an existing connection", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(JSON.stringify({ profile: { profileId: "provider_profile_1" } }), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		);

		await createProviderConfigProfile({
			connectionId: "provider_connection_1",
			kind: "prompt",
			model: "gpt-test",
			role: "primary_agent",
			timeoutMs: 30000,
			transport: "responses",
		});

		const [, init] = fetchSpy.mock.calls[0] ?? [];
		expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/operator/provider-config/profiles");
		expect(init?.method).toBe("POST");
		expect(String(init?.body)).toContain("provider_connection_1");
		expect(String(init?.body)).not.toContain("sk-secret");
		expect(String(init?.body)).not.toContain("baseUrl");
	});

	it("updates connections and draft profiles through patch payloads", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ connection: { connectionId: "provider_connection_1" } }), {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ profile: { profileId: "provider_profile_1" } }), {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
			);

		await updateProviderConfigConnection("provider_connection_1", {
			baseUrl: "https://provider.example/v2",
		});
		await updateProviderConfigProfile("provider_profile_1", {
			connectionId: "provider_connection_1",
			model: "gpt-new",
			timeoutMs: 45000,
		});

		expect(fetchSpy.mock.calls.map((call) => [call[0], call[1]?.method])).toEqual([
			["/api/operator/provider-config/connections/provider_connection_1", "PATCH"],
			["/api/operator/provider-config/profiles/provider_profile_1", "PATCH"],
		]);
		expect(String(fetchSpy.mock.calls[1]?.[1]?.body)).toContain("gpt-new");
		expect(String(fetchSpy.mock.calls[1]?.[1]?.body)).not.toContain("apiKey");
		expect(String(fetchSpy.mock.calls[1]?.[1]?.body)).not.toContain("baseUrl");
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
