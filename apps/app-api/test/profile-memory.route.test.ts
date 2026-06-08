// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://hub.muc.wiki",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

function createCampusPrincipal() {
	return {
		actor: {
			departments: [],
			principalId: "user_01HQ",
			principalType: "campus_member" as const,
			roles: ["campus_member"],
			userId: "user_01HQ",
		},
		authorization: {
			approvalState: "",
			entitlementGroups: [],
			entitlementSnapshotId: "",
			ownershipScopes: [],
			principalId: "user_01HQ",
			projectionSource: "campus_identity" as const,
			retrievalFilter: {
				entitlementGroups: [],
				policyProjectionVersion: "phase1-authorization-projection-v1",
				visibilityLevel: "public",
				visibilityScope: null,
			},
			visibilityScope: null,
		},
		permissions: {
			chat: true,
			operator: false,
		},
		principal: {
			displayName: "Jane Doe",
			email: "jane@example.edu",
			principalId: "user_01HQ",
			type: "campus_member" as const,
		},
		session: {
			expiresAt: "2026-03-29T07:00:00.000Z",
			sessionId: "sess_01HQ",
		},
	};
}

describe("profile memory routes", () => {
	it("lets the signed-in user list and upsert visible profile memory", async () => {
		const profileMemoryService = {
			deleteItem: vi.fn(),
			list: vi.fn().mockResolvedValue({
				enabled: true,
				items: [
					{
						confidence: "low",
						itemId: "mem_01HQ",
						key: "recent_goal",
						lastVerifiedAt: "2026-04-27T00:00:00.000Z",
						sourceType: "user_declared",
						updatedAt: "2026-04-27T00:00:00.000Z",
						value: "准备保研材料",
						visibility: "user_visible",
					},
				],
			}),
			setEnabled: vi.fn(),
			upsert: vi.fn().mockResolvedValue({
				item: {
					confidence: "low",
					itemId: "mem_02HQ",
					key: "answer_style",
					lastVerifiedAt: "2026-04-27T00:01:00.000Z",
					sourceType: "user_declared",
					updatedAt: "2026-04-27T00:01:00.000Z",
					value: "先给结论",
					visibility: "user_visible",
				},
			}),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			profileMemoryService,
		} as Parameters<typeof createApp>[1]);

		const listResponse = await app.fetch(
			new Request("https://app-api.internal/api/me/profile-memory"),
		);
		const upsertResponse = await app.fetch(
			new Request("https://app-api.internal/api/me/profile-memory/items", {
				body: JSON.stringify({
					key: "answer_style",
					value: "先给结论",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(listResponse.status).toBe(200);
		await expect(listResponse.json()).resolves.toEqual({
			profileMemory: {
				enabled: true,
				items: [
					{
						confidence: "low",
						itemId: "mem_01HQ",
						key: "recent_goal",
						lastVerifiedAt: "2026-04-27T00:00:00.000Z",
						sourceType: "user_declared",
						updatedAt: "2026-04-27T00:00:00.000Z",
						value: "准备保研材料",
						visibility: "user_visible",
					},
				],
			},
		});
		expect(upsertResponse.status).toBe(200);
		await expect(upsertResponse.json()).resolves.toEqual({
			item: {
				confidence: "low",
				itemId: "mem_02HQ",
				key: "answer_style",
				lastVerifiedAt: "2026-04-27T00:01:00.000Z",
				sourceType: "user_declared",
				updatedAt: "2026-04-27T00:01:00.000Z",
				value: "先给结论",
				visibility: "user_visible",
			},
		});
		expect(profileMemoryService.list).toHaveBeenCalledWith({
			principal: expect.objectContaining({
				principal: expect.objectContaining({ principalId: "user_01HQ" }),
			}),
		});
		expect(profileMemoryService.upsert).toHaveBeenCalledWith({
			key: "answer_style",
			principal: expect.objectContaining({
				principal: expect.objectContaining({ principalId: "user_01HQ" }),
			}),
			value: "先给结论",
		});
	});

	it("lets the signed-in user disable memory projection and delete an item", async () => {
		const profileMemoryService = {
			deleteItem: vi.fn().mockResolvedValue({ deleted: true }),
			list: vi.fn(),
			setEnabled: vi.fn().mockResolvedValue({ enabled: false }),
			upsert: vi.fn(),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			profileMemoryService,
		} as Parameters<typeof createApp>[1]);

		const disableResponse = await app.fetch(
			new Request("https://app-api.internal/api/me/profile-memory/settings", {
				body: JSON.stringify({ enabled: false }),
				headers: {
					"content-type": "application/json",
				},
				method: "PATCH",
			}),
		);
		const deleteResponse = await app.fetch(
			new Request("https://app-api.internal/api/me/profile-memory/items/mem_01HQ", {
				method: "DELETE",
			}),
		);

		expect(disableResponse.status).toBe(200);
		await expect(disableResponse.json()).resolves.toEqual({
			profileMemory: { enabled: false },
		});
		expect(deleteResponse.status).toBe(200);
		await expect(deleteResponse.json()).resolves.toEqual({ deleted: true });
		expect(profileMemoryService.setEnabled).toHaveBeenCalledWith({
			enabled: false,
			principal: expect.objectContaining({
				principal: expect.objectContaining({ principalId: "user_01HQ" }),
			}),
		});
		expect(profileMemoryService.deleteItem).toHaveBeenCalledWith({
			itemId: "mem_01HQ",
			principal: expect.objectContaining({
				principal: expect.objectContaining({ principalId: "user_01HQ" }),
			}),
		});
	});
});
