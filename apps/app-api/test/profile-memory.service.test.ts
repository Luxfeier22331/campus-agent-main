// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import {
	buildProfileMemoryService,
	type ProfileMemoryIndexer,
	type ProfileMemoryStore,
} from "../src/modules/profile-memory";

type OwnerAwareProfileMemoryIndexer = ProfileMemoryIndexer & {
	disableOwnerMemory(input: {
		tenantId?: string;
		updatedAt: string;
		userId: string;
	}): Promise<{ status: string; userId: string }>;
};

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
		findItemIdByKey: vi.fn(async () => null),
		listByOwner: vi.fn(async () => ({ enabled: true, items: [] })),
		listProjectionItems: vi.fn(async () => []),
		loadSummary: vi.fn(async () => ({ enabled: true, itemCount: 0 })),
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

function createIndexer(): OwnerAwareProfileMemoryIndexer {
	return {
		disableOwnerMemory: vi.fn(async () => ({
			status: "disabled",
			userId: "user_01HQ",
		})),
		disableExplicitMemory: vi.fn(async () => ({
			memoryId: "mem_01HQ",
			status: "disabled",
		})),
		upsertExplicitMemory: vi.fn(async () => ({
			memoryId: "mem_01HQ",
			status: "active",
		})),
	};
}

describe("profile memory service", () => {
	it("normalizes and indexes user-declared memory before PG projection upsert", async () => {
		const store = createStore();
		const indexer = createIndexer();
		const service = buildProfileMemoryService({
			generateId: () => "mem_01HQ",
			memoryIndexer: indexer,
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			store,
		});

		const result = await service.upsert({
			key: " Answer_Style ",
			principal: createPrincipal(),
			value: " 先给   结论 ",
		});

		expect(indexer.upsertExplicitMemory).toHaveBeenCalledWith({
			compactText: "answer_style: 先给 结论",
			memoryId: "mem_01HQ",
			updatedAt: "2026-04-27T08:00:00.000Z",
			userId: "user_01HQ",
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

	it("does not write PG projection when Qdrant explicit memory indexing fails", async () => {
		const store = createStore();
		const indexer = createIndexer();
		vi.mocked(indexer.upsertExplicitMemory).mockRejectedValueOnce(new Error("qdrant unavailable"));
		const service = buildProfileMemoryService({
			generateId: () => "mem_01HQ",
			memoryIndexer: indexer,
			store,
		});

		await expect(
			service.upsert({
				key: "answer_style",
				principal: createPrincipal(),
				value: "先给结论",
			}),
		).rejects.toThrow("qdrant unavailable");

		expect(store.upsertUserDeclared).not.toHaveBeenCalled();
	});

	it("reuses the existing PG memory id for repeated key upsert before indexing Qdrant", async () => {
		const store = createStore();
		vi.mocked(store.findItemIdByKey).mockResolvedValueOnce("mem_existing");
		const indexer = createIndexer();
		const service = buildProfileMemoryService({
			generateId: () => "mem_new",
			memoryIndexer: indexer,
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			store,
		});

		const result = await service.upsert({
			key: "answer_style",
			principal: createPrincipal(),
			value: "先给结论",
		});

		expect(indexer.upsertExplicitMemory).toHaveBeenCalledWith({
			compactText: "answer_style: 先给结论",
			memoryId: "mem_existing",
			updatedAt: "2026-04-27T08:00:00.000Z",
			userId: "user_01HQ",
		});
		expect(store.upsertUserDeclared).toHaveBeenCalledWith(
			expect.objectContaining({ itemId: "mem_existing" }),
		);
		expect(result.item.itemId).toBe("mem_existing");
	});

	it("disables Qdrant memory before deleting PG projection", async () => {
		const store = createStore();
		const indexer = createIndexer();
		const service = buildProfileMemoryService({
			memoryIndexer: indexer,
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			store,
		});

		const result = await service.deleteItem({
			itemId: "mem_01HQ",
			principal: createPrincipal(),
		});

		expect(indexer.disableExplicitMemory).toHaveBeenCalledWith({
			memoryId: "mem_01HQ",
			updatedAt: "2026-04-27T09:00:00.000Z",
			userId: "user_01HQ",
		});
		expect(store.deleteItem).toHaveBeenCalledWith({
			itemId: "mem_01HQ",
			ownerUserId: "user_01HQ",
		});
		expect(result).toEqual({ deleted: true });
	});

	it("does not delete PG projection when Qdrant memory disable fails", async () => {
		const store = createStore();
		const indexer = createIndexer();
		vi.mocked(indexer.disableExplicitMemory).mockRejectedValueOnce(new Error("disable failed"));
		const service = buildProfileMemoryService({ memoryIndexer: indexer, store });

		await expect(
			service.deleteItem({
				itemId: "mem_01HQ",
				principal: createPrincipal(),
			}),
		).rejects.toThrow("disable failed");

		expect(store.deleteItem).not.toHaveBeenCalled();
	});

	it("disables owner memory in Qdrant before disabling PG memory setting", async () => {
		const store = createStore();
		const indexer = createIndexer();
		const service = buildProfileMemoryService({
			memoryIndexer: indexer,
			now: () => new Date("2026-04-27T10:00:00.000Z"),
			store,
		});

		const result = await service.setEnabled({
			enabled: false,
			principal: createPrincipal(),
		});

		expect(indexer.disableOwnerMemory).toHaveBeenCalledWith({
			updatedAt: "2026-04-27T10:00:00.000Z",
			userId: "user_01HQ",
		});
		expect(store.setEnabled).toHaveBeenCalledWith({
			enabled: false,
			ownerUserId: "user_01HQ",
			updatedAt: "2026-04-27T10:00:00.000Z",
		});
		expect(result).toEqual({ enabled: false });
	});

	it("does not disable PG memory setting when Qdrant owner memory disable fails", async () => {
		const store = createStore();
		const indexer = createIndexer();
		vi.mocked(indexer.disableOwnerMemory).mockRejectedValueOnce(new Error("owner disable failed"));
		const service = buildProfileMemoryService({ memoryIndexer: indexer, store });

		await expect(
			service.setEnabled({
				enabled: false,
				principal: createPrincipal(),
			}),
		).rejects.toThrow("owner disable failed");

		expect(store.setEnabled).not.toHaveBeenCalled();
	});

	it("does not call Qdrant owner disable when enabling memory setting", async () => {
		const store = createStore();
		const indexer = createIndexer();
		const service = buildProfileMemoryService({ memoryIndexer: indexer, store });

		await service.setEnabled({
			enabled: true,
			principal: createPrincipal(),
		});

		expect(indexer.disableOwnerMemory).not.toHaveBeenCalled();
		expect(store.setEnabled).toHaveBeenCalledWith(
			expect.objectContaining({
				enabled: true,
				ownerUserId: "user_01HQ",
			}),
		);
	});

	it("rejects memory keys that look like authorization state", async () => {
		const store = createStore();
		const indexer = createIndexer();
		const service = buildProfileMemoryService({ memoryIndexer: indexer, store });

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
		expect(indexer.upsertExplicitMemory).not.toHaveBeenCalled();
		expect(store.upsertUserDeclared).not.toHaveBeenCalled();
	});
});
