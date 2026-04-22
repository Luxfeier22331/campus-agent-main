import { and, desc, eq, ilike, lt, or } from "drizzle-orm";

import {
	qualityGradeProjection,
	requestAuditProjection,
	requestObservabilityFact,
	requestProjection,
	traceBacklinkProjection,
} from "../../../db/schema";
import type {
	NormalizedOperatorAuditListFilters,
	NormalizedOperatorRequestListFilters,
	OperatorAuditEventDetail,
	OperatorAuditListResult,
	OperatorQueryListResult,
	OperatorRequestObservabilityRecord,
} from "../service";
import {
	decodeAuditCursor,
	decodeRequestCursor,
	encodeAuditCursor,
	encodeRequestCursor,
} from "./cursors";
import type { OperatorQueryRuntime } from "./runtime";
import {
	buildGradeBucketMap,
	escapeLikePattern,
	toAuditListItem,
	toIsoString,
	toLinks,
	toRequestProjectionRecord,
} from "./shared";

export function createRequestStoreHandlers(runtime: OperatorQueryRuntime) {
	return {
		async getById(requestId: string) {
			const db = await runtime.getDb();
			const rows = await db
				.select()
				.from(requestProjection)
				.where(eq(requestProjection.requestId, requestId))
				.limit(1);

			return rows[0] ? toRequestProjectionRecord(rows[0]) : null;
		},

		async getAuditById(auditEventId: string) {
			const db = await runtime.getDb();
			const rows = await db
				.select()
				.from(requestAuditProjection)
				.where(eq(requestAuditProjection.auditEventId, auditEventId))
				.limit(1);
			const row = rows[0];
			if (!row) {
				return null;
			}

			const backlinkRows = await db
				.select()
				.from(traceBacklinkProjection)
				.where(eq(traceBacklinkProjection.requestId, row.requestId))
				.limit(1);
			const backlink = backlinkRows[0] ?? null;

			return {
				event: {
					auditEventId: row.auditEventId,
					diagnostics: row.diagnosticsJson,
					entitlementSnapshotId: row.entitlementSnapshotId ?? null,
					eventType: row.eventType,
					occurredAt: row.occurredAt.toISOString(),
					policyProjectionVersion: row.policyProjectionVersion ?? null,
					principalType: row.principalType,
					requestId: row.requestId,
					requestedCapability: row.requestedCapability ?? null,
					selectedTarget: row.selectedTarget ?? null,
					status: row.status,
					summary: row.summary,
					surface: row.surface,
					terminalCode: row.terminalCode ?? null,
					traceId: row.traceId,
				},
				links: toLinks(backlink),
			} satisfies OperatorAuditEventDetail;
		},

		async getObservabilityById(requestId: string) {
			const db = await runtime.getDb();
			const projectionRows = await db
				.select()
				.from(requestProjection)
				.where(eq(requestProjection.requestId, requestId))
				.limit(1);
			const projection = projectionRows[0];
			if (!projection) {
				return null;
			}

			const factRows = await db
				.select()
				.from(requestObservabilityFact)
				.where(eq(requestObservabilityFact.requestId, requestId))
				.limit(1);
			const fact = factRows[0] ?? null;
			const auditRows = await db
				.select()
				.from(requestAuditProjection)
				.where(eq(requestAuditProjection.requestId, requestId))
				.orderBy(
					desc(requestAuditProjection.occurredAt),
					desc(requestAuditProjection.auditEventId),
				);
			const backlinkRows = await db
				.select()
				.from(traceBacklinkProjection)
				.where(eq(traceBacklinkProjection.requestId, requestId))
				.limit(1);
			const backlink = backlinkRows[0] ?? null;
			const retrievedSources = fact?.retrievedSourcesJson ?? [];
			const supportingSources = fact?.supportingSourcesJson ?? [];
			const retrievalAttempted = fact?.retrievalAttempted ?? null;
			const retrievedSourceCount =
				fact?.retrievedSourceCount ??
				(retrievalAttempted === true || retrievedSources.length > 0
					? retrievedSources.length
					: null);

			return {
				auditSummary: {
					auditEventCount: auditRows.length,
					latestTerminalCode:
						auditRows.find((row) => row.terminalCode)?.terminalCode ?? projection.status,
				},
				links: toLinks(backlink),
				observability: {
					aclAnomalyCode: fact?.aclAnomalyCode ?? null,
					aclDecision: fact?.aclDecision ?? null,
					cachedInputTokens: fact?.cachedInputTokens ?? null,
					candidateCount: fact?.candidateCount ?? null,
					claimSupportSummary: fact?.claimSupportSummaryJson ?? null,
					remoteContentSuspicionSummary: fact?.remoteContentSuspicionSummaryJson ?? null,
					sourceTrustSummary: fact?.sourceTrustSummaryJson ?? null,
					citationCount: fact?.citationCount ?? supportingSources.length,
					citationExpected: fact?.citationExpected ?? null,
					citationMissing: fact?.citationMissing ?? null,
					durationMs: fact?.durationMs ?? projection.durationMs ?? null,
					emptyRecall: fact?.emptyRecall ?? null,
					estimatedCost: {
						currency: "USD",
						microusd: fact?.estimatedCostMicrousd ?? null,
					},
					sourceTrace: {
						retrieved: retrievedSources,
						supporting: supportingSources,
					},
					failClosed: fact?.failClosed ?? null,
					inputTokens: fact?.inputTokens ?? null,
					measuredAt: fact ? fact.measuredAt.toISOString() : projection.projectedAt.toISOString(),
					model: {
						name: fact?.modelName ?? null,
						provider: fact?.modelProvider ?? null,
					},
					prompt: {
						id: fact?.promptId ?? null,
						runtimeDetail: fact?.promptRuntimeDetail ?? null,
						runtimeState: fact?.promptRuntimeState ?? null,
						templateSha256: fact?.templateSha256 ?? null,
						version: fact?.promptVersion ?? null,
					},
					outputTokens: fact?.outputTokens ?? null,
					projectionLagMs: fact?.projectionLagMs ?? null,
					refusalClass: fact?.refusalClass ?? null,
					retrievedSourceCount,
					retrievalAdequacyReason: fact?.retrievalAdequacyReason ?? null,
					retrievalAdequacyVerdict: fact?.retrievalAdequacyVerdict ?? null,
					retrievalPlan: projection.diagnosticsJson?.retrievalPlanSummary ?? null,
					retrievalAttempted,
					traceAvailable: fact?.traceAvailable ?? Boolean(projection.traceId),
				},
				request: {
					completedAt: toIsoString(projection.completedAt),
					conversationId: projection.conversationId,
					requestId: projection.requestId,
					requestedCapability: projection.requestedCapability ?? null,
					requestedScope: projection.requestedScopeJson ?? null,
					resolvedScope: projection.resolvedScopeJson ?? null,
					selectedTarget: projection.selectedTarget ?? null,
					startedAt: projection.startedAt.toISOString(),
					status: projection.status as OperatorRequestObservabilityRecord["request"]["status"],
					surface: projection.surface,
					traceId: projection.traceId,
				},
			} satisfies OperatorRequestObservabilityRecord;
		},

		async list(filters: NormalizedOperatorRequestListFilters) {
			const db = await runtime.getDb();
			const conditions = [];

			if (filters.q) {
				const pattern = `%${escapeLikePattern(filters.q)}%`;
				conditions.push(
					or(
						ilike(requestProjection.requestId, pattern),
						ilike(requestProjection.questionPreview, pattern),
						ilike(requestProjection.principalId, pattern),
						ilike(requestProjection.principalLabel, pattern),
						ilike(requestProjection.conversationId, pattern),
						ilike(requestProjection.errorCode, pattern),
					)!,
				);
			}
			if (filters.status) {
				conditions.push(eq(requestProjection.status, filters.status));
			}
			if (filters.surface) {
				conditions.push(eq(requestProjection.surface, filters.surface));
			}
			if (filters.conversationId) {
				conditions.push(eq(requestProjection.conversationId, filters.conversationId));
			}
			if (filters.requestId) {
				conditions.push(eq(requestProjection.requestId, filters.requestId));
			}

			if (filters.cursor) {
				const cursor = decodeRequestCursor(filters.cursor);
				if (cursor) {
					conditions.push(
						or(
							lt(requestProjection.startedAt, new Date(cursor.startedAt)),
							and(
								eq(requestProjection.startedAt, new Date(cursor.startedAt)),
								lt(requestProjection.requestId, cursor.requestId),
							),
						)!,
					);
				}
			}

			const baseQuery =
				conditions.length > 0
					? db
							.select()
							.from(requestProjection)
							.where(and(...conditions))
					: db.select().from(requestProjection);
			const rows = await baseQuery
				.orderBy(desc(requestProjection.startedAt), desc(requestProjection.requestId))
				.limit(filters.limit + 1);

			const items = rows.slice(0, filters.limit).map(toRequestProjectionRecord);
			const nextRow = rows[filters.limit];

			return {
				page: {
					nextCursor: nextRow
						? encodeRequestCursor({
								requestId: nextRow.requestId,
								startedAt: nextRow.startedAt.toISOString(),
							})
						: null,
				},
				requests: items,
			} satisfies OperatorQueryListResult;
		},

		async listAudit(filters: NormalizedOperatorAuditListFilters) {
			const db = await runtime.getDb();
			const conditions = [];

			if (filters.requestId) {
				conditions.push(eq(requestAuditProjection.requestId, filters.requestId));
			}
			if (filters.traceId) {
				conditions.push(eq(requestAuditProjection.traceId, filters.traceId));
			}
			if (filters.principalType) {
				conditions.push(eq(requestAuditProjection.principalType, filters.principalType));
			}
			if (filters.surface) {
				conditions.push(eq(requestAuditProjection.surface, filters.surface));
			}
			if (filters.selectedTarget) {
				conditions.push(eq(requestAuditProjection.selectedTarget, filters.selectedTarget));
			}
			if (filters.eventType) {
				conditions.push(eq(requestAuditProjection.eventType, filters.eventType));
			}
			if (filters.status) {
				conditions.push(eq(requestAuditProjection.status, filters.status));
			}

			if (filters.cursor) {
				const cursor = decodeAuditCursor(filters.cursor);
				if (cursor) {
					conditions.push(
						or(
							lt(requestAuditProjection.occurredAt, new Date(cursor.occurredAt)),
							and(
								eq(requestAuditProjection.occurredAt, new Date(cursor.occurredAt)),
								lt(requestAuditProjection.auditEventId, cursor.auditEventId),
							),
						)!,
					);
				}
			}

			const baseQuery =
				conditions.length > 0
					? db
							.select()
							.from(requestAuditProjection)
							.where(and(...conditions))
					: db.select().from(requestAuditProjection);
			const rows = await baseQuery
				.orderBy(desc(requestAuditProjection.occurredAt), desc(requestAuditProjection.auditEventId))
				.limit(filters.limit + 1);

			const items = rows.slice(0, filters.limit).map(toAuditListItem);
			const nextRow = rows[filters.limit];

			return {
				events: items,
				page: {
					nextCursor: nextRow
						? encodeAuditCursor({
								auditEventId: nextRow.auditEventId,
								occurredAt: nextRow.occurredAt.toISOString(),
							})
						: null,
				},
			} satisfies OperatorAuditListResult;
		},
	};
}
