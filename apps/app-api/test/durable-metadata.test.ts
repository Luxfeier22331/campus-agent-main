import { describe, expect, it } from "vitest";
import type { CapabilityExecutionInput } from "../src/modules/integration";
import { buildCapabilityExecutionRunMetadata } from "../src/modules/runtime-command/service/durable-metadata";

function executionInput(
	overrides: Partial<CapabilityExecutionInput> = {},
): CapabilityExecutionInput {
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
	it("builds capability-neutral metadata for campus services without preselected tool plan", () => {
		const metadata = buildCapabilityExecutionRunMetadata(
			executionInput({ requestedCapability: "campus_services" }),
		);

		const payload = metadata.execution_payload as Record<string, unknown>;

		expect(payload.requested_capability).toBe("campus_services");
		expect(payload.effective_capability).toBe("campus_services");
		expect(payload.lane).toBe("campus_services");
		expect(payload.tenant_id).toBe("tenant-main");
		expect(payload.runtime_decisions).toBeUndefined();
		expect(metadata.handoff).toBeUndefined();
		expect(JSON.stringify(metadata)).not.toContain("retrieval.query");
		expect(JSON.stringify(metadata)).not.toContain("rag_request");
		expect(JSON.stringify(metadata)).not.toContain("allowed_tools");
		expect(JSON.stringify(metadata)).not.toContain("selected_tool");
	});

	it("projects selected notice context as an explicit session reference", () => {
		const metadata = buildCapabilityExecutionRunMetadata(
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
				requestedCapability: "campus_services",
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
