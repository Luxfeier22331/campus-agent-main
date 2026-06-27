import { and, desc, eq, gte, lt, or, type SQL } from "drizzle-orm";

import { evalDiagnosticBadcaseProjection } from "../../../db/schema";
import type {
	NormalizedOperatorQualityBadcaseListFilters,
	OperatorQualityEvalCandidateListResult,
} from "../service";
import { decodeQualityBadcaseCursor, encodeQualityBadcaseCursor } from "./cursors";
import type { OperatorQueryRuntime } from "./runtime";
import { inferEvalFamilyFromCauseClass, inferStepDiagnosisStage, toScore } from "./shared";

type EvalDiagnosticCandidate = OperatorQualityEvalCandidateListResult["candidates"][number];
type EvalDiagnosticBadcaseRow = typeof evalDiagnosticBadcaseProjection.$inferSelect;

function emptyResult(): OperatorQualityEvalCandidateListResult {
	return {
		candidates: [],
		page: {
			nextCursor: null,
		},
	};
}

function summaryFor(row: EvalDiagnosticBadcaseRow): string {
	const score = toScore(row.scoreMilli)?.toFixed(2);
	const threshold = toScore(row.thresholdMilli)?.toFixed(2);
	return `RAGAS ${row.metricName}=${score} below ${threshold} at ${row.failureStage}.`;
}

function toCandidate(row: EvalDiagnosticBadcaseRow): EvalDiagnosticCandidate {
	const score = toScore(row.scoreMilli) ?? 0;
	const threshold = toScore(row.thresholdMilli) ?? 0;
	return {
		candidateId: `eval_candidate:${row.badcaseId}`,
		causeClass: row.causeClass,
		diagnosisStage: inferStepDiagnosisStage({
			causeClass: row.causeClass,
			failureStage: row.failureStage,
		}),
		diagnostic: {
			answerShape: row.answerShape ?? null,
			caseId: row.caseId,
			expectedDocIds: row.expectedDocIdsJson,
			failureStage: row.failureStage,
			metricFailureReason: row.metricFailureReason,
			metricName: row.metricName,
			presentationKind: row.presentationKind ?? null,
			retrievedContextIds: row.retrievedContextIdsJson,
			retrievedDocIds: row.retrievedDocIdsJson,
			score,
			supportingDocIds: row.supportingDocIdsJson,
			threshold,
			trajectoryAttribution: row.trajectoryAttributionJson,
		},
		grade: {
			graderVersion: row.sourceReportSchema,
			result: "fail",
			score,
		},
		intake: {
			createdAt: row.generatedAt.toISOString(),
			source: "ragas_diagnostic",
			status: "pending_review",
			suggestedEvalFamily: inferEvalFamilyFromCauseClass(row.causeClass),
		},
		links: {
			issueFingerprint: null,
			issueLink: null,
			traceLink: null,
		},
		requestId: null,
		runId: null,
		selectedTool: null,
		summary: summaryFor(row),
		surface: row.surfaceKey,
		traceId: null,
	};
}

export function createEvalDiagnosticCandidateHandlers(runtime: OperatorQueryRuntime) {
	return {
		async listEvalDiagnosticCandidates(
			filters: NormalizedOperatorQualityBadcaseListFilters,
		): Promise<OperatorQualityEvalCandidateListResult> {
			if (
				(filters.detectedBy && filters.detectedBy !== "ragas_diagnostic") ||
				(filters.status && filters.status !== "pending_review") ||
				filters.selectedTool
			) {
				return emptyResult();
			}

			const db = await runtime.getDb();
			const conditions: SQL[] = [];
			if (filters.causeClass) {
				conditions.push(eq(evalDiagnosticBadcaseProjection.causeClass, filters.causeClass));
			}
			if (filters.surface) {
				conditions.push(eq(evalDiagnosticBadcaseProjection.surfaceKey, filters.surface));
			}
			if (filters.window) {
				const bounds = (() => {
					const nowValue = runtime.now().valueOf();
					const durationMs =
						filters.window === "15m"
							? 15 * 60_000
							: filters.window === "1h"
								? 60 * 60_000
								: filters.window === "24h"
									? 24 * 60 * 60_000
									: filters.window === "7d"
										? 7 * 24 * 60 * 60_000
										: 30 * 24 * 60 * 60_000;
					return {
						from: new Date(nowValue - durationMs),
						to: runtime.now(),
					};
				})();
				conditions.push(gte(evalDiagnosticBadcaseProjection.generatedAt, bounds.from));
				conditions.push(lt(evalDiagnosticBadcaseProjection.generatedAt, bounds.to));
			}
			const cursor = filters.cursor ? decodeQualityBadcaseCursor(filters.cursor) : null;
			if (cursor) {
				const cursorGeneratedAt = new Date(cursor.openedAt);
				const cursorCondition = or(
					lt(evalDiagnosticBadcaseProjection.generatedAt, cursorGeneratedAt),
					and(
						eq(evalDiagnosticBadcaseProjection.generatedAt, cursorGeneratedAt),
						lt(evalDiagnosticBadcaseProjection.badcaseId, cursor.badcaseId),
					),
				);
				if (cursorCondition) {
					conditions.push(cursorCondition);
				}
			}

			const baseQuery =
				conditions.length > 0
					? db
							.select()
							.from(evalDiagnosticBadcaseProjection)
							.where(and(...conditions))
					: db.select().from(evalDiagnosticBadcaseProjection);
			const rows = await baseQuery
				.orderBy(
					desc(evalDiagnosticBadcaseProjection.generatedAt),
					desc(evalDiagnosticBadcaseProjection.badcaseId),
				)
				.limit(filters.limit + 1);
			const visibleRows = rows.slice(0, filters.limit);
			const cursorRow = rows.length > filters.limit ? visibleRows.at(-1) : null;

			return {
				candidates: visibleRows.map(toCandidate),
				page: {
					nextCursor: cursorRow
						? encodeQualityBadcaseCursor({
								badcaseId: cursorRow.badcaseId,
								openedAt: cursorRow.generatedAt.toISOString(),
							})
						: null,
				},
			};
		},
	};
}
