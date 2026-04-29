// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import { buildProfileMemoryService, type ProfileMemoryStore } from "../src/modules/profile-memory";

function createPrincipal(input: { chat?: boolean } = {}): ResolvedAppPrincipal {
	return {
		actor: {
			departments: [],
			principalId: "user_01HQ",
			principalType: "campus_member",
			roles: ["campus_member"],
			userId: "user_01HQ",
		},
		authorization: undefined,
		permissions: {
			chat: input.chat ?? true,
			operator: false,
		},
		principal: {
			displayName: "Jane Doe",
			email: "jane@example.edu",
			principalId: "user_01HQ",
			type: "campus_member",
		},
		session: {
			expiresAt: "2026-04-27T08:00:00.000Z",
			sessionId: "sess_01HQ",
		},
	};
}

function createStore(): ProfileMemoryStore {
	return {
		deleteItem: vi.fn(async () => true),
		listByOwner: vi.fn(async () => ({ enabled: true, items: [] })),
		listProjectionItems: vi.fn(async () => []),
		setEnabled: vi.fn(async (input) => input.enabled),
		upsertUserDeclared: vi.fn(async (input) => ({
			confidence: "low" as const,
			itemId: input.itemId,
			key: input.key,
			lastVerifiedAt: input.updatedAt,
			sourceType: "user_declared" as const,
			updatedAt: input.updatedAt,
			value: input.value,
			visibility: "user_visible" as const,
		})),
	};
}

describe("profile memory service", () => {
	it("normalizes user-declared memory before durable upsert", async () => {
		const store = createStore();
		const service = buildProfileMemoryService({
			generateId: () => "mem_01HQ",
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			store,
		});

		const result = await service.upsert({
			key: " Answer_Style ",
			principal: createPrincipal(),
			value: " 先给   结论 ",
		});

		expect(store.upsertUserDeclared).toHaveBeenCalledWith({
			itemId: "mem_01HQ",
			key: "answer_style",
			ownerUserId: "user_01HQ",
			updatedAt: "2026-04-27T08:00:00.000Z",
			value: "先给 结论",
		});
		expect(result.item).toMatchObject({
			confidence: "low",
			key: "answer_style",
			sourceType: "user_declared",
			value: "先给 结论",
			visibility: "user_visible",
		});
	});

	it("rejects memory keys that look like authorization state", async () => {
		const store = createStore();
		const service = buildProfileMemoryService({ store });

		await expect(
			service.upsert({
				key: "permission_scope",
				principal: createPrincipal(),
				value: "students",
			}),
		).rejects.toMatchObject({
			code: "invalid_profile_memory_item",
			status: 400,
		});
		expect(store.upsertUserDeclared).not.toHaveBeenCalled();
	});
});
