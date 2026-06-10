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
	it("builds capability-neutral metadata for campus services without RAG handoff", () => {
		const metadata = buildCapabilityExecutionRunMetadata(
			executionInput({ requestedCapability: "campus_services" }),
		);

		const payload = metadata.execution_payload as Record<string, unknown>;
		const decisions = payload.runtime_decisions as Record<string, unknown>;
		const summary = decisions.runtime_decision_summary as Record<string, unknown>;
		const plan = decisions.workflow_plan as Record<string, unknown>;
		const handoff = metadata.handoff as Record<string, unknown>;

		expect(payload.requested_capability).toBe("campus_services");
		expect(payload.effective_capability).toBe("campus_services");
		expect(payload.lane).toBe("campus_services");
		expect(handoff.capability).toBe("campus_services");
		expect(handoff.payload_kind).toBe("capability_request");
		expect(summary.selected_capability).toBe("campus_services");
		expect(summary.selected_tool).toBeNull();
		expect(plan.workflow_mode).toBe("capability_dispatch");
		expect(JSON.stringify(metadata)).not.toContain("retrieval.query");
		expect(JSON.stringify(metadata)).not.toContain("rag_request");
	});
});
