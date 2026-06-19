import { and, desc, eq, ilike, lt, or, type SQL } from "drizzle-orm";

import {
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
	OperatorIntentObservabilitySummary,
	OperatorQueryListResult,
	OperatorRequestObservabilityRecord,
} from "../service";
import {
	decodeAuditCursor,
	decodeRequestCursor,
	encodeAuditCursor,
	encodeRequestCursor,
} from "./cursors";
import type { OperatorQueryRuntime, RequestObservabilityFactRow } from "./runtime";
import {
	escapeLikePattern,
	loadRunBacklinksByRequestIds,
	toAuditListItem,
	toIsoString,
	toLinks,
	toRequestProjectionRecord,
} from "./shared";

function toIntentObservabilitySummary(
	fact: RequestObservabilityFactRow | null | undefined,
): OperatorIntentObservabilitySummary | null {
	if (!fact) {
		return null;
	}
	const summary: OperatorIntentObservabilitySummary = {
		capability: fact.intentCapability ?? null,
		classifierVersion: fact.intentClassifierVersion ?? null,
		launchState: fact.intentLaunchState ?? null,
		nextAction: fact.intentNextAction ?? null,
		policyReason: fact.intentPolicyReason ?? null,
		scopeClass: fact.intentScopeClass ?? null,
		scopeReason: fact.intentScopeReason ?? null,
		taskKind: fact.intentTaskKind ?? null,
	};
	if (fact.intentAmbiguityReason) {
		summary.ambiguityReason = fact.intentAmbiguityReason;
	}
	if (fact.intentAmbiguitySignal) {
		summary.ambiguitySignal = fact.intentAmbiguitySignal;
	}
	if (fact.intentContextReferenceType) {
		summary.contextReferenceType = fact.intentContextReferenceType;
	}
	if (fact.intentContextResolutionState) {
		summary.contextResolutionState = fact.intentContextResolutionState;
	}
	if (fact.intentMissingSlotsJson) {
		summary.missingSlots = fact.intentMissingSlotsJson;
	}
	if (fact.intentResolvedSlotsJson) {
		summary.resolvedSlots = fact.intentResolvedSlotsJson;
	}
	if (fact.intentRoutingConfidence) {
		summary.routingConfidence = fact.intentRoutingConfidence;
	}
	if (fact.intentSchemaVersion) {
		summary.schemaVersion = fact.intentSchemaVersion;
	}
	return Object.values(summary).some((value) => value !== null) ? summary : null;
}

export function createRequestStoreHandlers(runtime: OperatorQueryRuntime) {
	return {
		async getById(requestId: string) {
			const db = await runtime.getDb();
			const rows = await db
				.select()
				.from(requestProjection)
				.where(eq(requestProjection.requestId, requestId))
				.limit(1);

			const row = rows[0];
			if (!row) {
				return null;
			}
			const runBacklinks = await loadRunBacklinksByRequestIds(db, [row.requestId]);
			return toRequestProjectionRecord(row, {
				runId: runBacklinks.get(row.requestId) ?? null,
			});
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
					selectedCapability: row.selectedCapability ?? null,
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
			const runBacklinks = await loadRunBacklinksByRequestIds(db, [projection.requestId]);
			const retrievedSources = fact?.retrievedSourcesJson ?? [];
			const supportingSources = fact?.supportingSourcesJson ?? [];
			const retrievalAttempted = fact?.retrievalAttempted ?? null;
			const retrievedSourceCount =
				fact?.retrievedSourceCount ??
				(retrievalAttempted === true || retrievedSources.length > 0
					? retrievedSources.length
					: null);
			const diagnostics = projection.diagnosticsJson ?? null;
			const prompt = {
				id: fact?.promptId ?? null,
				runtimeDetail: fact?.modelExecutionDetail ?? null,
				runtimeState: fact?.modelExecutionState ?? null,
				templateSha256: fact?.templateSha256 ?? null,
				version: fact?.promptVersion ?? null,
			};
			const claimSupportSummary =
				fact?.claimSupportSummaryJson ?? diagnostics?.claimSupportSummary ?? null;
			const retrievalAdequacyReason =
				fact?.retrievalAdequacyReason ?? diagnostics?.retrievalAdequacyReason ?? null;
			const retrievalAdequacyVerdict =
				fact?.retrievalAdequacyVerdict ?? diagnostics?.retrievalAdequacyVerdict ?? null;
			const retrievalPlan = diagnostics?.retrievalPlanSummary ?? null;
			const semanticOutcome = fact?.semanticOutcome ?? diagnostics?.semanticOutcome ?? null;
			const scopeClass = fact?.scopeClass ?? diagnostics?.scopeClass ?? null;
			const policyReason = fact?.policyReason ?? diagnostics?.policyReason ?? null;
			const intent = toIntentObservabilitySummary(fact);
			const tool =
				fact?.selectedTool ||
				fact?.toolBusinessOutcome ||
				fact?.toolFailCloseReason ||
				fact?.toolHistoricalDowngradeReason
					? {
							businessOutcome: fact?.toolBusinessOutcome ?? null,
							failCloseReason: fact?.toolFailCloseReason ?? null,
							historicalDowngradeReason: fact?.toolHistoricalDowngradeReason ?? null,
							selectedTool: fact?.selectedTool ?? null,
						}
					: null;

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
					claimSupportSummary,
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
					...(intent ? { intent } : {}),
					...(tool ? { tool } : {}),
					...(fact?.workflowTraceSummaryJson
						? { workflowTrace: fact.workflowTraceSummaryJson }
						: {}),
					inputTokens: fact?.inputTokens ?? null,
					measuredAt: fact ? fact.measuredAt.toISOString() : projection.projectedAt.toISOString(),
					model: {
						name: fact?.modelName ?? null,
						provider: fact?.modelProvider ?? null,
					},
					prompt,
					outputTokens: fact?.outputTokens ?? null,
					projectionLagMs: fact?.projectionLagMs ?? null,
					refusalClass: fact?.refusalClass ?? null,
					retrievedSourceCount,
					retrievalAdequacyReason,
					retrievalAdequacyVerdict,
					retrievalPlan,
					retrievalAttempted,
					traceAvailable: fact?.traceAvailable ?? Boolean(projection.traceId),
					...(fact?.versionQueryMode || fact?.versionQuerySummary
						? {
								versionQueryMode: fact?.versionQueryMode ?? null,
								versionQuerySummary: fact?.versionQuerySummary ?? null,
							}
						: {}),
				},
				replay: {
					answerQuality: {
						citationCount: fact?.citationCount ?? supportingSources.length,
						citationExpected: fact?.citationExpected ?? null,
						citationMissing: fact?.citationMissing ?? null,
						claimSupportSummary,
						freshnessFailClosed: diagnostics?.freshnessFailClosed ?? null,
						groundingDowngraded: diagnostics?.groundingDowngraded ?? null,
						groundingVerdict: diagnostics?.groundingVerdict ?? null,
						policyReason,
					},
					context: {
						applicabilityScope: projection.applicabilityScope ?? null,
						entitlementGroups: projection.entitlementGroupsJson ?? [],
						entitlementSnapshotId:
							fact?.entitlementSnapshotId ?? projection.entitlementSnapshotId ?? null,
						policyProjectionVersion: fact?.policyProjectionVersion ?? null,
						principalType: projection.principalType,
						visibilityScope: projection.visibilityScope ?? null,
					},
					execution: {
						errorCode: projection.errorCode ?? fact?.errorCode ?? null,
						failClosed: fact?.failClosed ?? null,
						refusalClass: fact?.refusalClass ?? null,
						scopeClass,
						semanticOutcome,
						status:
							projection.status as OperatorRequestObservabilityRecord["replay"]["execution"]["status"],
					},
					prompt,
					retrieval: {
						adequacyReason: retrievalAdequacyReason,
						adequacyVerdict: retrievalAdequacyVerdict,
						candidateCount: fact?.candidateCount ?? null,
						emptyRecall: fact?.emptyRecall ?? null,
						plan: retrievalPlan,
						retrievalAttempted,
						retrievedSourceCount,
						sourceTraceCounts: {
							retrieved: retrievedSources.length,
							supporting: supportingSources.length,
						},
					},
					routing: {
						...(intent ? { intent } : {}),
						requestedCapability: projection.requestedCapability ?? null,
						requestedScope: projection.requestedScopeJson ?? null,
						resolvedScope: projection.resolvedScopeJson ?? null,
						selectedCapability: projection.selectedCapability ?? null,
					},
				},
				request: {
					completedAt: toIsoString(projection.completedAt),
					conversationId: projection.conversationId,
					requestId: projection.requestId,
					runId: runBacklinks.get(projection.requestId) ?? null,
					requestedCapability: projection.requestedCapability ?? null,
					requestedScope: projection.requestedScopeJson ?? null,
					...(projection.versionQueryJson ? { versionQuery: projection.versionQueryJson } : {}),
					resolvedScope: projection.resolvedScopeJson ?? null,
					selectedCapability: projection.selectedCapability ?? null,
					startedAt: projection.startedAt.toISOString(),
					status: projection.status as OperatorRequestObservabilityRecord["request"]["status"],
					surface: projection.surface,
					traceId: projection.traceId,
				},
			} satisfies OperatorRequestObservabilityRecord;
		},

		async list(filters: NormalizedOperatorRequestListFilters) {
			const db = await runtime.getDb();
			const conditions: SQL[] = [];

			if (filters.q) {
				const pattern = `%${escapeLikePattern(filters.q)}%`;
				const searchCondition = or(
					ilike(requestProjection.requestId, pattern),
					ilike(requestProjection.questionPreview, pattern),
					ilike(requestProjection.principalId, pattern),
					ilike(requestProjection.principalLabel, pattern),
					ilike(requestProjection.conversationId, pattern),
					ilike(requestProjection.errorCode, pattern),
				);
				if (searchCondition) {
					conditions.push(searchCondition);
				}
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
					const cursorCondition = or(
						lt(requestProjection.startedAt, new Date(cursor.startedAt)),
						and(
							eq(requestProjection.startedAt, new Date(cursor.startedAt)),
							lt(requestProjection.requestId, cursor.requestId),
						),
					);
					if (cursorCondition) {
						conditions.push(cursorCondition);
					}
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

			const visibleRows = rows.slice(0, filters.limit);
			const runBacklinks = await loadRunBacklinksByRequestIds(
				db,
				visibleRows.map((row) => row.requestId),
			);
			const items = visibleRows.map((row) =>
				toRequestProjectionRecord(row, {
					runId: runBacklinks.get(row.requestId) ?? null,
				}),
			);
			const cursorRow = rows.length > filters.limit ? visibleRows.at(-1) : null;

			return {
				page: {
					nextCursor: cursorRow
						? encodeRequestCursor({
								requestId: cursorRow.requestId,
								startedAt: cursorRow.startedAt.toISOString(),
							})
						: null,
				},
				requests: items,
			} satisfies OperatorQueryListResult;
		},

		async listAudit(filters: NormalizedOperatorAuditListFilters) {
			const db = await runtime.getDb();
			const conditions: SQL[] = [];

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
			if (filters.selectedCapability) {
				conditions.push(eq(requestAuditProjection.selectedCapability, filters.selectedCapability));
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
					const cursorCondition = or(
						lt(requestAuditProjection.occurredAt, new Date(cursor.occurredAt)),
						and(
							eq(requestAuditProjection.occurredAt, new Date(cursor.occurredAt)),
							lt(requestAuditProjection.auditEventId, cursor.auditEventId),
						),
					);
					if (cursorCondition) {
						conditions.push(cursorCondition);
					}
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

			const visibleRows = rows.slice(0, filters.limit);
			const items = visibleRows.map(toAuditListItem);
			const cursorRow = rows.length > filters.limit ? visibleRows.at(-1) : null;

			return {
				events: items,
				page: {
					nextCursor: cursorRow
						? encodeAuditCursor({
								auditEventId: cursorRow.auditEventId,
								occurredAt: cursorRow.occurredAt.toISOString(),
							})
						: null,
				},
			} satisfies OperatorAuditListResult;
		},
	};
}
