import { eq } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
	evalCoverageSnapshot,
	evalDiagnosticBadcaseProjection,
	langfuseEvalBacklinkProjection,
	projectionOutbox,
	qualityGradeProjection,
	requestObservabilityFact,
	temporalTaskQueueCurrent,
	temporalTaskQueueSnapshot,
	traceBacklinkProjection,
	workerAutoscalerActuation,
	workerAutoscalerDecision,
	workerAutoscalerDecisionCurrent,
} from "../../db/schema";
import type { EvalCoverageProjectionWrite } from "../operator-eval-coverage";
import type { EvalDiagnosticBadcaseProjectionWrite } from "../operator-eval-diagnostic-badcases";
import type {
	TemporalTaskQueueSnapshotWrite,
	WorkerAutoscalerActuationWrite,
	WorkerAutoscalerDecisionWrite,
} from "../operator-runtime-observability";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface StoredRequestObservabilitySeed {
	requestId: string;
	traceId: string;
	surface: string;
	requestStartedAt: string;
	requestedScopeSummary: string | null;
	selectedCapability: string | null;
	requestedCapability: string | null;
	principalType: string;
	collection: string | null;
	modelName: string | null;
}

export interface QualityGradeProjectionWrite {
	gradeId: string;
	requestId: string;
	traceId: string;
	surface: string;
	requestStartedAt: string;
	selectedCapability: string | null;
	requestedCapability: string | null;
	principalType: string;
	collection: string | null;
	modelName: string | null;
	gradeSource: string;
	gradeDomain: "grounding" | "citation" | "policy" | "intent";
	verdict: "pass" | "fail" | "needs_review";
	scoreMilli: number | null;
	graderVersion: string;
	rationaleSummary: string | null;
	requestedScopeSummary: string | null;
	sampledAt: string;
	projectedAt: string;
}

export interface TraceBacklinkProjectionWrite {
	requestId: string;
	traceId: string;
	traceLink: string | null;
	issueLink: string | null;
	issueFingerprint: string | null;
	projectedAt: string;
}

export interface LangfuseEvalBacklinkProjectionWrite {
	evalBacklinkId: string;
	traceId: string;
	evalRunId: string;
	scoreName: string;
	scoreValue: string | number | boolean;
	release: string;
	environment: string;
	langfuseUrl: string;
	projectedAt: string;
}

export interface ExecutionAuditEventWrite {
	eventId: string;
	requestId: string;
	eventType: string;
	payload: Record<string, unknown>;
	occurredAt: string;
	availableAt: string;
}

export interface TemporalTaskQueueRuntimeProjectionWrite {
	actuations: WorkerAutoscalerActuationWrite[];
	decisions: WorkerAutoscalerDecisionWrite[];
	persistHistory?: boolean;
	snapshots: TemporalTaskQueueSnapshotWrite[];
}

export interface OperatorObservabilityCommandStore {
	getRequestObservabilitySeed(requestId: string): Promise<StoredRequestObservabilitySeed | null>;
	enqueueExecutionAuditEvents(input: { events: ExecutionAuditEventWrite[] }): Promise<void>;
	upsertEvalCoverageSnapshot(input: { snapshot: EvalCoverageProjectionWrite }): Promise<void>;
	upsertEvalDiagnosticBadcases(input: {
		badcases: EvalDiagnosticBadcaseProjectionWrite[];
		snapshotId: string;
	}): Promise<void>;
	upsertQualityGrades(input: { grades: QualityGradeProjectionWrite[] }): Promise<void>;
	upsertTemporalTaskQueueRuntime(input: TemporalTaskQueueRuntimeProjectionWrite): Promise<void>;
	upsertTraceBacklinks(input: { backlinks: TraceBacklinkProjectionWrite[] }): Promise<void>;
	upsertLangfuseEvalBacklinks?(input: {
		backlinks: LangfuseEvalBacklinkProjectionWrite[];
	}): Promise<void>;
}

function toStoredRequestObservabilitySeed(
	row: typeof requestObservabilityFact.$inferSelect,
): StoredRequestObservabilitySeed {
	return {
		collection: row.collection ?? null,
		modelName: row.modelName ?? null,
		principalType: row.principalType,
		requestId: row.requestId,
		requestedCapability: row.requestedCapability ?? null,
		requestedScopeSummary: row.requestedScopeSummary ?? null,
		requestStartedAt: row.startedAt.toISOString(),
		selectedCapability: row.selectedCapability ?? null,
		surface: row.surface,
		traceId: row.traceId,
	};
}

function buildTemporalTaskQueueCurrentId(snapshot: TemporalTaskQueueSnapshotWrite): string {
	return `${snapshot.namespace}:${snapshot.taskQueueKind}:${snapshot.taskQueue}`;
}

function buildWorkerAutoscalerDecisionCurrentId(decision: WorkerAutoscalerDecisionWrite): string {
	return decision.targetService;
}

export function createPgOperatorObservabilityCommandStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): OperatorObservabilityCommandStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async enqueueExecutionAuditEvents(input) {
			if (input.events.length === 0) {
				return;
			}

			const db = await getDb();
			await db.transaction(async (tx) => {
				for (const event of input.events) {
					await tx
						.insert(projectionOutbox)
						.values({
							attemptCount: 0,
							availableAt: new Date(event.availableAt),
							eventId: event.eventId,
							eventType: event.eventType,
							lastError: null,
							occurredAt: new Date(event.occurredAt),
							payloadJson: event.payload,
							processedAt: null,
							requestId: event.requestId,
						})
						.onConflictDoNothing();
				}
			});
		},

		async getRequestObservabilitySeed(requestId) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(requestObservabilityFact)
				.where(eq(requestObservabilityFact.requestId, requestId))
				.limit(1);

			return rows[0] ? toStoredRequestObservabilitySeed(rows[0]) : null;
		},

		async upsertEvalCoverageSnapshot(input) {
			const db = await getDb();
			await db
				.insert(evalCoverageSnapshot)
				.values({
					createdAt: new Date(),
					generatedAt: new Date(input.snapshot.generatedAt),
					payloadJson: input.snapshot.payload,
					schemaVersion: input.snapshot.schemaVersion,
					snapshotId: input.snapshot.snapshotId,
					sourceGitHead: input.snapshot.sourceGitHead,
				})
				.onConflictDoUpdate({
					set: {
						generatedAt: new Date(input.snapshot.generatedAt),
						payloadJson: input.snapshot.payload,
						schemaVersion: input.snapshot.schemaVersion,
						sourceGitHead: input.snapshot.sourceGitHead,
					},
					target: evalCoverageSnapshot.snapshotId,
				});
		},

		async upsertEvalDiagnosticBadcases(input) {
			const db = await getDb();
			await db.transaction(async (tx) => {
				await tx
					.delete(evalDiagnosticBadcaseProjection)
					.where(eq(evalDiagnosticBadcaseProjection.snapshotId, input.snapshotId));
				if (input.badcases.length === 0) {
					return;
				}
				for (const badcase of input.badcases) {
					await tx.insert(evalDiagnosticBadcaseProjection).values({
						answerShape: badcase.answerShape,
						badcaseId: badcase.badcaseId,
						caseId: badcase.caseId,
						causeClass: badcase.causeClass,
						evalRunId: badcase.evalRunId,
						expectedDocIdsJson: badcase.expectedDocIds,
						failureStage: badcase.failureStage,
						generatedAt: new Date(badcase.generatedAt),
						metricFailureReason: badcase.metricFailureReason,
						metricName: badcase.metricName,
						presentationKind: badcase.presentationKind,
						projectedAt: new Date(badcase.projectedAt),
						queryPreview: badcase.queryPreview,
						retrievedContextIdsJson: badcase.retrievedContextIds,
						retrievedDocIdsJson: badcase.retrievedDocIds,
						scoreMilli: badcase.scoreMilli,
						snapshotId: badcase.snapshotId,
						sourceGitHead: badcase.sourceGitHead,
						sourceReportSchema: badcase.sourceReportSchema,
						supportingChunkIdsJson: badcase.supportingChunkIds,
						supportingDocIdsJson: badcase.supportingDocIds,
						surfaceKey: badcase.surfaceKey,
						thresholdMilli: badcase.thresholdMilli,
						trajectoryAttributionJson: badcase.trajectoryAttribution,
					});
				}
			});
		},

		async upsertQualityGrades(input) {
			if (input.grades.length === 0) {
				return;
			}

			const db = await getDb();
			await db.transaction(async (tx) => {
				for (const grade of input.grades) {
					await tx
						.insert(qualityGradeProjection)
						.values({
							collection: grade.collection,
							gradeDomain: grade.gradeDomain,
							gradeId: grade.gradeId,
							gradeSource: grade.gradeSource,
							graderVersion: grade.graderVersion,
							modelName: grade.modelName,
							principalType: grade.principalType,
							projectedAt: new Date(grade.projectedAt),
							rationaleSummary: grade.rationaleSummary,
							requestId: grade.requestId,
							requestStartedAt: new Date(grade.requestStartedAt),
							requestedCapability: grade.requestedCapability,
							sampledAt: new Date(grade.sampledAt),
							scoreMilli: grade.scoreMilli,
							selectedCapability: grade.selectedCapability,
							surface: grade.surface,
							traceId: grade.traceId,
							verdict: grade.verdict,
						})
						.onConflictDoUpdate({
							set: {
								collection: grade.collection,
								gradeDomain: grade.gradeDomain,
								gradeSource: grade.gradeSource,
								graderVersion: grade.graderVersion,
								modelName: grade.modelName,
								principalType: grade.principalType,
								projectedAt: new Date(grade.projectedAt),
								rationaleSummary: grade.rationaleSummary,
								requestId: grade.requestId,
								requestStartedAt: new Date(grade.requestStartedAt),
								requestedCapability: grade.requestedCapability,
								sampledAt: new Date(grade.sampledAt),
								scoreMilli: grade.scoreMilli,
								selectedCapability: grade.selectedCapability,
								surface: grade.surface,
								traceId: grade.traceId,
								verdict: grade.verdict,
							},
							target: qualityGradeProjection.gradeId,
						});
				}
			});
		},

		async upsertTemporalTaskQueueRuntime(input) {
			if (
				input.snapshots.length === 0 &&
				input.decisions.length === 0 &&
				input.actuations.length === 0
			) {
				return;
			}

			const db = await getDb();
			await db.transaction(async (tx) => {
				for (const snapshot of input.snapshots) {
					await tx
						.insert(temporalTaskQueueCurrent)
						.values({
							backlogJson: snapshot.backlog,
							currentId: buildTemporalTaskQueueCurrentId(snapshot),
							namespace: snapshot.namespace,
							oldestTaskAgeJson: snapshot.oldestTaskAge,
							pollerCount: snapshot.pollerCount,
							pollerIdentitiesJson: snapshot.pollerIdentities,
							projectedAt: new Date(snapshot.projectedAt),
							sampledAt: new Date(snapshot.sampledAt),
							scheduleToStartLatencyJson: snapshot.scheduleToStartLatency,
							snapshotId: snapshot.snapshotId,
							source: snapshot.source,
							taskQueue: snapshot.taskQueue,
							taskQueueKind: snapshot.taskQueueKind,
						})
						.onConflictDoUpdate({
							set: {
								backlogJson: snapshot.backlog,
								namespace: snapshot.namespace,
								oldestTaskAgeJson: snapshot.oldestTaskAge,
								pollerCount: snapshot.pollerCount,
								pollerIdentitiesJson: snapshot.pollerIdentities,
								projectedAt: new Date(snapshot.projectedAt),
								sampledAt: new Date(snapshot.sampledAt),
								scheduleToStartLatencyJson: snapshot.scheduleToStartLatency,
								source: snapshot.source,
								taskQueue: snapshot.taskQueue,
								taskQueueKind: snapshot.taskQueueKind,
							},
							target: temporalTaskQueueCurrent.currentId,
						});
					if (input.persistHistory !== true) {
						continue;
					}
					await tx
						.insert(temporalTaskQueueSnapshot)
						.values({
							backlogJson: snapshot.backlog,
							namespace: snapshot.namespace,
							oldestTaskAgeJson: snapshot.oldestTaskAge,
							pollerCount: snapshot.pollerCount,
							pollerIdentitiesJson: snapshot.pollerIdentities,
							projectedAt: new Date(snapshot.projectedAt),
							sampledAt: new Date(snapshot.sampledAt),
							scheduleToStartLatencyJson: snapshot.scheduleToStartLatency,
							snapshotId: snapshot.snapshotId,
							source: snapshot.source,
							taskQueue: snapshot.taskQueue,
							taskQueueKind: snapshot.taskQueueKind,
						})
						.onConflictDoUpdate({
							set: {
								backlogJson: snapshot.backlog,
								namespace: snapshot.namespace,
								oldestTaskAgeJson: snapshot.oldestTaskAge,
								pollerCount: snapshot.pollerCount,
								pollerIdentitiesJson: snapshot.pollerIdentities,
								projectedAt: new Date(snapshot.projectedAt),
								sampledAt: new Date(snapshot.sampledAt),
								scheduleToStartLatencyJson: snapshot.scheduleToStartLatency,
								source: snapshot.source,
								taskQueue: snapshot.taskQueue,
								taskQueueKind: snapshot.taskQueueKind,
							},
							target: temporalTaskQueueSnapshot.snapshotId,
						});
				}

				for (const decision of input.decisions) {
					await tx
						.insert(workerAutoscalerDecisionCurrent)
						.values({
							budgetState: decision.budgetState,
							currentId: buildWorkerAutoscalerDecisionCurrentId(decision),
							currentReplicas: decision.currentReplicas,
							decidedAt: new Date(decision.decidedAt),
							decision: decision.decision,
							decisionId: decision.decisionId,
							desiredReplicas: decision.desiredReplicas,
							evidenceJson: decision.evidence,
							projectedAt: new Date(decision.projectedAt),
							reason: decision.reason,
							sourceSnapshotId: decision.sourceSnapshotId,
							targetService: decision.targetService,
							taskQueue: decision.taskQueue,
							taskQueueKind: decision.taskQueueKind,
						})
						.onConflictDoUpdate({
							set: {
								budgetState: decision.budgetState,
								currentReplicas: decision.currentReplicas,
								decidedAt: new Date(decision.decidedAt),
								decision: decision.decision,
								desiredReplicas: decision.desiredReplicas,
								evidenceJson: decision.evidence,
								projectedAt: new Date(decision.projectedAt),
								reason: decision.reason,
								sourceSnapshotId: decision.sourceSnapshotId,
								targetService: decision.targetService,
								taskQueue: decision.taskQueue,
								taskQueueKind: decision.taskQueueKind,
							},
							target: workerAutoscalerDecisionCurrent.currentId,
						});
					if (input.persistHistory !== true) {
						continue;
					}
					await tx
						.insert(workerAutoscalerDecision)
						.values({
							budgetState: decision.budgetState,
							currentReplicas: decision.currentReplicas,
							decidedAt: new Date(decision.decidedAt),
							decision: decision.decision,
							decisionId: decision.decisionId,
							desiredReplicas: decision.desiredReplicas,
							evidenceJson: decision.evidence,
							projectedAt: new Date(decision.projectedAt),
							reason: decision.reason,
							sourceSnapshotId: decision.sourceSnapshotId,
							targetService: decision.targetService,
							taskQueue: decision.taskQueue,
							taskQueueKind: decision.taskQueueKind,
						})
						.onConflictDoUpdate({
							set: {
								budgetState: decision.budgetState,
								currentReplicas: decision.currentReplicas,
								decidedAt: new Date(decision.decidedAt),
								decision: decision.decision,
								desiredReplicas: decision.desiredReplicas,
								evidenceJson: decision.evidence,
								projectedAt: new Date(decision.projectedAt),
								reason: decision.reason,
								sourceSnapshotId: decision.sourceSnapshotId,
								targetService: decision.targetService,
								taskQueue: decision.taskQueue,
								taskQueueKind: decision.taskQueueKind,
							},
							target: workerAutoscalerDecision.decisionId,
						});
				}

				for (const actuation of input.actuations) {
					await tx
						.insert(workerAutoscalerActuation)
						.values({
							actedAt: new Date(actuation.actedAt),
							action: actuation.action,
							actuationId: actuation.actuationId,
							actuatorKind: actuation.actuatorKind,
							decisionId: actuation.decisionId,
							errorCode: actuation.errorCode,
							fromReplicas: actuation.fromReplicas,
							projectedAt: new Date(actuation.projectedAt),
							status: actuation.status,
							targetService: actuation.targetService,
							toReplicas: actuation.toReplicas,
						})
						.onConflictDoUpdate({
							set: {
								actedAt: new Date(actuation.actedAt),
								action: actuation.action,
								actuatorKind: actuation.actuatorKind,
								decisionId: actuation.decisionId,
								errorCode: actuation.errorCode,
								fromReplicas: actuation.fromReplicas,
								projectedAt: new Date(actuation.projectedAt),
								status: actuation.status,
								targetService: actuation.targetService,
								toReplicas: actuation.toReplicas,
							},
							target: workerAutoscalerActuation.actuationId,
						});
				}
			});
		},

		async upsertTraceBacklinks(input) {
			if (input.backlinks.length === 0) {
				return;
			}

			const db = await getDb();
			await db.transaction(async (tx) => {
				for (const backlink of input.backlinks) {
					await tx
						.insert(traceBacklinkProjection)
						.values({
							issueFingerprint: backlink.issueFingerprint,
							issueLink: backlink.issueLink,
							projectedAt: new Date(backlink.projectedAt),
							requestId: backlink.requestId,
							traceId: backlink.traceId,
							traceLink: backlink.traceLink,
						})
						.onConflictDoUpdate({
							set: {
								issueFingerprint: backlink.issueFingerprint,
								issueLink: backlink.issueLink,
								projectedAt: new Date(backlink.projectedAt),
								traceId: backlink.traceId,
								traceLink: backlink.traceLink,
							},
							target: traceBacklinkProjection.requestId,
						});
				}
			});
		},

		async upsertLangfuseEvalBacklinks(input) {
			if (input.backlinks.length === 0) {
				return;
			}

			const db = await getDb();
			await db.transaction(async (tx) => {
				for (const backlink of input.backlinks) {
					await tx
						.insert(langfuseEvalBacklinkProjection)
						.values({
							environment: backlink.environment,
							evalBacklinkId: backlink.evalBacklinkId,
							evalRunId: backlink.evalRunId,
							langfuseUrl: backlink.langfuseUrl,
							projectedAt: new Date(backlink.projectedAt),
							release: backlink.release,
							scoreName: backlink.scoreName,
							scoreValueJson: backlink.scoreValue,
							traceId: backlink.traceId,
						})
						.onConflictDoUpdate({
							set: {
								environment: backlink.environment,
								evalRunId: backlink.evalRunId,
								langfuseUrl: backlink.langfuseUrl,
								projectedAt: new Date(backlink.projectedAt),
								release: backlink.release,
								scoreName: backlink.scoreName,
								scoreValueJson: backlink.scoreValue,
								traceId: backlink.traceId,
							},
							target: langfuseEvalBacklinkProjection.evalBacklinkId,
						});
				}
			});
		},
	};
}
