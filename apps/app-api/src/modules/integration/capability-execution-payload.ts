import type { ExecutionActorContext } from "../auth";
import { toCapabilityExecutionVersionQuery } from "../version-query";
import type {
	CapabilityExecutionContextProjection,
	CapabilityExecutionInput,
} from "./capability-execution-types";

export function toCapabilityExecutionActor(actor: ExecutionActorContext) {
	return {
		cohort: actor.cohort,
		user_id: actor.userId,
		major: actor.major,
		principal_id: actor.principalId,
		principal_type: actor.principalType,
		program: actor.program,
		roles: actor.roles,
		departments: actor.departments,
	};
}

export function toCapabilityExecutionContext(context: CapabilityExecutionContextProjection) {
	return {
		actor: toCapabilityExecutionActor(context.actor),
		authorization: {
			principal_id: context.authorization.principalId,
			projection_source: context.authorization.projectionSource,
			entitlement_snapshot_id: context.authorization.entitlementSnapshotId,
			entitlement_groups: context.authorization.entitlementGroups,
			visibility_scope: context.authorization.visibilityScope,
			applicability_scope: context.authorization.applicabilityScope,
			ownership_scopes: context.authorization.ownershipScopes,
			approval_state: context.authorization.approvalState,
			retrieval_filter: {
				entitlement_groups: context.authorization.retrievalFilter.entitlementGroups,
				policy_projection_version: context.authorization.retrievalFilter.policyProjectionVersion,
				visibility_level: context.authorization.retrievalFilter.visibilityLevel,
				visibility_scope: context.authorization.retrievalFilter.visibilityScope,
			},
		},
		session: {
			confirmed_slots: context.session.confirmedSlots.map((slot) => ({
				confirmed: slot.confirmed,
				name: slot.name,
				value: slot.value,
			})),
			turn_count: context.session.turnCount,
		},
	};
}

export function toCapabilityExecutionRequestBody(
	payload: CapabilityExecutionInput,
): Record<string, unknown> {
	return {
		context: toCapabilityExecutionContext(payload.context),
		conversation_id: payload.conversationId,
		request_id: payload.requestId,
		...(payload.requestedCapability ? { requested_capability: payload.requestedCapability } : {}),
		...(payload.requestedScope ? { requested_scope: payload.requestedScope } : {}),
		...(payload.safetyIdentifier ? { safety_identifier: payload.safetyIdentifier } : {}),
		...(payload.versionQuery
			? { version_query: toCapabilityExecutionVersionQuery(payload.versionQuery) }
			: {}),
		user_goal: payload.userGoal,
	};
}
