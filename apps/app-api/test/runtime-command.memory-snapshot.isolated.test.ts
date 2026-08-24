// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureMemorySnapshot, createRuntimeDatabase, createRuntimeDbGetter } = vi.hoisted(() => ({
	captureMemorySnapshot: vi.fn(),
	createRuntimeDatabase: vi.fn(),
	createRuntimeDbGetter: vi.fn(() => () => createRuntimeDatabase()),
}));

vi.mock("../src/db/runtime", () => ({
	createRuntimeDatabase,
	createRuntimeDbGetter,
}));
vi.mock("../src/modules/profile-memory/snapshot", () => ({
	captureProfileMemorySnapshotForUpdate: captureMemorySnapshot,
}));

import { buildAcceptedWrite } from "../src/modules/runtime-command/service/writes";
import { createPgChatCommandPersistence } from "../src/modules/runtime-command/store";
import { createConversation, createPrincipal } from "./chat-command.service.test-support";

function createAcceptanceHarness(requestKind: "internal_eval" | "public_chat") {
	const conversation = createConversation();
	const freezeDurableRun = vi.fn(() => ({
		executionInputJson: '{"requestId":"req_01HQ"}',
		executionInputSha256: "b".repeat(64),
		turnId: "turn_01HQ",
	}));
	const conversationForUpdate = vi.fn().mockResolvedValue([
		{
			activeBranchId: conversation.activeBranchId,
			activeMessageId: conversation.activeMessageId,
			activeRunId: conversation.activeRunId,
			activeTurnSequence: conversation.activeTurnSequence,
			id: conversation.id,
			updatedAt: new Date(conversation.updatedAt),
		},
	]);
	const select = vi.fn(() => ({
		from: vi.fn(() => ({
			where: vi.fn(() => ({
				limit: vi.fn(() => ({ for: conversationForUpdate })),
			})),
		})),
	}));
	const update = vi
		.fn()
		.mockReturnValueOnce({
			set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
		})
		.mockReturnValueOnce({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn().mockResolvedValue([{ id: conversation.id }]),
				})),
			})),
		});
	const insert = vi
		.fn()
		.mockReturnValueOnce({ values: vi.fn().mockResolvedValue(undefined) })
		.mockReturnValueOnce({
			values: vi.fn(() => ({
				onConflictDoNothing: vi.fn(() => ({
					returning: vi.fn().mockResolvedValue([{ requestId: "req_01HQ" }]),
				})),
			})),
		})
		.mockReturnValueOnce({ values: vi.fn().mockResolvedValue(undefined) });
	const tx = { insert, select, update };
	createRuntimeDatabase.mockResolvedValue({
		transaction: vi.fn(async (callback: (input: typeof tx) => Promise<unknown>) => callback(tx)),
	});
	const store = createPgChatCommandPersistence({} as never).commands;
	const write = buildAcceptedWrite({
		assistantMessageId: "msg_assistant_01HQ",
		branchId: "branch_active",
		conversation,
		conversationTitle: conversation.title,
		freezeDurableRun,
		idempotencyKey: null,
		now: "2026-08-17T08:00:00.000Z",
		principal: createPrincipal(),
		prompt: "国家奖学金如何评审？",
		requestFingerprintSha256: null,
		requestId: "req_01HQ",
		requestKind,
		runId: "run_01HQ",
		safetyIdentifier: "safety_01HQ",
		surface: requestKind === "public_chat" ? "campus_web" : "eval_benchmark",
		traceId: "trace_01HQ",
		turnSequence: 1,
		turnId: "turn_01HQ",
		userMessageId: "msg_user_01HQ",
	});
	return { conversationForUpdate, freezeDurableRun, store, tx, write };
}

describe("runtime command profile memory snapshot boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createRuntimeDbGetter.mockImplementation(() => () => createRuntimeDatabase());
	});

	it("captures public-chat memory after locking the conversation", async () => {
		const snapshot = {
			appendEnabled: true,
			ownerGeneration: 3,
			ownerSequence: 7,
			recallEnabled: false,
		};
		captureMemorySnapshot.mockResolvedValue(snapshot);
		const harness = createAcceptanceHarness("public_chat");

		await expect(harness.store.acceptRequest(harness.write)).resolves.toMatchObject({
			memorySnapshot: snapshot,
		});

		expect(captureMemorySnapshot).toHaveBeenCalledWith(harness.tx, "user_01HQ");
		expect(harness.conversationForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
			captureMemorySnapshot.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
		);
		expect(harness.freezeDurableRun).toHaveBeenCalledWith(snapshot);
	});

	it("does not capture memory for internal evaluation", async () => {
		const harness = createAcceptanceHarness("internal_eval");

		await expect(harness.store.acceptRequest(harness.write)).resolves.toMatchObject({
			memorySnapshot: null,
		});

		expect(captureMemorySnapshot).not.toHaveBeenCalled();
		expect(harness.freezeDurableRun).toHaveBeenCalledWith(null);
	});
});
