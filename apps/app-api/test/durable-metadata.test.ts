import { describe, expect, it } from "vitest";
import type { ToolExecutionInput } from "../src/modules/integration";
import { buildToolExecutionRunMetadata } from "../src/modules/runtime-command/service/durable-metadata";

function executionInput(overrides: Partial<ToolExecutionInput> = {}): ToolExecutionInput {
	return {
		context: {
			actor: {
				principalId: "user-001",
				principalType: "campus_member",
				userId: "user-001",
				roles: [],
				departments: [],
				cohort: undefined,
				major: undefined,
				program: undefined,
			},
			authorization: {
				applicabilityScope: "campus",
				approvalState: "approved",
				entitlementGroups: [],
				entitlementSnapshotId: "entitlement-001",
				ownershipScopes: [],
				principalId: "user-001",
				projectionSource: "campus_identity",
				retrievalFilter: {
					entitlementGroups: [],
					policyProjectionVersion: "phase1-authorization-projection-v1",
					visibilityLevel: "public",
					visibilityScope: "campus",
				},
				visibilityScope: "campus",
			},
			session: {
				confirmedSlots: [],
				turnCount: 1,
			},
		},
		conversationId: "conv-001",
		requestId: "req-001",
		traceId: "trace-001",
		userGoal: "校车今天运行吗？",
		...overrides,
	};
}

describe("durable run metadata", () => {
	it("forwards an explicit requested tool without local preplanning", () => {
		const metadata = buildToolExecutionRunMetadata(
			executionInput({ requestedTool: "transport_schedule_lookup" }),
		);

		const payload = metadata.execution_payload as Record<string, unknown>;

		expect(payload.requested_tool).toBe("transport_schedule_lookup");
		expect(payload.tenant_id).toBe("tenant-main");
		expect(Object.keys(metadata)).toEqual(["execution_payload"]);
		expect(Object.keys(payload).sort()).toEqual([
			"context",
			"conversation_id",
			"execution_contract_version",
			"request_id",
			"requested_tool",
			"response_contract",
			"safety_identifier",
			"tenant_id",
			"trace",
			"user_goal",
			"version_query",
		]);
	});

	it("serializes a trusted knowledge eval hint with its scope", () => {
		const metadata = buildToolExecutionRunMetadata(
			executionInput({ requestedScope: "student_rules", requestedTool: "knowledge_query" }),
		);

		const payload = metadata.execution_payload as Record<string, unknown>;
		expect(payload.requested_tool).toBe("knowledge_query");
		expect(payload.scope).toBe("student_rules");
	});

	it("does not apply tool admission while serializing metadata", () => {
		for (const requestedTool of ["unpublished_tool", "unsupported_tool"]) {
			const metadata = buildToolExecutionRunMetadata(executionInput({ requestedTool }));
			const payload = metadata.execution_payload as Record<string, unknown>;
			expect(payload.requested_tool).toBe(requestedTool);
		}
	});

	it("projects selected notice context as an explicit session reference", () => {
		const metadata = buildToolExecutionRunMetadata(
			executionInput({
				context: {
					...executionInput().context,
					session: {
						confirmedSlots: [],
						selectedNoticeRef: {
							noticeId: "notice:transport:353903",
							sourceFamily: "internal_notice_restricted",
							targetSurface: "campus_services/service_status_candidate",
							title: "关于通勤班车丰台校区乘车点调整的通知",
						},
						turnCount: 3,
					},
				},
				requestedTool: "transport_schedule_lookup",
			}),
		);

		const payload = metadata.execution_payload as Record<string, unknown>;
		expect(payload.context).toMatchObject({
			session: {
				selected_notice_ref: {
					notice_id: "notice:transport:353903",
					source_family: "internal_notice_restricted",
					target_surface: "campus_services/service_status_candidate",
					title: "关于通勤班车丰台校区乘车点调整的通知",
				},
				turn_count: 3,
			},
		});
	});
});
