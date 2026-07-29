import type { ExecutionActorContext } from "../auth";
import type { ToolExecutionContextProjection } from "./tool-execution-types";

export function toToolExecutionActor(actor: ExecutionActorContext) {
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

export function toToolExecutionContext(context: ToolExecutionContextProjection) {
	return {
		actor: toToolExecutionActor(context.actor),
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
		...(context.conversation
			? {
					conversation: {
						schema_version: context.conversation.schemaVersion,
						conversation_id: context.conversation.conversationId,
						user_message_id: context.conversation.userMessageId,
						parent_message_id: context.conversation.parentMessageId,
						current_user_message: {
							role: context.conversation.currentUserMessage.role,
							content: context.conversation.currentUserMessage.content,
							created_at: context.conversation.currentUserMessage.createdAt,
						},
						recent_turns: context.conversation.recentTurns.map((turn) => ({
							role: turn.role,
							message_id: turn.messageId,
							content: turn.content,
							created_at: turn.createdAt,
						})),
						session_state: {
							confirmed_slots: context.conversation.sessionState.confirmedSlots.map((slot) => ({
								confirmed: slot.confirmed,
								name: slot.name,
								value: slot.value,
							})),
							selected_notice_ref: context.conversation.sessionState.selectedNoticeRef
								? {
										notice_id: context.conversation.sessionState.selectedNoticeRef.noticeId,
										source_family:
											context.conversation.sessionState.selectedNoticeRef.sourceFamily ?? "",
										target_surface:
											context.conversation.sessionState.selectedNoticeRef.targetSurface ?? "",
										title: context.conversation.sessionState.selectedNoticeRef.title ?? "",
									}
								: null,
							turn_count: context.conversation.sessionState.turnCount,
						},
					},
				}
			: {}),
		...(context.memory
			? {
					memory: {
						append_enabled: context.memory.appendEnabled,
						owner_generation: context.memory.ownerGeneration,
						owner_sequence: context.memory.ownerSequence,
						recall_enabled: context.memory.recallEnabled,
					},
				}
			: {}),
		session: {
			confirmed_slots: context.session.confirmedSlots.map((slot) => ({
				confirmed: slot.confirmed,
				name: slot.name,
				value: slot.value,
			})),
			selected_notice_ref: context.session.selectedNoticeRef
				? {
						notice_id: context.session.selectedNoticeRef.noticeId,
						source_family: context.session.selectedNoticeRef.sourceFamily ?? "",
						target_surface: context.session.selectedNoticeRef.targetSurface ?? "",
						title: context.session.selectedNoticeRef.title ?? "",
					}
				: null,
			turn_count: context.session.turnCount,
		},
	};
}
