import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
	metricRollup,
	projectionOutbox,
	qualityBadcaseProjection,
	requestAuditProjection,
	requestExecution,
	requestObservabilityFact,
	requestProjection,
} from "../../db/schema";
import type {
	ProjectionOutboxEvent,
	RequestExecutionProjectionSource,
	RequestProjectionProjectorStore,
} from "./service";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

function toIsoString(value: Date | null): string | null {
	return value ? value.toISOString() : null;
}

function toProjectionEvent(row: typeof projectionOutbox.$inferSelect): ProjectionOutboxEvent {
	return {
		attemptCount: row.attemptCount,
		availableAt: row.availableAt.toISOString(),
		eventId: row.eventId,
		eventType: row.eventType,
		occurredAt: row.occurredAt.toISOString(),
		processedAt: toIsoString(row.processedAt),
		requestId: row.requestId,
	};
}

function toExecutionProjectionSource(
	row: typeof requestExecution.$inferSelect,
	observability: typeof requestObservabilityFact.$inferSelect | null,
): RequestExecutionProjectionSource {
	return {
		aclAnomalyCode: observability?.aclAnomalyCode ?? null,
		aclDecision: observability?.aclDecision ?? null,
		answerPreview: row.answerPreview ?? null,
		completedAt: toIsoString(row.completedAt),
		conversationId: row.conversationId,
		diagnostics: row.diagnosticsJson ?? null,
		durationMs: row.durationMs ?? null,
		errorCode: row.errorCode ?? null,
		entitlementGroups: row.entitlementGroupsJson ?? [],
		entitlementSnapshotId: row.entitlementSnapshotId ?? null,
		failClosed: observability?.failClosed ?? null,
		citationExpected: observability?.citationExpected ?? null,
		citationMissing: observability?.citationMissing ?? null,
		emptyRecall: observability?.emptyRecall ?? null,
		modelName: observability?.modelName ?? null,
		policyProjectionVersion: observability?.policyProjectionVersion ?? null,
		principalId: row.actorPrincipalId,
		principalLabel: row.principalLabel ?? null,
		principalType: row.principalType,
		questionPreview: row.questionPreview,
		requestId: row.requestId,
		retrievalAttempted: observability?.retrievalAttempted ?? null,
		requestedCapability: row.requestedCapability ?? null,
		requestedScope: row.requestedScopeJson ?? null,
		versionQuery: row.versionQueryJson ?? null,
		resolvedScope: row.resolvedScopeJson ?? null,
		selectedTarget: row.selectedTarget ?? null,
		sourceDocIds: row.sourceDocIdsJson ?? [],
		startedAt: row.startedAt.toISOString(),
		status: row.status as RequestExecutionProjectionSource["status"],
		surface: row.surface,
		traceId: row.traceId,
		visibilityScope: row.visibilityScope ?? null,
		applicabilityScope: row.applicabilityScope ?? null,
	};
}

export function createPgProjectionStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): RequestProjectionProjectorStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async getRequestExecution(requestIdValue) {
			const db = await getDb();
			const executionRows = await db
				.select()
				.from(requestExecution)
				.where(eq(requestExecution.requestId, requestIdValue))
				.limit(1);
			const execution = executionRows[0];
			if (!execution) {
				return null;
			}

			const observabilityRows = await db
				.select()
				.from(requestObservabilityFact)
				.where(eq(requestObservabilityFact.requestId, requestIdValue))
				.limit(1);

			return toExecutionProjectionSource(execution, observabilityRows[0] ?? null);
		},

		async listPendingEvents(limit, now) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(projectionOutbox)
				.where(and(isNull(projectionOutbox.processedAt), lte(projectionOutbox.availableAt, now)))
				.orderBy(asc(projectionOutbox.availableAt), asc(projectionOutbox.occurredAt))
				.limit(limit);

			return rows.map(toProjectionEvent);
		},

		async listPendingEventsForRequest(requestIdValue, now) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(projectionOutbox)
				.where(
					and(
						eq(projectionOutbox.requestId, requestIdValue),
						isNull(projectionOutbox.processedAt),
						lte(projectionOutbox.availableAt, now),
					),
				)
				.orderBy(asc(projectionOutbox.availableAt), asc(projectionOutbox.occurredAt));

			return rows.map(toProjectionEvent);
		},

		async markEventFailed(input) {
			const db = await getDb();
			await db
				.update(projectionOutbox)
				.set({
					availableAt: new Date(input.availableAt),
					attemptCount: input.attemptCount,
					lastError: input.lastError,
					processedAt: input.processedAt ? new Date(input.processedAt) : null,
				})
				.where(eq(projectionOutbox.eventId, input.eventId));
		},

		async markEventProcessed(input) {
			const db = await getDb();
			await db
				.update(projectionOutbox)
				.set({
					attemptCount: sql`${projectionOutbox.attemptCount} + 1`,
					lastError: null,
					processedAt: new Date(input.processedAt),
				})
				.where(eq(projectionOutbox.eventId, input.eventId));
		},

		async markObservabilityProjected(input) {
			const db = await getDb();
			await db
				.update(requestObservabilityFact)
				.set({
					measuredAt: new Date(input.measuredAt),
					projectionLagMs: input.projectionLagMs,
					updatedAt: new Date(input.measuredAt),
				})
				.where(eq(requestObservabilityFact.requestId, input.requestId));
		},

		async replaceQualityRollups(input) {
			const db = await getDb();
			await db.delete(metricRollup).where(eq(metricRollup.requestId, input.requestId));
			if (input.rollups.length === 0) {
				return;
			}

			await db.insert(metricRollup).values(
				input.rollups.map((rollup) => ({
					bucketEnd: new Date(rollup.bucketEnd),
					bucketStart: new Date(rollup.bucketStart),
					collection: rollup.collection,
					domain: rollup.domain,
					granularity: rollup.granularity,
					metricsJson: rollup.metrics,
					modelName: rollup.modelName,
					principalType: rollup.principalType,
					projectedAt: new Date(rollup.projectedAt),
					requestId: rollup.requestId,
					requestedCapability: rollup.requestedCapability,
					rollupId: rollup.rollupId,
					selectedTarget: rollup.selectedTarget,
					surface: rollup.surface,
				})),
			);
		},

		async replaceQualityBadcases(input) {
			const db = await getDb();
			await db
				.delete(qualityBadcaseProjection)
				.where(eq(qualityBadcaseProjection.requestId, input.requestId));
			if (input.badcases.length === 0) {
				return;
			}

			await db.insert(qualityBadcaseProjection).values(
				input.badcases.map((badcase) => ({
					badcaseId: badcase.badcaseId,
					causeClass: badcase.causeClass,
					detectedBy: badcase.detectedBy,
					gradeJson: badcase.grade,
					openedAt: new Date(badcase.openedAt),
					projectedAt: new Date(badcase.projectedAt),
					requestId: badcase.requestId,
					selectedTarget: badcase.selectedTarget,
					status: badcase.status,
					summary: badcase.summary,
					surface: badcase.surface,
					traceId: badcase.traceId,
				})),
			);
		},

		async upsertAuditProjection(projection) {
			const db = await getDb();
			await db
				.insert(requestAuditProjection)
				.values({
					auditEventId: projection.auditEventId,
					diagnosticsJson: projection.diagnostics,
					entitlementSnapshotId: projection.entitlementSnapshotId,
					eventType: projection.eventType,
					occurredAt: new Date(projection.occurredAt),
					policyProjectionVersion: projection.policyProjectionVersion,
					principalType: projection.principalType,
					projectedAt: new Date(projection.projectedAt),
					requestId: projection.requestId,
					requestedCapability: projection.requestedCapability,
					selectedTarget: projection.selectedTarget,
					status: projection.status,
					summary: projection.summary,
					surface: projection.surface,
					terminalCode: projection.terminalCode,
					traceId: projection.traceId,
				})
				.onConflictDoUpdate({
					set: {
						diagnosticsJson: projection.diagnostics,
						entitlementSnapshotId: projection.entitlementSnapshotId,
						eventType: projection.eventType,
						occurredAt: new Date(projection.occurredAt),
						policyProjectionVersion: projection.policyProjectionVersion,
						principalType: projection.principalType,
						projectedAt: new Date(projection.projectedAt),
						requestId: projection.requestId,
						requestedCapability: projection.requestedCapability,
						selectedTarget: projection.selectedTarget,
						status: projection.status,
						summary: projection.summary,
						surface: projection.surface,
						terminalCode: projection.terminalCode,
						traceId: projection.traceId,
					},
					target: requestAuditProjection.auditEventId,
				});
		},

		async upsertProjection(projection) {
			const db = await getDb();
			await db
				.insert(requestProjection)
				.values({
					answerPreview: projection.answerPreview,
					completedAt: projection.completedAt ? new Date(projection.completedAt) : null,
					conversationId: projection.conversationId,
					durationMs: projection.durationMs,
					errorCode: projection.errorCode,
					entitlementGroupsJson: projection.entitlementGroups,
					entitlementSnapshotId: projection.entitlementSnapshotId,
					principalId: projection.principalId,
					principalLabel: projection.principalLabel,
					principalType: projection.principalType,
					projectedAt: new Date(projection.projectedAt),
					questionPreview: projection.questionPreview,
					requestId: projection.requestId,
					requestedCapability: projection.requestedCapability,
					requestedScopeJson: projection.requestedScope,
					versionQueryJson: projection.versionQuery,
					resolvedScopeJson: projection.resolvedScope,
					selectedTarget: projection.selectedTarget,
					diagnosticsJson: projection.diagnostics,
					sourceDocIdsJson: projection.sourceDocIds,
					startedAt: new Date(projection.startedAt),
					status: projection.status,
					surface: projection.surface,
					traceId: projection.traceId,
					visibilityScope: projection.visibilityScope,
					applicabilityScope: projection.applicabilityScope,
				})
				.onConflictDoUpdate({
					set: {
						answerPreview: projection.answerPreview,
						completedAt: projection.completedAt ? new Date(projection.completedAt) : null,
						conversationId: projection.conversationId,
						durationMs: projection.durationMs,
						errorCode: projection.errorCode,
						entitlementGroupsJson: projection.entitlementGroups,
						entitlementSnapshotId: projection.entitlementSnapshotId,
						principalId: projection.principalId,
						principalLabel: projection.principalLabel,
						principalType: projection.principalType,
						projectedAt: new Date(projection.projectedAt),
						questionPreview: projection.questionPreview,
						requestedCapability: projection.requestedCapability,
						requestedScopeJson: projection.requestedScope,
						versionQueryJson: projection.versionQuery,
						resolvedScopeJson: projection.resolvedScope,
						selectedTarget: projection.selectedTarget,
						diagnosticsJson: projection.diagnostics,
						sourceDocIdsJson: projection.sourceDocIds,
						startedAt: new Date(projection.startedAt),
						status: projection.status,
						surface: projection.surface,
						traceId: projection.traceId,
						visibilityScope: projection.visibilityScope,
						applicabilityScope: projection.applicabilityScope,
					},
					target: requestProjection.requestId,
				});
		},
	};
}
