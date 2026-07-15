// @vitest-environment node

import { describe, expect, it } from "vitest";

import { buildAcceptTurnDispatchInsertValues } from "../src/modules/runtime-command/store-mutations";
import type { TurnDispatchWrite } from "../src/modules/runtime-command/store-types";

function turnDispatchWrite(overrides: Partial<TurnDispatchWrite> = {}): TurnDispatchWrite {
	return {
		actorUserId: "user_001",
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
		requestedTool: "knowledge_query",
		resolvedTargets: [],
		requestFingerprintSha256: "f".repeat(64),
		requestId: "req_001",
		runId: "run_001",
		safetyIdentifier: "safety_001",
		selectedTool: null,
		status: "accepted",
		surface: "campus_web",
		traceId: "trace_001",
		turnSequence: 1,
		updatedAt: "2026-06-04T01:02:03.000Z",
		userMessageId: "msg_user_001",
		...overrides,
	};
}

describe("runtime command mutations", () => {
	it("persists the durable run id in chat turn dispatch truth", () => {
		const values = buildAcceptTurnDispatchInsertValues(turnDispatchWrite());

		expect(values).toMatchObject({
			requestId: "req_001",
			resolvedTargetsJson: [],
			runId: "run_001",
			status: "accepted",
			turnSequence: 1,
		});
	});
});
