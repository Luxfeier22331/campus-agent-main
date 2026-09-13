// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { AppApiRouteError } from "../src/http";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import {
	buildProfileMemoryService,
	type ProfileMemoryCommandAdmitter,
	type ProfileMemoryCommandStore,
	type ProfileMemoryMutationStore,
	type ProfileMemoryReadStore,
} from "../src/modules/profile-memory";
import { deriveProfileMemorySyncStatus } from "../src/modules/profile-memory/command-state";
import { isProfileMemoryRuntimeEnabled } from "../src/modules/profile-memory/model";

function createPrincipal(chat = true): ResolvedAppPrincipal {
	return {
		actor: {
			departments: [],
			principalId: "user_01HQ",
			principalType: "campus_member",
			roles: ["campus_member"],
			userId: "user_01HQ",
		},
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

function pendingResult() {
	return {
		commandId: "memcmd_01HQ",
		lifecycleState: "active" as const,
		syncStatus: "synced" as const,
	};
}
type TestProfileMemoryStore = ProfileMemoryCommandStore &
	ProfileMemoryMutationStore &
	ProfileMemoryReadStore;

function serviceStores(store: TestProfileMemoryStore) {
	return {
		commandStore: store,
		mutationStore: store,
		readStore: store,
	};
}

function createStore(): TestProfileMemoryStore {
	return {
		applyCommandResult: vi.fn(async () => "applied" as const),
		createItem: vi.fn(async () => pendingResult()),
		retryCommand: vi.fn(async () => pendingResult()),
		updateItem: vi.fn(async () => pendingResult()),
		erase: vi.fn(async () => ({
			...pendingResult(),
			lifecycleState: "erasing" as const,
			syncStatus: "pending" as const,
		})),
		findCommandByIdempotency: vi.fn(async () => null),
		listPendingAdmissions: vi.fn(async () => []),
		markCommandAdmitted: vi.fn(async () => true),
		markAdmissionFailed: vi.fn(async () => undefined),
		generationByOwner: vi.fn(async () => 1),
		listByOwner: vi.fn(async () => ({
			operations: [],
			lifecycleState: "active" as const,
			syncStatus: "synced" as const,
		})),
		setLifecycle: vi.fn(async () => ({
			...pendingResult(),
			lifecycleState: "paused" as const,
			syncStatus: "pending" as const,
		})),
	};
}

describe("profile memory service", () => {
	it("prioritizes pending owner work over failed heads", () => {
		expect(deriveProfileMemorySyncStatus({ hasFailedHead: true, hasNonterminalHead: true })).toBe(
			"pending",
		);
		expect(deriveProfileMemorySyncStatus({ hasFailedHead: true, hasNonterminalHead: false })).toBe(
			"failed",
		);
	});

	it.each([
		["active", "synced", true],
		["active", "failed", true],
		["active", "pending", false],
		["paused", "failed", false],
	] as const)("derives runtime availability for %s/%s", (lifecycleState, syncStatus, expected) => {
		expect(isProfileMemoryRuntimeEnabled({ lifecycleState, syncStatus })).toBe(expected);
	});

	it("enqueues natural language without an inline Hindsight write or disabling memory", async () => {
		const store = createStore();
		const service = buildProfileMemoryService({
			...serviceStores(store),
			generateId: () => "memcmd_01HQ",
		});
		const result = await service.createItem({
			principal: createPrincipal(),
			idempotencyKey: "idem-create-0001",
			text: "  先给   结论  ",
		});
		expect(store.createItem).toHaveBeenCalledWith(
			expect.objectContaining({
				commandId: "memcmd_01HQ",
				ownerUserId: "user_01HQ",
				text: "先给   结论",
			}),
		);
		expect(result.syncStatus).toBe("synced");
	});
	it("rejects empty memory text", async () => {
		const store = createStore();
		const service = buildProfileMemoryService(serviceStores(store));
		await expect(
			service.createItem({
				principal: createPrincipal(),
				idempotencyKey: "idem-empty-0001",
				text: "  ",
			}),
		).rejects.toMatchObject({ status: 400 });
		expect(store.createItem).not.toHaveBeenCalled();
	});
	it("reads and curates native facts within the owner's generation", async () => {
		const store = createStore();
		const memoryId = "a6d4624b-6db8-4dc8-a1c4-7db9c4231d0e";
		const fact = {
			memoryId,
			text: "先给结论",
			kind: "fact" as const,
			state: "active" as const,
			origin: "conversation" as const,
			mentionedAt: null,
			editedAt: null,
		};
		const memoryReader = {
			getItem: vi.fn(async () => fact),
			listItems: vi.fn(async () => ({ items: [fact], total: 1, limit: 20, offset: 0 })),
		};
		const service = buildProfileMemoryService({ ...serviceStores(store), memoryReader });
		await service.updateItem({
			principal: createPrincipal(),
			idempotencyKey: "idem-curate-0001",
			memoryId,
			state: "inactive",
		});
		expect(memoryReader.getItem).toHaveBeenCalledWith({
			ownerUserId: "user_01HQ",
			ownerGeneration: 1,
			memoryId,
		});
		expect(store.updateItem).toHaveBeenCalledWith(
			expect.objectContaining({ memoryId, state: "inactive" }),
		);
		await expect(
			service.listItems({ principal: createPrincipal(), limit: 20, offset: 0 }),
		).resolves.toMatchObject({ items: [fact] });
	});
	it("keeps derived memories read-only and does not mask provider read failure with an empty bank", async () => {
		const store = createStore();
		const memoryId = "a6d4624b-6db8-4dc8-a1c4-7db9c4231d0e";
		const service = buildProfileMemoryService({
			...serviceStores(store),
			memoryReader: {
				getItem: async () => ({
					memoryId,
					text: "summary",
					kind: "summary",
					state: "active",
					origin: "derived",
					mentionedAt: null,
					editedAt: null,
				}),
				listItems: async () => {
					throw new Error("provider unavailable");
				},
			},
		});
		await expect(
			service.updateItem({
				principal: createPrincipal(),
				idempotencyKey: "idem-summary-0001",
				memoryId,
				text: "changed",
			}),
		).rejects.toMatchObject({ code: "memory_derived_read_only" });
		expect(store.updateItem).not.toHaveBeenCalled();
		await expect(
			service.listItems({ principal: createPrincipal(), limit: 20, offset: 0 }),
		).rejects.toThrow("provider unavailable");
		await expect(service.list({ principal: createPrincipal() })).resolves.toMatchObject({
			lifecycleState: "active",
		});
	});
	it("creates a successor erase command after an account-deletion erase failed", async () => {
		const store = createStore();
		vi.mocked(store.findCommandByIdempotency)
			.mockResolvedValueOnce({ commandId: "memcmd_failed", status: "failed" })
			.mockResolvedValueOnce(null);
		const service = buildProfileMemoryService({
			...serviceStores(store),
			generateId: () => "memcmd_retry",
		});

		await service.eraseForAccountDeletion({
			principal: createPrincipal(),
			requestId: "acctdel_1",
		});

		expect(store.findCommandByIdempotency).toHaveBeenCalledTimes(2);
		expect(store.erase).toHaveBeenCalledWith(
			expect.objectContaining({
				commandId: "memcmd_retry",
				ownerUserId: "user_01HQ",
			}),
		);
		expect(vi.mocked(store.erase).mock.calls[0]?.[0].idempotencyKeyHash).toBe(
			"b1e62099442da61ebf6720675de1ed7e389ded7db627c084b95ac5a1be457145",
		);
	});

	it("models pause as an owner transition and preserves the generation in the store", async () => {
		const store = createStore();
		const service = buildProfileMemoryService({
			...serviceStores(store),
			generateId: () => "memcmd_pause",
		});
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
				commandKind: "memory_add",
				item: { text: "先给结论" },
				lifecycleState: "active",
				ownerGeneration: 1,
				ownerSequence: 1,
				ownerUserId: "user_01HQ",
				schemaVersion: "personal_memory_command.v3",
				sourceUpdatedAt: "2026-04-27T08:00:00.000Z",
				status: "pending_admission",
				subjectId: "mem_01HQ",
				supersessionScope: "memory:mem_01HQ",
			},
		]);
		const commandAdmitter: ProfileMemoryCommandAdmitter = {
			admit: vi.fn(async () => undefined),
		};
		const service = buildProfileMemoryService({
			...serviceStores(store),
			commandAdmitter,
			now: () => new Date("2026-04-27T08:00:00.000Z"),
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
		});
	});

	it("rejects a missing or weak idempotency key before writing", async () => {
		const store = createStore();
		const service = buildProfileMemoryService(serviceStores(store));
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
		const service = buildProfileMemoryService(serviceStores(store));
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
		const service = buildProfileMemoryService(serviceStores(createStore()));
		await expect(service.list({ principal: createPrincipal(false) })).rejects.toMatchObject({
			code: "forbidden",
			status: 403,
		} satisfies Partial<AppApiRouteError>);
	});
});
