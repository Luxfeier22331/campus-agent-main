import { eq } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
	evalCoverageSnapshot,
	projectionOutbox,
	qualityGradeProjection,
	requestObservabilityFact,
	traceBacklinkProjection,
} from "../../db/schema";
import type { EvalCoverageProjectionWrite } from "../operator-eval-coverage";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface StoredRequestObservabilitySeed {
	requestId: string;
	traceId: string;
	surface: string;
	requestStartedAt: string;
	requestedScopeSummary: string | null;
	selectedTarget: string | null;
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
	selectedTarget: string | null;
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

export interface ExecutionAuditEventWrite {
	eventId: string;
	requestId: string;
	eventType: string;
	payload: Record<string, unknown>;
	occurredAt: string;
	availableAt: string;
}

export interface OperatorObservabilityCommandStore {
	getRequestObservabilitySeed(requestId: string): Promise<StoredRequestObservabilitySeed | null>;
	enqueueExecutionAuditEvents(input: { events: ExecutionAuditEventWrite[] }): Promise<void>;
	upsertEvalCoverageSnapshot(input: { snapshot: EvalCoverageProjectionWrite }): Promise<void>;
	upsertQualityGrades(input: { grades: QualityGradeProjectionWrite[] }): Promise<void>;
	upsertTraceBacklinks(input: { backlinks: TraceBacklinkProjectionWrite[] }): Promise<void>;
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
		selectedTarget: row.selectedTarget ?? null,
		surface: row.surface,
		traceId: row.traceId,
	};
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
							selectedTarget: grade.selectedTarget,
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
								selectedTarget: grade.selectedTarget,
								surface: grade.surface,
								traceId: grade.traceId,
								verdict: grade.verdict,
							},
							target: qualityGradeProjection.gradeId,
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
	};
}
