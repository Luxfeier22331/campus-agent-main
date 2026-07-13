// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { messages, turnDispatches } from "../src/db/schema";
import type { ChatConversation } from "../src/modules/chat";
import { buildStoredIdempotentRequest } from "../src/modules/runtime-command/store-conversation";

type DispatchRow = typeof turnDispatches.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

function createConversation(): ChatConversation {
	return {
		createdAt: "2026-03-28T07:59:00.000Z",
		id: "conv_01HQ",
		messages: [],
		ownerUserId: "user_01HQ",
		sessionSlots: [],
		title: "图书馆开放时间",
		updatedAt: "2026-03-28T07:59:00.000Z",
	};
}

function dispatchRow(overrides: Partial<DispatchRow> = {}): DispatchRow {
	return {
		errorCode: "execution_timeout",
		requestFingerprintSha256: "fingerprint:图书馆开放到几点？",
		requestId: "req_prev",
		status: "error",
		traceId: "trace_prev",
		...overrides,
	} as DispatchRow;
}

function assistantMessageRow(overrides: Partial<MessageRow> = {}): MessageRow {
	return {
		conversationId: "conv_01HQ",
		createdAt: new Date("2026-03-28T08:00:01.000Z"),
		id: "msg_answer",
		kind: "error",
		requestId: "req_prev",
		retryable: false,
		role: "assistant",
		structuredPartsJson: [],
		text: "Execution failed.",
		...overrides,
	} as MessageRow;
}

describe("runtime command idempotent replay contract", () => {
	it("rejects finalized dispatch rows that are missing the assistant message", () => {
		expect(() =>
			buildStoredIdempotentRequest({
				assistantMessageRow: null,
				conversation: createConversation(),
				dispatchRow: dispatchRow({ status: "error" }),
			}),
		).toThrow("idempotent replay is missing assistant message for finalized request");
	});

	it("rejects error assistant messages without durable retryable truth", () => {
		expect(() =>
			buildStoredIdempotentRequest({
				assistantMessageRow: assistantMessageRow({ retryable: null }),
				conversation: createConversation(),
				dispatchRow: dispatchRow({ status: "error" }),
			}),
		).toThrow("idempotent replay error message is missing retryable");
	});

	it("rejects dispatch rows that are missing their idempotency fingerprint", () => {
		expect(() =>
			buildStoredIdempotentRequest({
				assistantMessageRow: assistantMessageRow(),
				conversation: createConversation(),
				dispatchRow: dispatchRow({ requestFingerprintSha256: null }),
			}),
		).toThrow("idempotent replay is missing request fingerprint");
	});
});
