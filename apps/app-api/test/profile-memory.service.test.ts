// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { AppApiRouteError } from "../src/http";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import { MemoryServiceTransportError } from "../src/modules/integration/memory-service-requester";
import {
	buildProfileMemoryService,
	type ProfileMemoryCommandAdmitter,
	type ProfileMemoryCommandStore,
	type ProfileMemoryMutationStore,
	type ProfileMemoryReadStore,
} from "../src/modules/profile-memory";
import { deriveProfileMemorySyncStatus } from "../src/modules/profile-memory/command-state";
import { isProfileMemoryRuntimeEnabled } from "../src/modules/profile-memory/model";
import { ProfileMemoryStoreConflict } from "../src/modules/profile-memory/store-contract";

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
type TestProfileMemoryStore = Omit<
	ProfileMemoryCommandStore,
	"listAdmittedCommands" | "listFailedLifecycleCommands"
> &
	ProfileMemoryMutationStore &
	ProfileMemoryReadStore & {
		listAdmittedCommands: NonNullable<ProfileMemoryCommandStore["listAdmittedCommands"]>;
		listFailedLifecycleCommands: NonNullable<
			ProfileMemoryCommandStore["listFailedLifecycleCommands"]
		>;
	};

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
		submitCorrection: vi.fn(async () => pendingResult()),
		retryCommand: vi.fn(async () => pendingResult()),
		erase: vi.fn(async () => ({
			...pendingResult(),
			lifecycleState: "erased" as const,
			syncStatus: "pending" as const,
		})),
		findCommandByIdempotency: vi.fn(async () => null),
		listPendingAdmissions: vi.fn(async () => []),
		listAdmittedCommands: vi.fn(async () => []),
		listFailedLifecycleCommands: vi.fn(async () => []),
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
		["active", "failed", false],
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
		const result = await service.submitCorrection({
			principal: createPrincipal(),
			idempotencyKey: "idem-create-0001",
			text: "  先给   结论  ",
		});
		expect(store.submitCorrection).toHaveBeenCalledWith(
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
			service.submitCorrection({
				principal: createPrincipal(),
				idempotencyKey: "idem-empty-0001",
				text: "  ",
			}),
		).rejects.toMatchObject({ status: 400 });
		expect(store.submitCorrection).not.toHaveBeenCalled();
	});
	it("reads the synthesized profile within the owner's generation", async () => {
		const store = createStore();
		const profile = {
			content: "偏好简洁回复",
			generating: false,
			isStale: false,
			lastRefreshedAt: "2026-09-24T00:00:00Z",
		};
		const memoryReader = {
			getProfile: vi.fn(async () => profile),
		};
		const service = buildProfileMemoryService({ ...serviceStores(store), memoryReader });
		await expect(service.getProfile({ principal: createPrincipal() })).resolves.toMatchObject(
			profile,
		);
		expect(memoryReader.getProfile).toHaveBeenCalledWith({
			ownerUserId: "user_01HQ",
			ownerGeneration: 1,
		});
	});
	it("returns a local empty profile when erased without reading the provider", async () => {
		const store = createStore();
		vi.mocked(store.listByOwner).mockResolvedValue({
			operations: [],
			lifecycleState: "erased",
			syncStatus: "synced",
		});
		const memoryReader = {
			getProfile: vi.fn(async () => {
				throw new Error("provider must not be read");
			}),
		};
		const service = buildProfileMemoryService({ ...serviceStores(store), memoryReader });
		await expect(service.getProfile({ principal: createPrincipal() })).resolves.toEqual({
			content: "",
			generating: false,
			isStale: false,
			lastRefreshedAt: "",
		});
		expect(memoryReader.getProfile).not.toHaveBeenCalled();
	});
	it("surfaces provider read failure without masking it", async () => {
		const store = createStore();
		vi.mocked(store.listByOwner).mockResolvedValue({
			operations: [],
			lifecycleState: "active",
			syncStatus: "synced",
		});
		const service = buildProfileMemoryService({
			...serviceStores(store),
			memoryReader: {
				getProfile: async () => {
					throw new Error("provider unavailable");
				},
			},
		});
		await expect(service.getProfile({ principal: createPrincipal() })).rejects.toThrow(
			"provider unavailable",
		);
	});
	it("re-enqueues failed lifecycle commands for the scheduled retry sweep", async () => {
		const store = createStore();
		vi.mocked(store.listFailedLifecycleCommands).mockResolvedValue([
			{ commandId: "memcmd_failed_erase", ownerUserId: "user_01HQ" },
			{ commandId: "memcmd_failed_transition", ownerUserId: "user_02HQ" },
		]);
		const service = buildProfileMemoryService({
			...serviceStores(store),
			generateId: (prefix) => `${prefix}_retry`,
		});

		await expect(service.retryFailedLifecycleCommands?.()).resolves.toEqual({
			retried: 2,
			failed: 0,
			processed: 2,
		});

		expect(store.retryCommand).toHaveBeenCalledTimes(2);
		expect(vi.mocked(store.retryCommand).mock.calls[0]?.[0]).toMatchObject({
			commandId: "memcmd_retry",
			ownerUserId: "user_01HQ",
			failedCommandId: "memcmd_failed_erase",
		});
		expect(vi.mocked(store.retryCommand).mock.calls[1]?.[0]).toMatchObject({
			commandId: "memcmd_retry",
			ownerUserId: "user_02HQ",
			failedCommandId: "memcmd_failed_transition",
		});
	});
	it("counts conflicts as failures without aborting the retry sweep", async () => {
		const store = createStore();
		vi.mocked(store.listFailedLifecycleCommands).mockResolvedValue([
			{ commandId: "memcmd_stuck", ownerUserId: "user_01HQ" },
			{ commandId: "memcmd_retriable", ownerUserId: "user_02HQ" },
		]);
		vi.mocked(store.retryCommand)
			.mockRejectedValueOnce(new ProfileMemoryStoreConflict("profile_memory_not_ready"))
			.mockResolvedValueOnce({ ...pendingResult(), syncStatus: "pending" as const });
		const service = buildProfileMemoryService(serviceStores(store));

		await expect(service.retryFailedLifecycleCommands?.()).resolves.toEqual({
			retried: 1,
			failed: 1,
			processed: 2,
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

	it("reconciles admitted commands from the agent-control receipt", async () => {
		const store = createStore();
		vi.mocked(store.listAdmittedCommands).mockResolvedValueOnce([
			{
				commandId: "memcmd_01HR",
				commandKind: "memory_add",
				item: { text: "新的偏好" },
				lifecycleState: "active",
				ownerGeneration: 1,
				ownerSequence: 2,
				ownerUserId: "user_01HQ",
				status: "admitted",
				subjectId: "mem_01HR",
				supersessionScope: "memory:mem_01HR",
				schemaVersion: "personal_memory_command.v3",
				sourceUpdatedAt: "2026-09-24T00:00:00.000Z",
			},
		]);
		const commandStatusReader = {
			getCommandStatus: vi.fn(async () => ({
				commandId: "memcmd_01HR",
				status: "succeeded",
				errorCode: "",
				stale: false,
			})),
		};
		const service = buildProfileMemoryService({
			...serviceStores(store),
			commandStatusReader,
		});

		await expect(service.reconcileAdmitted?.()).resolves.toEqual({
			reconciled: 1,
			failed: 0,
			processed: 1,
		});
		expect(store.applyCommandResult).toHaveBeenCalledWith(
			expect.objectContaining({
				commandId: "memcmd_01HR",
				status: "succeeded",
			}),
		);
	});

	it("reports a missing Memory request without recreating accepted work", async () => {
		const store = createStore();
		const command = {
			commandId: "memcmd_01HS",
			commandKind: "memory_add" as const,
			item: { text: "重新准入" },
			lifecycleState: "active" as const,
			ownerGeneration: 1,
			ownerSequence: 3,
			ownerUserId: "user_01HQ",
			status: "admitted" as const,
			subjectId: "mem_01HS",
			supersessionScope: "memory:mem_01HS",
			schemaVersion: "personal_memory_command.v3" as const,
			sourceUpdatedAt: "2026-09-24T00:00:00.000Z",
		};
		vi.mocked(store.listAdmittedCommands).mockResolvedValueOnce([command]);
		const commandAdmitter: ProfileMemoryCommandAdmitter = {
			admit: vi.fn(async () => undefined),
		};
		const commandStatusReader = {
			getCommandStatus: vi.fn(async () => {
				throw new MemoryServiceTransportError("command_not_found", 404, false);
			}),
		};
		const service = buildProfileMemoryService({
			...serviceStores(store),
			commandAdmitter,
			commandStatusReader,
		});

		await expect(service.reconcileAdmitted?.()).resolves.toEqual({
			reconciled: 0,
			failed: 1,
			processed: 1,
		});
		expect(commandAdmitter.admit).not.toHaveBeenCalled();
		expect(store.applyCommandResult).not.toHaveBeenCalled();
	});

	it("leaves stale receipt recovery to the independent Memory Worker", async () => {
		const store = createStore();
		const command = {
			commandId: "memcmd_01HT",
			commandKind: "memory_add" as const,
			item: { text: "过期单据" },
			lifecycleState: "active" as const,
			ownerGeneration: 1,
			ownerSequence: 4,
			ownerUserId: "user_01HQ",
			status: "admitted" as const,
			subjectId: "mem_01HT",
			supersessionScope: "memory:mem_01HT",
			schemaVersion: "personal_memory_command.v3" as const,
			sourceUpdatedAt: "2026-09-24T00:00:00.000Z",
		};
		vi.mocked(store.listAdmittedCommands).mockResolvedValueOnce([command]);
		const commandAdmitter: ProfileMemoryCommandAdmitter = {
			admit: vi.fn(async () => undefined),
		};
		const commandStatusReader = {
			getCommandStatus: vi.fn(async () => ({
				commandId: "memcmd_01HT",
				status: "processing",
				errorCode: "",
				stale: true,
			})),
		};
		const service = buildProfileMemoryService({
			...serviceStores(store),
			commandAdmitter,
			commandStatusReader,
		});

		await expect(service.reconcileAdmitted?.()).resolves.toEqual({
			reconciled: 0,
			failed: 0,
			processed: 1,
		});
		expect(commandAdmitter.admit).not.toHaveBeenCalled();
		expect(store.applyCommandResult).not.toHaveBeenCalled();
	});

	it("keeps waiting on a fresh non-terminal receipt", async () => {
		const store = createStore();
		const command = {
			commandId: "memcmd_01HU",
			commandKind: "memory_add" as const,
			item: { text: "进行中" },
			lifecycleState: "active" as const,
			ownerGeneration: 1,
			ownerSequence: 5,
			ownerUserId: "user_01HQ",
			status: "admitted" as const,
			subjectId: "mem_01HU",
			supersessionScope: "memory:mem_01HU",
			schemaVersion: "personal_memory_command.v3" as const,
			sourceUpdatedAt: "2026-09-24T00:00:00.000Z",
		};
		vi.mocked(store.listAdmittedCommands).mockResolvedValueOnce([command]);
		const commandAdmitter: ProfileMemoryCommandAdmitter = {
			admit: vi.fn(async () => undefined),
		};
		const commandStatusReader = {
			getCommandStatus: vi.fn(async () => ({
				commandId: "memcmd_01HU",
				status: "processing",
				errorCode: "",
				stale: false,
			})),
		};
		const service = buildProfileMemoryService({
			...serviceStores(store),
			commandAdmitter,
			commandStatusReader,
		});

		await expect(service.reconcileAdmitted?.()).resolves.toEqual({
			reconciled: 0,
			failed: 0,
			processed: 1,
		});
		expect(commandAdmitter.admit).not.toHaveBeenCalled();
		expect(store.applyCommandResult).not.toHaveBeenCalled();
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
