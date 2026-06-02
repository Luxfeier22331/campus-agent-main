import { describe, expect, it, vi } from "vitest";

import { loadAccountOverview, updateAccountPreferences } from "../src/routes/account-session";

const validOverviewPayload = {
	account: {
		accountId: "user_01HQ",
		displayName: "Jane Doe",
		email: "jane@muc.edu.cn",
		status: "active",
	},
	session: {
		credentialRuntime: "better_auth",
		expiresAt: "2026-03-29T07:00:00.000Z",
		sessionId: "sess_01HQ",
		state: "authenticated",
	},
	identity: {
		claimsVersion: "identity-claims-v1",
		principalId: "user_01HQ",
		principalType: "campus_member",
		verificationStatus: "unverified",
	},
	access: {
		availableApps: ["chat", "docs", "account"],
		entitlementGroups: ["campus_members"],
		permissions: {
			chat: true,
			operator: false,
		},
		restrictedSurfacesReady: false,
	},
	preferences: {
		profileMemoryEnabled: true,
		profileMemoryItemCount: 0,
	},
	federation: {
		connectedClients: [],
		enabled: false,
	},
};

describe("hub account session loader", () => {
	it("treats invalid JSON success payloads as service unavailable", async () => {
		const fetchImplementation = vi.fn(
			async () =>
				new Response("{", {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
		);

		await expect(loadAccountOverview(fetchImplementation)).resolves.toEqual({
			overview: null,
			state: "service_unavailable",
		});
	});

	it("does not treat missing account email as logged out", async () => {
		const fetchImplementation = vi.fn(
			async () =>
				new Response(JSON.stringify({ ...validOverviewPayload, account: {} }), {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
		);

		await expect(loadAccountOverview(fetchImplementation)).resolves.toEqual({
			overview: null,
			state: "service_unavailable",
		});
	});

	it("keeps explicit 401 responses as unauthenticated", async () => {
		const fetchImplementation = vi.fn(async () => new Response("unauthorized", { status: 401 }));

		await expect(loadAccountOverview(fetchImplementation)).resolves.toEqual({
			overview: null,
			state: "unauthenticated",
		});
	});

	it("loads the app-api account overview projection", async () => {
		const fetchImplementation = vi.fn(
			async () =>
				new Response(JSON.stringify(validOverviewPayload), {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
		);

		await expect(loadAccountOverview(fetchImplementation)).resolves.toEqual({
			overview: validOverviewPayload,
			state: "ready",
		});
		expect(fetchImplementation).toHaveBeenCalledWith("/api/me/overview", {
			credentials: "include",
			headers: { accept: "application/json" },
		});
	});

	it("updates account-center preferences through the scoped app-api endpoint", async () => {
		const fetchImplementation = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						preferences: {
							profileMemoryEnabled: false,
							profileMemoryItemCount: 4,
						},
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					},
				),
		);

		await expect(
			updateAccountPreferences({ profileMemoryEnabled: false }, fetchImplementation),
		).resolves.toEqual({
			preferences: {
				profileMemoryEnabled: false,
				profileMemoryItemCount: 4,
			},
			state: "ready",
		});
		expect(fetchImplementation).toHaveBeenCalledWith("/api/me/preferences", {
			body: JSON.stringify({ profileMemoryEnabled: false }),
			credentials: "include",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
			},
			method: "PATCH",
		});
	});

	it("treats invalid preference update payloads as service unavailable", async () => {
		const fetchImplementation = vi.fn(
			async () =>
				new Response(JSON.stringify({ preferences: { profileMemoryEnabled: false } }), {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
		);

		await expect(
			updateAccountPreferences({ profileMemoryEnabled: false }, fetchImplementation),
		).resolves.toEqual({
			preferences: null,
			state: "service_unavailable",
		});
	});
});
