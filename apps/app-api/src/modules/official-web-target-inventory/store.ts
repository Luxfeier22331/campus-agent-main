import { and, desc, eq, inArray } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDbGetter, type RuntimeDbGetter } from "../../db/runtime";
import {
	crawlRuns,
	officialWebTargetArtifactVerificationSummaries,
	officialWebTargetJobs,
	officialWebTargetPageAttempts,
	pageObservations,
	runArtifacts,
} from "../../db/schema";
import type {
	OfficialWebTargetInventoryFieldStatus,
	OfficialWebTargetInventoryFieldStatusStore,
	OfficialWebTargetInventoryPreviewEvidence,
	OfficialWebTargetInventoryPreviewEvidenceStore,
} from "./service";

function asStagedPromotionDecision(status: string): string {
	return status === "staged" ? "staged" : status;
}

const FIELD_STATUS_VALUES = new Set<OfficialWebTargetInventoryFieldStatus>([
	"ambiguous",
	"missing",
	"not_applicable",
	"present",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function coerceFieldStatus(value: unknown): Record<string, OfficialWebTargetInventoryFieldStatus> {
	if (!isRecord(value)) {
		return {};
	}
	const result: Record<string, OfficialWebTargetInventoryFieldStatus> = {};
	for (const [fieldName, rawStatus] of Object.entries(value)) {
		if (FIELD_STATUS_VALUES.has(rawStatus as OfficialWebTargetInventoryFieldStatus)) {
			result[fieldName] = rawStatus as OfficialWebTargetInventoryFieldStatus;
		}
	}
	return result;
}

function normalizeOptionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function scoreSummaryMatch(
	summary: Record<string, unknown>,
	entry: { inventoryId: string; sourceUrls: string[] },
): number {
	const inventoryId = normalizeOptionalString(summary.inventoryId);
	const normalizedCanonicalUrl = normalizeOptionalString(summary.normalizedCanonicalUrl);
	const inventoryMatches = inventoryId === entry.inventoryId;
	const sourceMatches =
		normalizedCanonicalUrl !== null && entry.sourceUrls.includes(normalizedCanonicalUrl);
	if (inventoryMatches && sourceMatches) {
		return 3;
	}
	if (inventoryMatches) {
		return 2;
	}
	if (sourceMatches) {
		return 1;
	}
	return 0;
}

function extractMatchedSummary(
	summary: unknown,
	entry: { inventoryId: string; sourceUrls: string[] },
): Record<string, unknown> | null {
	if (!isRecord(summary)) {
		return null;
	}

	const reviewSummaries = Array.isArray(summary.reviewSummaries)
		? summary.reviewSummaries.filter(isRecord)
		: null;
	if (reviewSummaries && reviewSummaries.length > 0) {
		let bestMatch: Record<string, unknown> | null = null;
		let bestScore = 0;
		for (const reviewSummary of reviewSummaries) {
			const score = scoreSummaryMatch(reviewSummary, entry);
			if (score > bestScore) {
				bestMatch = reviewSummary;
				bestScore = score;
			}
		}
		return bestMatch;
	}

	return scoreSummaryMatch(summary, entry) > 0 ? summary : null;
}

function extractFieldStatusForEntry(
	summary: unknown,
	entry: { inventoryId: string; sourceUrls: string[] },
): Record<string, OfficialWebTargetInventoryFieldStatus> {
	const matchedSummary = extractMatchedSummary(summary, entry);
	if (!matchedSummary) {
		return {};
	}
	return coerceFieldStatus(matchedSummary.fieldStatus);
}

export function createPgOfficialWebTargetInventoryPreviewEvidenceStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): OfficialWebTargetInventoryPreviewEvidenceStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async listPreviewEvidence(input) {
			const db = await getDb();
			const evidence: OfficialWebTargetInventoryPreviewEvidence[] = [];

			for (const entry of input.entries) {
				if (entry.sourceUrls.length === 0) {
					continue;
				}

				const rows = await db
					.select({
						attempt: officialWebTargetPageAttempts,
						observation: pageObservations,
						run: crawlRuns,
					})
					.from(officialWebTargetPageAttempts)
					.innerJoin(crawlRuns, eq(crawlRuns.runId, officialWebTargetPageAttempts.runId))
					.leftJoin(
						pageObservations,
						and(
							eq(pageObservations.runId, officialWebTargetPageAttempts.runId),
							eq(
								pageObservations.normalizedCanonicalUrl,
								officialWebTargetPageAttempts.normalizedCanonicalUrl,
							),
						),
					)
					.where(
						and(
							eq(officialWebTargetPageAttempts.siteId, input.siteId),
							eq(officialWebTargetPageAttempts.targetId, entry.admissionTargetId),
							inArray(officialWebTargetPageAttempts.normalizedCanonicalUrl, entry.sourceUrls),
							eq(officialWebTargetPageAttempts.attemptStatus, "completed"),
						),
					)
					.orderBy(desc(officialWebTargetPageAttempts.attemptedAt))
					.limit(1);

				const row = rows[0];
				if (!row) {
					continue;
				}

				const artifactRows = await db
					.select({ objectKey: runArtifacts.objectKey })
					.from(runArtifacts)
					.where(eq(runArtifacts.runId, row.run.runId))
					.orderBy(runArtifacts.artifactType);

				evidence.push({
					appApiRunId: row.run.runId,
					currentTruthImportWasNull: row.run.ingestionExecutionStatus === "staged",
					ingestionStatus: row.run.ingestionExecutionStatus,
					inventoryId: entry.inventoryId,
					promotionDecision: asStagedPromotionDecision(row.run.ingestionExecutionStatus),
					rawAssetId: row.observation?.rawAssetId ?? "",
					rawVersionId: row.observation?.rawVersionId ?? "",
					sourceObjectKeys: artifactRows.map((artifact) => artifact.objectKey),
					targetAttemptId: row.attempt.attemptId,
					targetJobId: row.attempt.jobId,
				});
			}

			return evidence;
		},
	};
}

export function createPgOfficialWebTargetInventoryFieldStatusStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): OfficialWebTargetInventoryFieldStatusStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async listFieldStatus(input) {
			const db = await getDb();
			const fieldStatusByInventoryId: Record<
				string,
				Record<string, OfficialWebTargetInventoryFieldStatus>
			> = {};

			for (const entry of input.entries) {
				const rows = await db
					.select({
						summary: officialWebTargetArtifactVerificationSummaries,
					})
					.from(officialWebTargetArtifactVerificationSummaries)
					.innerJoin(
						officialWebTargetJobs,
						eq(officialWebTargetJobs.jobId, officialWebTargetArtifactVerificationSummaries.jobId),
					)
					.where(
						and(
							eq(officialWebTargetJobs.siteId, input.siteId),
							eq(officialWebTargetJobs.targetId, entry.admissionTargetId),
						),
					)
					.orderBy(
						desc(officialWebTargetArtifactVerificationSummaries.updatedAt),
						desc(officialWebTargetArtifactVerificationSummaries.summaryId),
					)
					.limit(10);

				for (const row of rows) {
					const fieldStatus = extractFieldStatusForEntry(row.summary.summaryJson, {
						inventoryId: entry.inventoryId,
						sourceUrls: entry.sourceUrls,
					});
					if (Object.keys(fieldStatus).length > 0) {
						fieldStatusByInventoryId[entry.inventoryId] = fieldStatus;
						break;
					}
				}
			}

			return fieldStatusByInventoryId;
		},
	};
}
