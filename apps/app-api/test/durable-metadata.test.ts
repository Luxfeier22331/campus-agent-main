import { describe, expect, it } from "vitest";
import type { ToolExecutionInput } from "../src/modules/integration";
import {
	freezeToolExecutionRunInput,
	MAX_EXECUTION_INPUT_BYTES,
	sha256Text,
} from "../src/modules/runtime-command/service/durable-metadata";

function executionInput(overrides: Partial<ToolExecutionInput> = {}): ToolExecutionInput {
	return {
		context: {
			actor: {
				principalId: "user-001",
				principalType: "campus_member",
				userId: "user-001",
				roles: [],
				departments: [],
			},
			authorization: {
				applicabilityScope: "campus",
				approvalState: "approved",
				entitlementGroups: [],
				entitlementSnapshotId: "entitlement-001",
				ownershipScopes: [],
				principalId: "user-001",
				projectionSource: "campus_identity",
				visibilityScope: "campus",
			},
			session: {
				confirmedSlots: [],
				turnCount: 1,
			},
		},
		conversationId: "conv-001",
		requestId: "req-001",
		userGoal: "你记得我的回答偏好吗？",
		...overrides,
	};
}

describe("durable run metadata", () => {
	it("freezes the user goal without local tool routing hints", () => {
		const frozen = freezeToolExecutionRunInput(executionInput(), "req-001");

		const payload = JSON.parse(frozen.executionInputJson) as Record<string, unknown>;

		expect(payload).not.toHaveProperty("requested_tool");
		expect(payload.tenant_id).toBe("tenant-main");
		expect(frozen.executionInputSha256).toBe(sha256Text(frozen.executionInputJson));
		expect(frozen.metadata).toEqual({
			execution_contract_version: "tool_execution_v7",
			execution_input_ref: "app-api://execution-inputs/req-001",
			execution_input_sha256: frozen.executionInputSha256,
		});
		expect(Object.keys(payload).sort()).toEqual([
			"context",
			"conversation_id",
			"execution_contract_version",
			"request_id",
			"response_contract",
			"safety_identifier",
			"tenant_id",
			"user_goal",
		]);
	});

	it("projects only confirmed session slots and turn count", () => {
		const frozen = freezeToolExecutionRunInput(
			executionInput({
				context: {
					...executionInput().context,
					session: {
						confirmedSlots: [{ confirmed: true, name: "campus", value: "丰台校区" }],
						turnCount: 3,
					},
				},
			}),
			"req-001",
		);

		const payload = JSON.parse(frozen.executionInputJson) as Record<string, unknown>;
		expect(payload.context).toMatchObject({
			session: {
				confirmed_slots: [{ confirmed: true, name: "campus", value: "丰台校区" }],
				turn_count: 3,
			},
		});
	});

	it("rejects execution input larger than one MiB before admission is frozen", () => {
		expect(() =>
			freezeToolExecutionRunInput(
				executionInput({ userGoal: "x".repeat(MAX_EXECUTION_INPUT_BYTES) }),
				"req-oversized",
			),
		).toThrow("exceeds the 1048576-byte limit");
	});
});
