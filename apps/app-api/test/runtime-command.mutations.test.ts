// @vitest-environment node

import { describe, expect, it } from "vitest";

import { buildAcceptTurnDispatchInsertValues } from "../src/modules/runtime-command/store-mutations";
import type { TurnDispatchWrite } from "../src/modules/runtime-command/store-types";

function turnDispatchWrite(overrides: Partial<TurnDispatchWrite> = {}): TurnDispatchWrite {
	return {
		actorUserId: "user_001",
		assistantMessageId: "msg_assistant_001",
		completedAt: null,
		conversationId: "conv_001",
		createdAt: "2026-06-04T01:02:03.000Z",
		errorCode: null,
		idempotencyKey: "idem_001",
		ownerUserId: "principal_001",
		principalSnapshot: {
			actor: {
				departments: [],
				principalId: "principal_001",
				principalType: "student",
				roles: ["student"],
				userId: "user_001",
			},
			authorization: null,
			principal: {
				displayName: "Student",
				principalId: "principal_001",
				type: "student",
			},
		},
		requestFingerprintSha256: "f".repeat(64),
		requestId: "req_001",
		runId: "run_001",
		safetyIdentifier: "safety_001",
		status: "accepted",
		surface: "campus_web",
		traceId: "trace_001",
		turnSequence: 1,
		turnId: "turn_001",
		updatedAt: "2026-06-04T01:02:03.000Z",
		userMessageId: "msg_user_001",
		...overrides,
	};
}

describe("runtime command mutations", () => {
	it("persists both frozen inputs and memory snapshot in the accepted turn insert", () => {
		const values = buildAcceptTurnDispatchInsertValues(
			turnDispatchWrite(),
			{
				appendEnabled: true,
				ownerGeneration: 3,
				ownerSequence: 7,
				recallEnabled: false,
			},
			{
				executionInputJson: '{"request_id":"req_001"}',
				executionInputSha256: "b".repeat(64),
				turnId: "turn_001",
			},
		);

		expect(values).toMatchObject({
			executionInputJson: '{"request_id":"req_001"}',
			executionInputSha256: "b".repeat(64),
			memoryAppendEnabled: true,
			memoryOwnerGeneration: 3,
			memoryOwnerSequence: 7,
			memoryRecallEnabled: false,
			requestId: "req_001",
			runId: "run_001",
			status: "accepted",
			turnId: "turn_001",
			turnSequence: 1,
		});
	});
});
