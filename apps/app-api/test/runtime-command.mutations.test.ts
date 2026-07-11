// @vitest-environment node

import { describe, expect, it } from "vitest";

import { buildAcceptRequestExecutionInsertValues } from "../src/modules/runtime-command/store-mutations";
import type { RequestExecutionWrite } from "../src/modules/runtime-command/store-types";

function requestExecutionWrite(
	overrides: Partial<RequestExecutionWrite> = {},
): RequestExecutionWrite {
	return {
		actorDepartments: [],
		actorPrincipalId: "principal_001",
		actorRoles: ["student"],
		actorUserId: "user_001",
		answerPreview: null,
		applicabilityScope: "undergraduate",
		assistantMessageId: null,
		completedAt: null,
		conversationId: "conv_001",
		createdAt: "2026-06-04T01:02:03.000Z",
		durationMs: null,
		entitlementGroups: ["students"],
		entitlementSnapshotId: "entitlements_001",
		errorCode: null,
		idempotencyKey: "idem_001",
		principalLabel: null,
		principalType: "student",
		questionPreview: "奖学金怎么评？",
		requestedTool: "knowledge_query",
		requestedScope: "student_rules",
		requestFingerprintSha256: "f".repeat(64),
		requestId: "req_001",
		resolvedScope: null,
		runId: "run_001",
		safetyIdentifier: "safety_001",
		selectedTool: null,
		sourceDocIds: [],
		startedAt: "2026-06-04T01:02:03.000Z",
		status: "accepted",
		surface: "campus_web",
		traceId: "trace_001",
		turnSequence: 1,
		updatedAt: "2026-06-04T01:02:03.000Z",
		userMessageId: "msg_user_001",
		versionQuery: null,
		visibilityScope: "main",
		...overrides,
	};
}

describe("runtime command mutations", () => {
	it("persists durable run id in request_execution command truth", () => {
		const values = buildAcceptRequestExecutionInsertValues(requestExecutionWrite());

		expect(values).toMatchObject({
			requestId: "req_001",
			runId: "run_001",
			status: "accepted",
			turnSequence: 1,
		});
	});
});
