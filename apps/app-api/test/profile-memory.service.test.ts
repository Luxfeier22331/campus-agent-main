// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { AppApiRouteError } from "../src/http";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import {
	buildProfileMemoryService,
	type ProfileMemoryCommandAdmitter,
	type ProfileMemoryStore,
} from "../src/modules/profile-memory";

function createPrincipal(chat = true): ResolvedAppPrincipal {
	return {
		actor: {
			departments: [],
			principalId: "user_01HQ",
			principalType: "campus_member",
			roles: ["campus_member"],
			userId: "user_01HQ",
		},
		authorization: undefined,
		permissions: { chat },
		principal: {
			displayName: "Jane Doe",
			email: "jane@example.edu",
			principalId: "user_01HQ",
			type: "campus_member",
		},
		session: { expiresAt: "2026-04-27T08:00:00.000Z", sessionId: "sess_01HQ" },
	};
}

function pendingResult(item = true) {
	return {
		...(item
			? {
					item: pendingItem(),
				}
			: {}),
		lifecycleState: "active" as const,
		syncStatus: "pending" as const,
	};
}

function pendingItem() {
	return {
		itemId: "mem_01HQ",
		key: "answer_style",
		revision: 1,
		state: "saving" as const,
		updatedAt: "2026-04-27T08:00:00.000Z",
		value: "先给结论",
	};
}

function createStore(): ProfileMemoryStore {
	return {
		applyCommandResult: vi.fn(async () => "applied" as const),
		createItem: vi.fn(async () => pendingResult()),
		deleteItem: vi.fn(async () => ({
			...pendingResult(),
			item: { ...pendingItem(), state: "deleting" as const },
		})),
		erase: vi.fn(async () => ({
			lifecycleState: "erasing" as const,
			syncStatus: "pending" as const,
		})),
		listPendingAdmissions: vi.fn(async () => []),
		markCommandAdmitted: vi.fn(async () => true),
		listByOwner: vi.fn(async () => ({
			itemCount: 0,
			items: [],
			lifecycleState: "active" as const,
			syncStatus: "synced" as const,
		})),
		listProjectionItems: vi.fn(async () => []),
		loadSummary: vi.fn(async () => ({
			enabled: true,
			itemCount: 0,
			lifecycleState: "active" as const,
			syncStatus: "synced" as const,
		})),
		setLifecycle: vi.fn(async (_input) => ({
			lifecycleState: "paused" as const,
			syncStatus: "pending" as const,
		})),
		updateItem: vi.fn(async () => ({
			...pendingResult(),
			item: { ...pendingItem(), revision: 2 },
		})),
	};
}

describe("profile memory service", () => {
	it("writes normalized desired state and a command without calling Hindsight inline", async () => {
		const store = createStore();
		const service = buildProfileMemoryService({
			generateId: (prefix) => (prefix === "mem" ? "mem_01HQ" : "memcmd_01HQ"),
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			store,
		});

		const result = await service.createItem({
			idempotencyKey: "idem-create-0001",
			key: " Answer_Style ",
			principal: createPrincipal(),
			value: " 先给   结论 ",
		});

		expect(store.createItem).toHaveBeenCalledWith(
			expect.objectContaining({
				commandId: "memcmd_01HQ",
				itemId: "mem_01HQ",
				key: "answer_style",
				ownerUserId: "user_01HQ",
				updatedAt: "2026-04-27T08:00:00.000Z",
				value: "先给 结论",
			}),
		);
		expect(result.syncStatus).toBe("pending");
	});

	it("models pause as an owner transition and preserves the generation in the store", async () => {
		const store = createStore();
		const service = buildProfileMemoryService({ generateId: () => "memcmd_pause", store });
		await service.setLifecycle({
			idempotencyKey: "idem-pause-0001",
			principal: createPrincipal(),
			state: "paused",
		});
		expect(store.setLifecycle).toHaveBeenCalledWith(
			expect.objectContaining({ lifecycleState: "paused", ownerUserId: "user_01HQ" }),
		);
		expect(store.erase).not.toHaveBeenCalled();
	});

	it("admits pending commands without executing or finalizing provider work", async () => {
		const store = createStore();
		vi.mocked(store.listPendingAdmissions).mockResolvedValueOnce([
			{
				commandId: "memcmd_01HQ",
				commandKind: "item_upsert",
				item: { key: "answer_style", value: "先给结论" },
				lifecycleState: "active",
				ownerGeneration: 1,
				ownerSequence: 1,
				ownerUserId: "user_01HQ",
				schemaVersion: "personal_memory_command.v2",
				sourceMessageIds: [],
				sourceUpdatedAt: "2026-04-27T08:00:00.000Z",
				status: "pending_admission",
				subjectId: "mem_01HQ",
				subjectRevision: 1,
				supersessionScope: "item:mem_01HQ",
			},
		]);
		const commandAdmitter: ProfileMemoryCommandAdmitter = {
			admit: vi.fn(async () => ({ workflowId: "campus-agent.memory.command.memcmd_01HQ" })),
		};
		const service = buildProfileMemoryService({
			commandAdmitter,
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			store,
		});

		await expect(service.dispatchPending()).resolves.toEqual({
			admitted: 1,
			failed: 0,
			processed: 1,
		});
		expect(store.listPendingAdmissions).toHaveBeenCalledWith({ limit: 20 });
		expect(store.markCommandAdmitted).toHaveBeenCalledWith({
			admittedAt: "2026-04-27T08:00:00.000Z",
			commandId: "memcmd_01HQ",
			workflowId: "campus-agent.memory.command.memcmd_01HQ",
		});
	});

	it("rejects a missing or weak idempotency key before writing", async () => {
		const store = createStore();
		const service = buildProfileMemoryService({ store });
		await expect(
			service.erase({ idempotencyKey: "short", principal: createPrincipal() }),
		).rejects.toMatchObject({
			code: "invalid_idempotency_key",
			status: 400,
		} satisfies Partial<AppApiRouteError>);
		expect(store.erase).not.toHaveBeenCalled();
	});

	it("maps untrusted callback errors to the bounded public failure kind", async () => {
		const store = createStore();
		const service = buildProfileMemoryService({ store });
		await service.applyResult({
			commandId: "memcmd_01HQ",
			errorCode: "postgres://user:secret@internal-db/runtime",
			resultFingerprint: "a".repeat(64),
			status: "failed",
		});
		expect(store.applyCommandResult).toHaveBeenCalledWith(
			expect.objectContaining({ errorCode: "personal_memory_command_failed" }),
		);
	});

	it("rejects principals without chat permission", async () => {
		const service = buildProfileMemoryService({ store: createStore() });
		await expect(service.list({ principal: createPrincipal(false) })).rejects.toMatchObject({
			code: "forbidden",
			status: 403,
		} satisfies Partial<AppApiRouteError>);
	});
});
